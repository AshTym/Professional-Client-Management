import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  lt,
  ne,
  sql,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import * as api from "@workspace/api-zod";
import {
  billingProfilesTable,
  clientsTable,
  intakesTable,
  matterFollowupsTable,
  mattersTable,
  membershipsTable,
  teamCapacitiesTable,
  timeEntriesTable,
} from "@workspace/db";
import { db } from "@workspace/db";
import { firmAccess, logAuditEvent } from "../lib/clientguard-auth";

const router: IRouter = Router();
const ACTIVE_STATUSES = ["open", "on_hold"] as const;

function isAdmin(role: string) {
  return role === "owner" || role === "admin";
}

function dateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function dateRangeBounds(from: string, to: string) {
  return {
    start: new Date(`${from}T00:00:00.000Z`),
    end: new Date(`${to}T23:59:59.999Z`),
  };
}

async function workloadFor(
  workspaceId: number,
  from: string,
  to: string,
) {
  const [members, activeCounts, logged] = await Promise.all([
    db.select({
      id: membershipsTable.id,
      displayName: membershipsTable.displayName,
      email: membershipsTable.email,
      role: membershipsTable.role,
      weeklyCapacityMinutes: teamCapacitiesTable.weeklyCapacityMinutes,
      activeMatterLimit: teamCapacitiesTable.activeMatterLimit,
    }).from(membershipsTable).leftJoin(teamCapacitiesTable, and(
      eq(teamCapacitiesTable.workspaceId, membershipsTable.workspaceId),
      eq(teamCapacitiesTable.membershipId, membershipsTable.id),
    )).where(eq(membershipsTable.workspaceId, workspaceId))
      .orderBy(membershipsTable.displayName),
    db.select({
      membershipId: mattersTable.responsibleMemberId,
      count: count(),
    }).from(mattersTable).where(and(
      eq(mattersTable.workspaceId, workspaceId),
      inArray(mattersTable.status, [...ACTIVE_STATUSES]),
      isNotNull(mattersTable.responsibleMemberId),
    )).groupBy(mattersTable.responsibleMemberId),
    db.select({
      membershipId: mattersTable.responsibleMemberId,
      loggedMinutes: sql<number>`coalesce(sum(${timeEntriesTable.durationMinutes}), 0)::int`,
    }).from(timeEntriesTable).innerJoin(mattersTable, and(
      eq(mattersTable.id, timeEntriesTable.matterId),
      eq(mattersTable.workspaceId, timeEntriesTable.workspaceId),
    )).where(and(
      eq(timeEntriesTable.workspaceId, workspaceId),
      gte(timeEntriesTable.workDate, from),
      lte(timeEntriesTable.workDate, to),
      isNotNull(mattersTable.responsibleMemberId),
    )).groupBy(mattersTable.responsibleMemberId),
  ]);
  const activeByMember = new Map(activeCounts.map((row) => [
    Number(row.membershipId),
    Number(row.count),
  ]));
  const loggedByMember = new Map(logged.map((row) => [
    Number(row.membershipId),
    Number(row.loggedMinutes),
  ]));
  return members.map((member) => ({
    membershipId: member.id,
    name: member.displayName || member.email || "Firm teammate",
    role: member.role,
    weeklyCapacityMinutes: member.weeklyCapacityMinutes ?? 2400,
    activeMatterLimit: member.activeMatterLimit ?? 12,
    activeMatterCount: activeByMember.get(member.id) ?? 0,
    loggedMinutes: loggedByMember.get(member.id) ?? 0,
  }));
}

async function reportFor(workspaceId: number, from: string, to: string) {
  const now = new Date();
  const today = dateString(now);
  const nextSevenDays = dateString(addDays(now, 7));
  const nextThirtyDays = addDays(now, 30);
  const nextThirtyDaysEnd = new Date(`${dateString(nextThirtyDays)}T23:59:59.999Z`);
  const ageBucket = sql<string>`case
    when ${timeEntriesTable.workDate} >= current_date - interval '30 days' then '0–30 days'
    when ${timeEntriesTable.workDate} >= current_date - interval '60 days' then '31–60 days'
    when ${timeEntriesTable.workDate} >= current_date - interval '90 days' then '61–90 days'
    else '90+ days'
  end`;
  const [matterPipeline, intakePipeline, overdueRows, nextWeekRows, wipRows, workload, deadlineRows, followupRows] =
    await Promise.all([
      db.select({ status: mattersTable.status, count: count() }).from(mattersTable)
        .where(eq(mattersTable.workspaceId, workspaceId))
        .groupBy(mattersTable.status),
      db.select({ status: intakesTable.status, count: count() }).from(intakesTable)
        .where(and(
          eq(intakesTable.workspaceId, workspaceId),
          ne(intakesTable.status, "converted"),
        ))
        .groupBy(intakesTable.status),
      db.select({ count: count() }).from(mattersTable).where(and(
        eq(mattersTable.workspaceId, workspaceId),
        inArray(mattersTable.status, [...ACTIVE_STATUSES]),
        isNotNull(mattersTable.dueAt),
        lt(mattersTable.dueAt, new Date(`${today}T00:00:00.000Z`)),
      )),
      db.select({ count: count() }).from(mattersTable).where(and(
        eq(mattersTable.workspaceId, workspaceId),
        inArray(mattersTable.status, [...ACTIVE_STATUSES]),
        isNotNull(mattersTable.dueAt),
        gte(mattersTable.dueAt, new Date(`${today}T00:00:00.000Z`)),
        lte(mattersTable.dueAt, new Date(`${nextSevenDays}T23:59:59.999Z`)),
      )),
      db.select({
        bucket: ageBucket,
        currency: billingProfilesTable.currency,
        entryCount: count(),
        totalMinutes: sql<number>`coalesce(sum(${timeEntriesTable.durationMinutes}), 0)::int`,
        estimatedCents: sql<number>`coalesce(sum(case
          when ${billingProfilesTable.feeType} = 'hourly' and ${billingProfilesTable.hourlyRateCents} is not null
            then floor(${timeEntriesTable.durationMinutes}::numeric * ${billingProfilesTable.hourlyRateCents} / 60)
          else 0 end), 0)`,
        pricedEntryCount: sql<number>`count(*) filter (where ${billingProfilesTable.feeType} = 'hourly' and ${billingProfilesTable.hourlyRateCents} is not null)::int`,
        fixedFeeEntryCount: sql<number>`count(*) filter (where ${billingProfilesTable.feeType} = 'fixed')::int`,
        unpricedEntryCount: sql<number>`count(*) filter (
          where ${billingProfilesTable.id} is null
            or (${billingProfilesTable.feeType} = 'hourly' and ${billingProfilesTable.hourlyRateCents} is null)
        )::int`,
      }).from(timeEntriesTable)
        .innerJoin(mattersTable, and(
          eq(mattersTable.id, timeEntriesTable.matterId),
          eq(mattersTable.workspaceId, timeEntriesTable.workspaceId),
        ))
        .leftJoin(billingProfilesTable, and(
          eq(billingProfilesTable.matterId, mattersTable.id),
          eq(billingProfilesTable.workspaceId, mattersTable.workspaceId),
        ))
        .where(and(
          eq(timeEntriesTable.workspaceId, workspaceId),
          eq(timeEntriesTable.billable, true),
          isNull(timeEntriesTable.billingDraftId),
        ))
        .groupBy(ageBucket, billingProfilesTable.currency)
        .orderBy(ageBucket, billingProfilesTable.currency),
      workloadFor(workspaceId, from, to),
      db.select({
        matterId: mattersTable.id,
        matterTitle: mattersTable.title,
        clientName: clientsTable.name,
        responsible: mattersTable.responsible,
        dueAt: mattersTable.dueAt,
        riskLevel: mattersTable.riskLevel,
      }).from(mattersTable).innerJoin(clientsTable, and(
        eq(clientsTable.id, mattersTable.clientId),
        eq(clientsTable.workspaceId, mattersTable.workspaceId),
      )).where(and(
        eq(mattersTable.workspaceId, workspaceId),
        inArray(mattersTable.status, [...ACTIVE_STATUSES]),
        isNotNull(mattersTable.dueAt),
        lte(mattersTable.dueAt, nextThirtyDaysEnd),
      )).orderBy(mattersTable.dueAt).limit(100),
      db.select({
        followup: matterFollowupsTable,
        matterTitle: mattersTable.title,
        clientName: clientsTable.name,
      }).from(matterFollowupsTable).innerJoin(mattersTable, and(
        eq(mattersTable.id, matterFollowupsTable.matterId),
        eq(mattersTable.workspaceId, matterFollowupsTable.workspaceId),
      )).innerJoin(clientsTable, and(
        eq(clientsTable.id, mattersTable.clientId),
        eq(clientsTable.workspaceId, mattersTable.workspaceId),
      )).where(and(
        eq(matterFollowupsTable.workspaceId, workspaceId),
        eq(matterFollowupsTable.status, "open"),
        lte(matterFollowupsTable.dueAt, nextThirtyDaysEnd),
      )).orderBy(matterFollowupsTable.dueAt).limit(100),
    ]);

  const agingWorkInProgress = wipRows.map((row) => ({
    bucket: row.bucket,
    currency: row.currency,
    entryCount: Number(row.entryCount),
    hours: Number(row.totalMinutes) / 60,
    estimatedCents: Number(row.estimatedCents),
    pricedEntryCount: Number(row.pricedEntryCount),
    fixedFeeEntryCount: Number(row.fixedFeeEntryCount),
    unpricedEntryCount: Number(row.unpricedEntryCount),
  }));
  const matterCounts = new Map(matterPipeline.map((row) => [row.status, Number(row.count)]));
  const pipeline = [
    ...intakePipeline.map((row) => ({
      status: `intake_${row.status}`,
      count: Number(row.count),
    })),
    ...matterPipeline.map((row) => ({
      status: row.status,
      count: Number(row.count),
    })),
  ];
  return {
    from,
    to,
    totals: {
      openMatters: matterCounts.get("open") ?? 0,
      onHoldMatters: matterCounts.get("on_hold") ?? 0,
      overdueDeadlines: Number(overdueRows[0]?.count ?? 0),
      dueNext7Days: Number(nextWeekRows[0]?.count ?? 0),
    },
    pipeline,
    agingWorkInProgress,
    workload,
    upcomingDeadlines: deadlineRows.map((row) => ({
      matterId: row.matterId,
      matterTitle: row.matterTitle,
      clientName: row.clientName,
      responsible: row.responsible,
      dueAt: row.dueAt,
      riskLevel: row.riskLevel,
    })),
    followups: followupRows.map(({ followup, matterTitle, clientName }) => ({
      id: followup.id,
      matterId: followup.matterId,
      matterTitle,
      clientName,
      dueAt: followup.dueAt,
      reason: followup.reason,
      status: followup.status,
      createdAt: followup.createdAt,
    })),
  };
}

router.post("/reports/operations/export", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  if (!isAdmin(access.role)) {
    res.status(403).json({ error: "Firm administrator access required." });
    return;
  }
  const parsed = api.LogOperationsReportExportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const from = parsed.data.from instanceof Date
    ? parsed.data.from.toISOString().slice(0, 10)
    : parsed.data.from;
  const to = parsed.data.to instanceof Date
    ? parsed.data.to.toISOString().slice(0, 10)
    : parsed.data.to;
  if (from > to) {
    res.status(400).json({ error: "The report start date must be on or before the end date." });
    return;
  }
  await logAuditEvent(access, "operations_report_exported", "operations_report", access.workspaceId, "Firm operations report", {
    format: parsed.data.format,
    from,
    to,
  });
  res.json(api.LogOperationsReportExportResponse.parse({ logged: true }));
});

router.get("/reports/operations", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  if (!isAdmin(access.role)) {
    res.status(403).json({ error: "Operations reporting is available to firm owners and admins." });
    return;
  }
  const parsed = api.GetOperationsReportQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const now = new Date();
  const to = parsed.data.to
    ? typeof parsed.data.to === "string" ? parsed.data.to : dateString(parsed.data.to)
    : dateString(now);
  const from = parsed.data.from
    ? typeof parsed.data.from === "string" ? parsed.data.from : dateString(parsed.data.from)
    : dateString(addDays(now, -30));
  if (from > to) {
    res.status(400).json({ error: "The report start date must be on or before the end date." });
    return;
  }
  const data = await reportFor(access.workspaceId, from, to);
  await logAuditEvent(access, "operations_report_viewed", "operations_report", null, "Firm operations report", {
    from,
    to,
  });
  res.json(api.GetOperationsReportResponse.parse(data));
});

router.put("/reports/operations/capacity", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  if (!isAdmin(access.role)) {
    res.status(403).json({ error: "Only a firm owner or admin can update team capacity." });
    return;
  }
  const parsed = api.SaveTeamCapacityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const ids = parsed.data.capacities.map((capacity) => capacity.membershipId);
  if (new Set(ids).size !== ids.length) {
    res.status(400).json({ error: "Each teammate can appear only once in a capacity update." });
    return;
  }
  const members = ids.length
    ? await db.select({ id: membershipsTable.id }).from(membershipsTable).where(and(
        eq(membershipsTable.workspaceId, access.workspaceId),
        inArray(membershipsTable.id, ids),
      ))
    : [];
  if (members.length !== ids.length) {
    res.status(400).json({ error: "One or more teammates are not active members of this firm." });
    return;
  }
  if (parsed.data.capacities.length) {
    await db.insert(teamCapacitiesTable).values(parsed.data.capacities.map((capacity) => ({
      workspaceId: access.workspaceId,
      membershipId: capacity.membershipId,
      weeklyCapacityMinutes: capacity.weeklyCapacityMinutes,
      activeMatterLimit: capacity.activeMatterLimit,
      updatedByClerkUserId: access.userId,
    }))).onConflictDoUpdate({
      target: [teamCapacitiesTable.workspaceId, teamCapacitiesTable.membershipId],
      set: {
        weeklyCapacityMinutes: sql`excluded.weekly_capacity_minutes`,
        activeMatterLimit: sql`excluded.active_matter_limit`,
        updatedByClerkUserId: access.userId,
        updatedAt: new Date(),
      },
    });
  }
  await logAuditEvent(access, "team_capacity_updated", "operations_report", null, "Team capacity", {
    memberCount: parsed.data.capacities.length,
  });
  const data = await reportFor(access.workspaceId, dateString(addDays(new Date(), -30)), dateString(new Date()));
  res.json(api.SaveTeamCapacityResponse.parse(data.workload));
});

export default router;
