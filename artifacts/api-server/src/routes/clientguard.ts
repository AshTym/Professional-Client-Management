import { Router, type IRouter } from "express";
import { createHash, randomUUID } from "node:crypto";
import { clerkClient } from "@clerk/express";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  ilike,
  isNull,
  lte,
  lt,
  max,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@workspace/db";
import {
  auditEventsTable,
  activitiesTable,
  clientsTable,
  invitationsTable,
  intakesTable,
  mattersTable,
  membershipsTable,
  workspacesTable,
} from "@workspace/db";
import {
  canMatterOpen,
  closeoutIsReady,
} from "../lib/clientguard-practice-service";
import {
  CloseMatterParams,
  CreateClientBody,
  CreateClientResponse,
  CreateMatterBody,
  CreateMatterResponse,
  CreateWorkspaceBody,
  CreateWorkspaceResponse,
  CreateWorkspaceInvitationBody,
  CreateWorkspaceInvitationResponse,
  DashboardSummary,
  DeleteClientParams,
  GetActivityParams,
  GetActivityResponse,
  GetClientParams,
  GetClientResponse,
  GetDashboardResponse,
  GetMatterParams,
  GetMatterResponse,
  GetWorkspaceResponse,
  ListWorkspaceInvitationsResponse,
  ListWorkspaceMembersResponse,
  ListWorkspaceMembershipConflictsResponse,
  ResolveWorkspaceMembershipConflictBody,
  ResolveWorkspaceMembershipConflictParams,
  ResolveWorkspaceMembershipConflictResponse,
  ResolveWorkspaceAssignmentIssueBody,
  ResolveWorkspaceAssignmentIssueParams,
  ResolveWorkspaceAssignmentIssueResponse,
  GetWorkspaceMemberAssignmentsParams,
  GetWorkspaceMemberAssignmentsResponse,
  ResendWorkspaceInvitationParams,
  ResendWorkspaceInvitationResponse,
  WithdrawWorkspaceInvitationParams,
  WithdrawWorkspaceInvitationResponse,
  ListActivityQueryParams,
  ListActivityResponse,
  ExportActivityQueryParams,
  ListClientsQueryParams,
  ListClientsResponse,
  ListMattersQueryParams,
  ListMattersResponse,
  UpdateClientBody,
  UpdateClientParams,
  UpdateClientResponse,
  UpdateMatterBody,
  UpdateMatterParams,
  UpdateMatterResponse,
  AcceptWorkspaceInvitationBody,
  AcceptWorkspaceInvitationResponse,
  UpdateWorkspaceMemberBody,
  UpdateWorkspaceMemberParams,
  UpdateWorkspaceMemberResponse,
  RemoveWorkspaceMemberParams,
  RemoveWorkspaceMemberBody,
  TransferWorkspaceOwnershipParams,
  TransferWorkspaceOwnershipResponse,
  ListOwnershipNoticeFailuresResponse,
  RetryOwnershipNoticeParams,
  RetryOwnershipNoticeResponse,
} from "@workspace/api-zod";
import {
  firmAccess,
  identify,
  logActivity,
  logAuditEvent,
  membershipFor,
  sendOwnershipTransferNotice,
  sendOwnershipTransferNotices,
  workspaceContext,
} from "../lib/clientguard-auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function isWorkspaceMembershipUniqueViolation(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;

  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const databaseError = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (
      databaseError.code === "23505" &&
      databaseError.constraint === "clientguard_membership_user_unique"
    ) {
      return true;
    }
    current = databaseError.cause;
  }

  return false;
}

router.get("/workspace", async (req, res): Promise<void> => {
  const identity = identify(req, res);
  if (!identity) return;
  const row = await membershipFor(identity.userId);
  res.json(GetWorkspaceResponse.parse(workspaceContext(identity, row)));
});

router.post("/workspace", async (req, res): Promise<void> => {
  const identity = identify(req, res);
  if (!identity) return;

  const parsed = CreateWorkspaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let created = false;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${identity.userId}))`);
      const [existing] = await tx
        .select({ id: membershipsTable.id })
        .from(membershipsTable)
        .where(eq(membershipsTable.clerkUserId, identity.userId))
        .limit(1);
      if (existing) return;

      const [workspace] = await tx
        .insert(workspacesTable)
        .values(parsed.data)
        .returning();
      await tx.insert(membershipsTable).values({
        workspaceId: workspace.id,
        clerkUserId: identity.userId,
        email: identity.email,
        displayName: identity.name || "Firm owner",
        role: "owner",
      });
      await tx.insert(activitiesTable).values({
        workspaceId: workspace.id,
        clerkUserId: identity.userId,
        actor: identity.name || identity.email || "Firm owner",
        action: "created the firm workspace",
        entityType: "workspace",
        entityId: workspace.id,
        entityLabel: workspace.name,
      });
      created = true;
    });
  } catch (error) {
    if (isWorkspaceMembershipUniqueViolation(error)) {
      res.status(409).json({
        error: "Your account joined a firm while setup was in progress. Refresh to continue.",
      });
      return;
    }
    throw error;
  }

  const row = await membershipFor(identity.userId);
  const response = CreateWorkspaceResponse.parse(workspaceContext(identity, row));
  res.status(created ? 201 : 200).json(response);
});

const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;

function canManageInvitations(role: string): boolean {
  return role === "owner" || role === "admin";
}

type OwnershipNoticeRole = "former_owner" | "new_owner";
type OwnershipNoticeStatus = "failed" | "sent";

function ownershipNoticeString(
  details: Record<string, string | number | boolean | null>,
  key: string,
): string | undefined {
  const value = details[key];
  return typeof value === "string" ? value : undefined;
}

function ownershipNoticeRole(value: string | undefined): OwnershipNoticeRole | undefined {
  return value === "former_owner" || value === "new_owner" ? value : undefined;
}

function ownershipNoticeStatus(value: string | undefined): OwnershipNoticeStatus | undefined {
  return value === "failed" || value === "sent" ? value : undefined;
}

function ownershipNoticeAuditDetails(input: {
  transferId: string;
  recipientRole: OwnershipNoticeRole;
  status: OwnershipNoticeStatus;
  workspaceName: string;
  previousOwner: { clerkUserId: string; displayName: string };
  newOwner: { clerkUserId: string; displayName: string };
}): Record<string, string> {
  return {
    transferId: input.transferId,
    recipientRole: input.recipientRole,
    status: input.status,
    workspaceName: input.workspaceName,
    previousOwnerId: input.previousOwner.clerkUserId,
    previousOwnerName: input.previousOwner.displayName,
    newOwnerId: input.newOwner.clerkUserId,
    newOwnerName: input.newOwner.displayName,
  };
}

function memberResponse(member: typeof membershipsTable.$inferSelect) {
  return {
    id: member.id,
    email: member.email,
    name: member.displayName,
    role: member.role,
    createdAt: member.createdAt,
  };
}

function assignmentLabels(member: typeof membershipsTable.$inferSelect): string[] {
  return [...new Set([member.displayName, member.email].filter((label) => label.trim()))];
}

function normalizedAssignmentLabel(label: string): string {
  return label.trim().toLocaleLowerCase();
}

async function backfillAssignmentIdentities(workspaceId: number): Promise<void> {
  const [members, clients, matters] = await Promise.all([
    db.select().from(membershipsTable).where(eq(membershipsTable.workspaceId, workspaceId)),
    db.select().from(clientsTable).where(
      and(eq(clientsTable.workspaceId, workspaceId), isNull(clientsTable.ownerMemberId)),
    ),
    db.select().from(mattersTable).where(
      and(eq(mattersTable.workspaceId, workspaceId), isNull(mattersTable.responsibleMemberId)),
    ),
  ]);
  const idsByLabel = new Map<string, Set<number>>();
  for (const member of members) {
    for (const label of assignmentLabels(member)) {
      const normalized = normalizedAssignmentLabel(label);
      const ids = idsByLabel.get(normalized) ?? new Set<number>();
      ids.add(member.id);
      idsByLabel.set(normalized, ids);
    }
  }

  for (const client of clients) {
    const ids = idsByLabel.get(normalizedAssignmentLabel(client.owner));
    if (ids?.size === 1) {
      await db.update(clientsTable)
        .set({ ownerMemberId: [...ids][0] })
        .where(and(
          eq(clientsTable.id, client.id),
          eq(clientsTable.workspaceId, workspaceId),
          isNull(clientsTable.ownerMemberId),
        ));
    }
  }
  for (const matter of matters) {
    const ids = idsByLabel.get(normalizedAssignmentLabel(matter.responsible));
    if (ids?.size === 1) {
      await db.update(mattersTable)
        .set({ responsibleMemberId: [...ids][0] })
        .where(and(
          eq(mattersTable.id, matter.id),
          eq(mattersTable.workspaceId, workspaceId),
          isNull(mattersTable.responsibleMemberId),
        ));
    }
  }
}

function memberLabelById(members: (typeof membershipsTable.$inferSelect)[]) {
  return new Map(members.map((member) => [
    member.id,
    member.displayName || member.email || "Firm teammate",
  ]));
}

router.get("/workspace/members", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  if (!canManageInvitations(access.role)) {
    res.status(403).json({ error: "Only firm owners and admins can view firm members." });
    return;
  }

  const members = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.workspaceId, access.workspaceId))
    .orderBy(desc(membershipsTable.createdAt), desc(membershipsTable.id));
  res.json(ListWorkspaceMembersResponse.parse(members.map(memberResponse)));
});

router.get("/workspace/assignment-members", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  const members = await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.workspaceId, access.workspaceId))
    .orderBy(asc(membershipsTable.displayName), asc(membershipsTable.id));
  res.json(members.map((member) => ({
    id: member.id,
    name: member.displayName,
    email: member.email,
    role: member.role,
  })));
});

router.get("/workspace/assignment-issues", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  if (!canManageInvitations(access.role)) {
    res.status(403).json({ error: "Only firm owners and admins can review unresolved assignments." });
    return;
  }
  await backfillAssignmentIdentities(access.workspaceId);
  const [clients, matters] = await Promise.all([
    db.select({ id: clientsTable.id, name: clientsTable.name, label: clientsTable.owner })
      .from(clientsTable)
      .where(and(
        eq(clientsTable.workspaceId, access.workspaceId),
        isNull(clientsTable.ownerMemberId),
      ))
      .orderBy(asc(clientsTable.name)),
    db.select({
      id: mattersTable.id,
      title: mattersTable.title,
      reference: mattersTable.reference,
      clientName: clientsTable.name,
      label: mattersTable.responsible,
    })
      .from(mattersTable)
      .innerJoin(clientsTable, and(
        eq(clientsTable.id, mattersTable.clientId),
        eq(clientsTable.workspaceId, access.workspaceId),
      ))
      .where(and(
        eq(mattersTable.workspaceId, access.workspaceId),
        isNull(mattersTable.responsibleMemberId),
      ))
      .orderBy(asc(mattersTable.reference)),
  ]);
  res.json({ clients, matters });
});

router.patch(
  "/workspace/assignment-issues/:entityType/:id/resolve",
  async (req, res): Promise<void> => {
    const access = await firmAccess(req, res);
    if (!access) return;
    if (!canManageInvitations(access.role)) {
      res.status(403).json({ error: "Only firm owners and admins can resolve legacy assignments." });
      return;
    }

    const params = ResolveWorkspaceAssignmentIssueParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = ResolveWorkspaceAssignmentIssueBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const { entityType, id } = params.data;
    const { memberId } = body.data;
    const result = await db.transaction(async (tx) => {
      const [member] = await tx
        .select()
        .from(membershipsTable)
        .where(and(
          eq(membershipsTable.id, memberId),
          eq(membershipsTable.workspaceId, access.workspaceId),
        ))
        .for("update")
        .limit(1);
      if (!member) return { kind: "member_missing" as const };

      const label = member.displayName || member.email || "Firm teammate";
      const actor = access.name || access.email || "Firm user";
      if (entityType === "client") {
        const [client] = await tx
          .select()
          .from(clientsTable)
          .where(and(
            eq(clientsTable.id, id),
            eq(clientsTable.workspaceId, access.workspaceId),
          ))
          .for("update")
          .limit(1);
        if (!client) return { kind: "issue_missing" as const };
        if (client.ownerMemberId !== null) return { kind: "already_resolved" as const };

        const [updated] = await tx
          .update(clientsTable)
          .set({ owner: label, ownerMemberId: member.id, updatedAt: new Date() })
          .where(and(
            eq(clientsTable.id, client.id),
            eq(clientsTable.workspaceId, access.workspaceId),
            isNull(clientsTable.ownerMemberId),
          ))
          .returning({ id: clientsTable.id });
        if (!updated) return { kind: "already_resolved" as const };
        await tx.insert(activitiesTable).values({
          workspaceId: access.workspaceId,
          clerkUserId: access.userId,
          actor,
          action: `resolved legacy client owner label to ${label}`,
          entityType: "client",
          entityId: client.id,
          entityLabel: client.name,
        });
      } else {
        const [matter] = await tx
          .select()
          .from(mattersTable)
          .where(and(
            eq(mattersTable.id, id),
            eq(mattersTable.workspaceId, access.workspaceId),
          ))
          .for("update")
          .limit(1);
        if (!matter) return { kind: "issue_missing" as const };
        if (matter.responsibleMemberId !== null) return { kind: "already_resolved" as const };

        const [updated] = await tx
          .update(mattersTable)
          .set({ responsible: label, responsibleMemberId: member.id, updatedAt: new Date() })
          .where(and(
            eq(mattersTable.id, matter.id),
            eq(mattersTable.workspaceId, access.workspaceId),
            isNull(mattersTable.responsibleMemberId),
          ))
          .returning({ id: mattersTable.id });
        if (!updated) return { kind: "already_resolved" as const };
        await tx.insert(activitiesTable).values({
          workspaceId: access.workspaceId,
          clerkUserId: access.userId,
          actor,
          action: `resolved legacy matter responsibility label to ${label}`,
          entityType: "matter",
          entityId: matter.id,
          entityLabel: matter.title,
        });
      }

      return { kind: "resolved" as const, entityType, id, memberId: member.id, label };
    });

    if (result.kind === "member_missing") {
      res.status(400).json({ error: "Select an active teammate in this firm." });
      return;
    }
    if (result.kind === "issue_missing") {
      res.status(404).json({ error: "That unresolved assignment could not be found in this firm." });
      return;
    }
    if (result.kind === "already_resolved") {
      res.status(409).json({ error: "This assignment has changed. Refresh the review queue and try again." });
      return;
    }

    res.json(ResolveWorkspaceAssignmentIssueResponse.parse(result));
  },
);

router.get("/workspace/membership-conflicts", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  if (!canManageInvitations(access.role)) {
    res.status(403).json({ error: "Only firm owners and admins can review membership conflicts." });
    return;
  }

  const groups = await db
    .select({
      clerkUserId: membershipsTable.clerkUserId,
      membershipCount: count(),
      firmCount: sql<number>`count(distinct ${membershipsTable.workspaceId})`,
    })
    .from(membershipsTable)
    .groupBy(membershipsTable.clerkUserId)
    .having(sql`count(*) > 1`);
  if (!groups.length) {
    res.json(ListWorkspaceMembershipConflictsResponse.parse([]));
    return;
  }

  const groupByUserId = new Map(groups.map((group) => [group.clerkUserId, group]));
  const localMembers = await db
    .select()
    .from(membershipsTable)
    .where(
      and(
        eq(membershipsTable.workspaceId, access.workspaceId),
        inArray(membershipsTable.clerkUserId, groups.map((group) => group.clerkUserId)),
      ),
    )
    .orderBy(asc(membershipsTable.displayName), asc(membershipsTable.id));
  if (!localMembers.length) {
    res.json(ListWorkspaceMembershipConflictsResponse.parse([]));
    return;
  }

  const reviews = await db
    .select()
    .from(auditEventsTable)
    .where(
      and(
        eq(auditEventsTable.workspaceId, access.workspaceId),
        eq(auditEventsTable.entityType, "membership_access_conflict"),
        inArray(auditEventsTable.entityId, localMembers.map((member) => member.id)),
      ),
    )
    .orderBy(desc(auditEventsTable.occurredAt), desc(auditEventsTable.id));
  const latestReviewByMembership = new Map<
    number,
    (typeof reviews)[number]
  >();
  for (const review of reviews) {
    if (review.entityId !== null && !latestReviewByMembership.has(review.entityId)) {
      latestReviewByMembership.set(review.entityId, review);
    }
  }

  const localMembershipCountByUserId = new Map<string, number>();
  for (const member of localMembers) {
    localMembershipCountByUserId.set(
      member.clerkUserId,
      (localMembershipCountByUserId.get(member.clerkUserId) ?? 0) + 1,
    );
  }

  const conflicts = localMembers.map((member) => {
    const group = groupByUserId.get(member.clerkUserId)!;
    const review = latestReviewByMembership.get(member.id);
    const decision = review?.details.decision;
    const localCount = localMembershipCountByUserId.get(member.clerkUserId) ?? 1;
    return {
      membershipId: member.id,
      memberName: member.displayName || member.email || "Unnamed teammate",
      email: member.email,
      role: member.role,
      firmName: access.workspaceName,
      otherFirmCount: Math.max(0, Number(group.firmCount) - 1),
      otherMembershipCount: Math.max(0, Number(group.membershipCount) - localCount),
      lastDecision: decision === "retain" || decision === "remove" ? decision : null,
      lastDecisionBy: review?.actor ?? null,
      lastDecisionAt: review?.occurredAt?.toISOString() ?? null,
      lastDecisionReason:
        typeof review?.details.reason === "string" ? review.details.reason : null,
    };
  });

  res.json(ListWorkspaceMembershipConflictsResponse.parse(conflicts));
});

router.post(
  "/workspace/membership-conflicts/:id/decision",
  async (req, res): Promise<void> => {
    const access = await firmAccess(req, res);
    if (!access) return;
    if (!canManageInvitations(access.role)) {
      res.status(403).json({ error: "Only firm owners and admins can decide membership conflicts." });
      return;
    }

    const params = ResolveWorkspaceMembershipConflictParams.safeParse(req.params);
    const body = ResolveWorkspaceMembershipConflictBody.safeParse(req.body);
    if (!params.success || !body.success || body.data.reason.trim().length < 3) {
      res.status(400).json({
        error: "Provide a valid decision and a reason of at least three non-space characters.",
        details: !params.success ? params.error.flatten() : !body.success ? body.error.flatten() : undefined,
      });
      return;
    }
    if (body.data.decision === "retain" && body.data.replacementMemberId !== undefined) {
      res.status(400).json({ error: "A replacement teammate is only used when removing access." });
      return;
    }

    await backfillAssignmentIdentities(access.workspaceId);
    const result = await db.transaction(async (tx) => {
      const [candidate] = await tx
        .select()
        .from(membershipsTable)
        .where(
          and(
            eq(membershipsTable.id, params.data.id),
            eq(membershipsTable.workspaceId, access.workspaceId),
          ),
        )
        .limit(1);
      if (!candidate) return { kind: "member_missing" as const };

      const duplicateMemberships = await tx
        .select()
        .from(membershipsTable)
        .where(eq(membershipsTable.clerkUserId, candidate.clerkUserId))
        .orderBy(asc(membershipsTable.id))
        .for("update");
      const member = duplicateMemberships.find(
        (row) =>
          row.id === params.data.id &&
          row.workspaceId === access.workspaceId,
      );
      if (!member) return { kind: "member_missing" as const };
      if (duplicateMemberships.length < 2) {
        return { kind: "conflict_gone" as const };
      }

      let replacementMemberId: number | null = null;
      if (body.data.decision === "remove") {
        if (member.role === "owner") return { kind: "owner_protected" as const };
        if (member.clerkUserId === access.userId) return { kind: "self_removal" as const };

        const labels = assignmentLabels(member);
        const assignedClients = await tx
          .select()
          .from(clientsTable)
          .where(
            and(
              eq(clientsTable.workspaceId, access.workspaceId),
            eq(clientsTable.ownerMemberId, member.id),
            ),
          )
          .for("update");
        const assignedMatters = await tx
          .select()
          .from(mattersTable)
          .where(
            and(
              eq(mattersTable.workspaceId, access.workspaceId),
            eq(mattersTable.responsibleMemberId, member.id),
            ),
          )
          .for("update");
        const assignedIntakes = await tx
          .select()
          .from(intakesTable)
          .where(
            and(
              eq(intakesTable.workspaceId, access.workspaceId),
              eq(intakesTable.responsibleMemberId, member.id),
              inArray(intakesTable.status, ["review_required", "cleared"]),
            ),
          )
          .for("update");
      const [unresolvedClient, unresolvedMatter] = await Promise.all([
        tx.select({ id: clientsTable.id }).from(clientsTable).where(and(
          eq(clientsTable.workspaceId, access.workspaceId),
          isNull(clientsTable.ownerMemberId),
          inArray(clientsTable.owner, labels),
        )).limit(1),
        tx.select({ id: mattersTable.id }).from(mattersTable).where(and(
          eq(mattersTable.workspaceId, access.workspaceId),
          isNull(mattersTable.responsibleMemberId),
          inArray(mattersTable.responsible, labels),
        )).limit(1),
      ]);
      if (unresolvedClient.length || unresolvedMatter.length) {
        return { kind: "unresolved_assignments" as const };
      }
        if (
          (assignedClients.length || assignedMatters.length || assignedIntakes.length) &&
          body.data.replacementMemberId === undefined
        ) {
          return {
            kind: "replacement_required" as const,
            assignedClientCount: assignedClients.length,
            assignedMatterCount: assignedMatters.length,
            assignedIntakeCount: assignedIntakes.length,
          };
        }

        if (body.data.replacementMemberId !== undefined) {
          const [replacement] = await tx
            .select()
            .from(membershipsTable)
            .where(
              and(
                eq(membershipsTable.id, body.data.replacementMemberId),
                eq(membershipsTable.workspaceId, access.workspaceId),
              ),
            )
            .for("update");
          if (
            !replacement ||
            replacement.id === member.id ||
            replacement.clerkUserId === member.clerkUserId
          ) {
            return { kind: "replacement_invalid" as const };
          }
          replacementMemberId = replacement.id;
          const replacementLabel =
            replacement.displayName || replacement.email || "Firm teammate";
          if (assignedClients.length) {
            await tx
              .update(clientsTable)
              .set({ owner: replacementLabel, ownerMemberId: replacement.id, updatedAt: new Date() })
              .where(
                and(
                  eq(clientsTable.workspaceId, access.workspaceId),
                  inArray(
                    clientsTable.id,
                    assignedClients.map((client) => client.id),
                  ),
                ),
              );
          }
          if (assignedMatters.length) {
            await tx
              .update(mattersTable)
              .set({ responsible: replacementLabel, responsibleMemberId: replacement.id, updatedAt: new Date() })
              .where(
                and(
                  eq(mattersTable.workspaceId, access.workspaceId),
                  inArray(
                    mattersTable.id,
                    assignedMatters.map((matter) => matter.id),
                  ),
                ),
              );
          }
          if (assignedIntakes.length) {
            await tx
              .update(intakesTable)
              .set({
                responsible: replacementLabel,
                responsibleMemberId: replacement.id,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(intakesTable.workspaceId, access.workspaceId),
                  inArray(
                    intakesTable.id,
                    assignedIntakes.map((intake) => intake.id),
                  ),
                ),
              );
          }

          const actor = access.name || access.email || "Firm user";
          const previousLabel = member.displayName || member.email;
          if (assignedClients.length) {
            await tx.insert(activitiesTable).values(
              assignedClients.map((client) => ({
                workspaceId: access.workspaceId,
                clerkUserId: access.userId,
                actor,
                action: `reassigned client ownership from ${previousLabel} to ${replacementLabel}`,
                entityType: "client",
                entityId: client.id,
                entityLabel: client.name,
              })),
            );
          }
          if (assignedMatters.length) {
            await tx.insert(activitiesTable).values(
              assignedMatters.map((matter) => ({
                workspaceId: access.workspaceId,
                clerkUserId: access.userId,
                actor,
                action: `reassigned matter responsibility from ${previousLabel} to ${replacementLabel}`,
                entityType: "matter",
                entityId: matter.id,
                entityLabel: matter.title,
              })),
            );
          }
          if (assignedIntakes.length) {
            await tx.insert(activitiesTable).values(
              assignedIntakes.map((intake) => ({
                workspaceId: access.workspaceId,
                clerkUserId: access.userId,
                actor,
                action: `reassigned intake responsibility from ${previousLabel} to ${replacementLabel}`,
                entityType: "intake",
                entityId: intake.id,
                entityLabel: intake.matterTitle,
              })),
            );
          }
        }

        await tx
          .delete(membershipsTable)
          .where(
            and(
              eq(membershipsTable.id, member.id),
              eq(membershipsTable.workspaceId, access.workspaceId),
            ),
          );
      }

      const [review] = await tx
        .insert(auditEventsTable)
        .values({
          workspaceId: access.workspaceId,
          clerkUserId: access.userId,
          actor: access.name || access.email || "Firm user",
          action:
            body.data.decision === "remove"
              ? "membership_access_conflict_removed"
              : "membership_access_conflict_retained",
          entityType: "membership_access_conflict",
          entityId: member.id,
          entityLabel: member.displayName || member.email || "Unnamed teammate",
          details: {
            membershipId: member.id,
            decision: body.data.decision,
            reason: body.data.reason.trim(),
            replacementMemberId,
          },
        })
        .returning();

      if (body.data.decision === "remove") {
        await tx.insert(activitiesTable).values({
          workspaceId: access.workspaceId,
          clerkUserId: access.userId,
          actor: access.name || access.email || "Firm user",
          action: "removed after reviewing duplicate firm access",
          entityType: "membership",
          entityId: member.id,
          entityLabel: member.displayName || member.email || "Unnamed teammate",
        });
      }

      const [remaining] = await tx
        .select({ count: count() })
        .from(membershipsTable)
        .where(eq(membershipsTable.clerkUserId, member.clerkUserId));
      return {
        kind: "recorded" as const,
        membershipId: member.id,
        decision: body.data.decision,
        decidedAt: review.occurredAt,
        remainingMembershipCount: Number(remaining?.count ?? 0),
      };
    });

    if (result.kind === "member_missing") {
      res.status(404).json({ error: "That membership is not part of this firm." });
      return;
    }
    if (result.kind === "conflict_gone") {
      res.status(404).json({ error: "This membership no longer has a duplicate access conflict." });
      return;
    }
    if (result.kind === "owner_protected") {
      res.status(409).json({
        error: "Transfer firm ownership before removing the current firm owner.",
        code: "firm_owner_protected",
      });
      return;
    }
    if (result.kind === "unresolved_assignments") {
      res.status(409).json({
        error: "Resolve legacy assignment labels in the Team page before removing this teammate.",
        code: "unresolved_assignments",
      });
      return;
    }
    if (result.kind === "self_removal") {
      res.status(409).json({
        error: "You cannot remove your own firm access through conflict review.",
        code: "self_removal_protected",
      });
      return;
    }
    if (result.kind === "replacement_required") {
      res.status(409).json({
        error: "Assigned clients, matters, and pending intakes need an active teammate before access is removed.",
        code: "membership_assignments_replacement_required",
        assignedClientCount: result.assignedClientCount,
        assignedMatterCount: result.assignedMatterCount,
        assignedIntakeCount: result.assignedIntakeCount,
      });
      return;
    }
    if (result.kind === "replacement_invalid") {
      res.status(400).json({
        error: "Choose a different active teammate in this firm to take assigned work.",
        code: "invalid_replacement_member",
      });
      return;
    }

    res.json(
      ResolveWorkspaceMembershipConflictResponse.parse({
        membershipId: result.membershipId,
        decision: result.decision,
        accessRemoved: result.decision === "remove",
        remainingMembershipCount: result.remainingMembershipCount,
        decidedAt: result.decidedAt.toISOString(),
      }),
    );
  },
);

router.get(
  "/workspace/members/:id/assignments",
  async (req, res): Promise<void> => {
    const access = await firmAccess(req, res);
    if (!access) return;
    if (!canManageInvitations(access.role)) {
      res.status(403).json({ error: "Only firm owners and admins can view member assignments." });
      return;
    }

    const params = GetWorkspaceMemberAssignmentsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [member] = await db
      .select()
      .from(membershipsTable)
      .where(
        and(
          eq(membershipsTable.id, params.data.id),
          eq(membershipsTable.workspaceId, access.workspaceId),
        ),
      )
      .limit(1);
    if (!member) {
      res.status(404).json({ error: "That member could not be found in your firm." });
      return;
    }

    await backfillAssignmentIdentities(access.workspaceId);
    const labels = assignmentLabels(member);
    const [clients, matters, intakes, unresolvedClients, unresolvedMatters] = await Promise.all([
      db
        .select({ id: clientsTable.id, name: clientsTable.name })
        .from(clientsTable)
        .where(
          and(
            eq(clientsTable.workspaceId, access.workspaceId),
            eq(clientsTable.ownerMemberId, member.id),
          ),
        )
        .orderBy(clientsTable.name),
      db
        .select({ id: mattersTable.id, title: mattersTable.title, reference: mattersTable.reference, clientName: clientsTable.name })
        .from(mattersTable)
        .innerJoin(clientsTable, and(
          eq(clientsTable.id, mattersTable.clientId),
          eq(clientsTable.workspaceId, access.workspaceId),
        ))
        .where(and(
          eq(mattersTable.workspaceId, access.workspaceId),
          eq(mattersTable.responsibleMemberId, member.id),
        ))
        .orderBy(mattersTable.reference),
      db
        .select({
          id: intakesTable.id,
          clientName: intakesTable.clientName,
          matterTitle: intakesTable.matterTitle,
          status: intakesTable.status,
        })
        .from(intakesTable)
        .where(
          and(
            eq(intakesTable.workspaceId, access.workspaceId),
            eq(intakesTable.responsibleMemberId, member.id),
            inArray(intakesTable.status, ["review_required", "cleared"]),
          ),
        )
        .orderBy(intakesTable.createdAt, intakesTable.id),
      db
        .select({ id: clientsTable.id, name: clientsTable.name, label: clientsTable.owner })
        .from(clientsTable)
        .where(and(
          eq(clientsTable.workspaceId, access.workspaceId),
          isNull(clientsTable.ownerMemberId),
          inArray(clientsTable.owner, labels),
        ))
        .orderBy(clientsTable.name),
      db
        .select({
          id: mattersTable.id,
          title: mattersTable.title,
          reference: mattersTable.reference,
          clientName: clientsTable.name,
          label: mattersTable.responsible,
        })
        .from(mattersTable)
        .innerJoin(
          clientsTable,
          and(
            eq(clientsTable.id, mattersTable.clientId),
            eq(clientsTable.workspaceId, access.workspaceId),
          ),
        )
        .where(
          and(
            eq(mattersTable.workspaceId, access.workspaceId),
            isNull(mattersTable.responsibleMemberId),
            inArray(mattersTable.responsible, labels),
          ),
        )
        .orderBy(mattersTable.reference),
    ]);

    res.json(
      GetWorkspaceMemberAssignmentsResponse.parse({ clients, matters, intakes, unresolvedClients, unresolvedMatters }),
    );
  },
);

router.patch("/workspace/members/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  if (!canManageInvitations(access.role)) {
    res.status(403).json({ error: "Only firm owners and admins can update firm members." });
    return;
  }

  const params = UpdateWorkspaceMemberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateWorkspaceMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [member] = await tx
      .select()
      .from(membershipsTable)
      .where(
        and(
          eq(membershipsTable.id, params.data.id),
          eq(membershipsTable.workspaceId, access.workspaceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!member) return { kind: "missing" as const };
    if (member.role === "owner") {
      return { kind: "owner" as const };
    }

    if (member.role === parsed.data.role) {
      return { kind: "updated" as const, member };
    }

    const [updated] = await tx
      .update(membershipsTable)
      .set({ role: parsed.data.role })
      .where(eq(membershipsTable.id, member.id))
      .returning();
    await tx.insert(activitiesTable).values({
      workspaceId: access.workspaceId,
      clerkUserId: access.userId,
      actor: access.name || access.email || "Firm user",
      action: `changed ${member.displayName || member.email}'s role from ${member.role} to ${updated.role}`,
      entityType: "workspace",
      entityId: access.workspaceId,
      entityLabel: member.displayName || member.email,
    });
    return { kind: "updated" as const, member: updated };
  });

  if (result.kind !== "updated") {
    res.status(404).json({ error: "That member could not be found in your firm." });
    return;
  }
  res.json(UpdateWorkspaceMemberResponse.parse(memberResponse(result.member)));
});

router.post(
  "/workspace/members/:id/transfer-ownership",
  async (req, res): Promise<void> => {
    const access = await firmAccess(req, res);
    if (!access) return;
    if (access.role !== "owner") {
      res.status(403).json({ error: "Only the current firm owner can transfer ownership." });
      return;
    }

    const params = TransferWorkspaceOwnershipParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const transferId = randomUUID();
    const result = await db.transaction(async (tx) => {
      const members = await tx
        .select()
        .from(membershipsTable)
        .where(eq(membershipsTable.workspaceId, access.workspaceId))
        .orderBy(membershipsTable.id)
        .for("update");
      const currentOwner = members.find(
        (member) =>
          member.clerkUserId === access.userId && member.role === "owner",
      );
      if (!currentOwner) return { kind: "not-owner" as const };

      const newOwner = members.find(
        (member) => member.id === params.data.id,
      );
      if (!newOwner) return { kind: "missing" as const };
      if (newOwner.clerkUserId === access.userId) {
        return { kind: "self" as const };
      }

      await tx
        .update(membershipsTable)
        .set({ role: "admin" })
        .where(
          and(
            eq(membershipsTable.workspaceId, access.workspaceId),
            eq(membershipsTable.role, "owner"),
          ),
        );
      const [updatedOwner] = await tx
        .update(membershipsTable)
        .set({ role: "owner" })
        .where(
          and(
            eq(membershipsTable.id, newOwner.id),
            eq(membershipsTable.workspaceId, access.workspaceId),
          ),
        )
        .returning();

      await tx.insert(activitiesTable).values({
        workspaceId: access.workspaceId,
        clerkUserId: access.userId,
        actor: access.name || access.email || "Firm user",
        action: `transferred firm ownership from ${currentOwner.displayName || currentOwner.email} to ${newOwner.displayName || newOwner.email}`,
        entityType: "workspace",
        entityId: access.workspaceId,
        entityLabel: access.workspaceName,
      });

      return {
        kind: "transferred" as const,
        member: updatedOwner,
        previousOwner: currentOwner,
      };
    });

    if (result.kind === "not-owner") {
      res.status(403).json({ error: "Only the current firm owner can transfer ownership." });
      return;
    }
    if (result.kind === "missing") {
      res.status(404).json({ error: "That member could not be found in your firm." });
      return;
    }
    if (result.kind === "self") {
      res.status(400).json({ error: "Choose another active firm member to receive ownership." });
      return;
    }
    const noticeResults = await sendOwnershipTransferNotices({
      transferId,
      workspaceName: access.workspaceName,
      previousOwner: {
        clerkUserId: result.previousOwner.clerkUserId,
        displayName: result.previousOwner.displayName || result.previousOwner.email,
      },
      newOwner: {
        clerkUserId: result.member.clerkUserId,
        displayName: result.member.displayName || result.member.email,
      },
    });
    const previousOwner = {
      clerkUserId: result.previousOwner.clerkUserId,
      displayName: result.previousOwner.displayName || result.previousOwner.email,
    };
    const newOwner = {
      clerkUserId: result.member.clerkUserId,
      displayName: result.member.displayName || result.member.email,
    };
    for (const notice of noticeResults) {
      if (notice.error) {
        logger.warn(
          {
            workspaceId: access.workspaceId,
            recipientRole: notice.recipientRole,
            err: notice.error,
          },
          "Could not send firm ownership transfer notice",
        );
      }
    }
    try {
      await Promise.all(
        noticeResults.map((notice) =>
          logAuditEvent(
            access,
            "ownership_notice_delivery",
            "workspace",
            access.workspaceId,
            access.workspaceName,
            ownershipNoticeAuditDetails({
              transferId,
              recipientRole: notice.recipientRole,
              status: notice.error ? "failed" : "sent",
              workspaceName: access.workspaceName,
              previousOwner,
              newOwner,
            }),
          ),
        ),
      );
    } catch (error) {
      logger.warn(
        { workspaceId: access.workspaceId, transferId, err: error },
        "Could not record firm ownership notice delivery results",
      );
    }
    res.json(TransferWorkspaceOwnershipResponse.parse(memberResponse(result.member)));
  },
);

router.get("/workspace/ownership-notices", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;

  const events = await db
    .select()
    .from(auditEventsTable)
    .where(
      and(
        eq(auditEventsTable.workspaceId, access.workspaceId),
        eq(auditEventsTable.action, "ownership_notice_delivery"),
      ),
    )
    .orderBy(desc(auditEventsTable.occurredAt), desc(auditEventsTable.id));
  const latestByNotice = new Map<string, (typeof events)[number]>();

  for (const event of events) {
    const transferId = ownershipNoticeString(event.details, "transferId");
    const recipientRole = ownershipNoticeRole(
      ownershipNoticeString(event.details, "recipientRole"),
    );
    if (!transferId || !recipientRole) continue;
    const key = `${transferId}:${recipientRole}`;
    if (!latestByNotice.has(key)) latestByNotice.set(key, event);
  }

  const failures = [...latestByNotice.values()].flatMap((event) => {
    const transferId = ownershipNoticeString(event.details, "transferId");
    const recipientRole = ownershipNoticeRole(
      ownershipNoticeString(event.details, "recipientRole"),
    );
    const status = ownershipNoticeStatus(
      ownershipNoticeString(event.details, "status"),
    );
    const recipientName = ownershipNoticeString(
      event.details,
      recipientRole === "former_owner" ? "previousOwnerName" : "newOwnerName",
    );
    const otherOwnerName = ownershipNoticeString(
      event.details,
      recipientRole === "former_owner" ? "newOwnerName" : "previousOwnerName",
    );
    if (
      !transferId ||
      !recipientRole ||
      status !== "failed" ||
      !recipientName ||
      !otherOwnerName
    ) {
      return [];
    }
    return [{
      transferId,
      recipientRole,
      recipientName,
      otherOwnerName,
      failedAt: event.occurredAt,
    }];
  });

  res.json(ListOwnershipNoticeFailuresResponse.parse(failures));
});

router.post(
  "/workspace/ownership-notices/:transferId/:recipientRole/retry",
  async (req, res): Promise<void> => {
    const access = await firmAccess(req, res);
    if (!access) return;
    if (!canManageInvitations(access.role)) {
      res.status(403).json({ error: "Only firm owners and admins can retry ownership notices." });
      return;
    }

    const params = RetryOwnershipNoticeParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const events = await db
      .select()
      .from(auditEventsTable)
      .where(
        and(
          eq(auditEventsTable.workspaceId, access.workspaceId),
          eq(auditEventsTable.action, "ownership_notice_delivery"),
        ),
      )
      .orderBy(desc(auditEventsTable.occurredAt), desc(auditEventsTable.id));
    const latestEvent = events.find(
      (event) =>
        ownershipNoticeString(event.details, "transferId") ===
          params.data.transferId &&
        ownershipNoticeRole(
          ownershipNoticeString(event.details, "recipientRole"),
        ) === params.data.recipientRole,
    );

    if (!latestEvent) {
      res.status(404).json({ error: "That failed ownership notice was not found in your firm." });
      return;
    }
    if (
      ownershipNoticeStatus(
        ownershipNoticeString(latestEvent.details, "status"),
      ) !== "failed"
    ) {
      res.status(409).json({ error: "That ownership notice is no longer awaiting delivery." });
      return;
    }

    const previousOwnerId = ownershipNoticeString(
      latestEvent.details,
      "previousOwnerId",
    );
    const previousOwnerName = ownershipNoticeString(
      latestEvent.details,
      "previousOwnerName",
    );
    const newOwnerId = ownershipNoticeString(latestEvent.details, "newOwnerId");
    const newOwnerName = ownershipNoticeString(
      latestEvent.details,
      "newOwnerName",
    );
    const workspaceName = ownershipNoticeString(
      latestEvent.details,
      "workspaceName",
    );
    if (
      !previousOwnerId ||
      !previousOwnerName ||
      !newOwnerId ||
      !newOwnerName ||
      !workspaceName
    ) {
      res.status(404).json({ error: "That failed ownership notice could not be recovered." });
      return;
    }

    const previousOwner = {
      clerkUserId: previousOwnerId,
      displayName: previousOwnerName,
    };
    const newOwner = { clerkUserId: newOwnerId, displayName: newOwnerName };
    const delivery = await sendOwnershipTransferNotice({
      transferId: params.data.transferId,
      workspaceName,
      previousOwner,
      newOwner,
      recipientRole: params.data.recipientRole,
    });
    const status = delivery.error ? "failed" : "sent";
    try {
      await logAuditEvent(
        access,
        "ownership_notice_delivery",
        "workspace",
        access.workspaceId,
        access.workspaceName,
        ownershipNoticeAuditDetails({
          transferId: params.data.transferId,
          recipientRole: params.data.recipientRole,
          status,
          workspaceName,
          previousOwner,
          newOwner,
        }),
      );
    } catch (error) {
      logger.warn(
        {
          workspaceId: access.workspaceId,
          transferId: params.data.transferId,
          recipientRole: params.data.recipientRole,
          err: error,
        },
        "Could not record firm ownership notice retry result",
      );
    }

    if (delivery.error) {
      logger.warn(
        {
          workspaceId: access.workspaceId,
          transferId: params.data.transferId,
          recipientRole: params.data.recipientRole,
          err: delivery.error,
        },
        "Could not retry firm ownership transfer notice",
      );
      res.status(502).json({ error: "The ownership notice could not be sent. You can try again." });
      return;
    }
    res.json(RetryOwnershipNoticeResponse.parse({ sent: true }));
  },
);

router.delete("/workspace/members/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  if (!canManageInvitations(access.role)) {
    res.status(403).json({ error: "Only firm owners and admins can remove firm members." });
    return;
  }

  const params = RemoveWorkspaceMemberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsedBody = RemoveWorkspaceMemberBody.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.message });
    return;
  }

  await backfillAssignmentIdentities(access.workspaceId);
  const result = await db.transaction(async (tx) => {
    const members = await tx
      .select()
      .from(membershipsTable)
      .where(eq(membershipsTable.workspaceId, access.workspaceId))
      .orderBy(membershipsTable.id)
      .for("update");
    const member = members.find((candidate) => candidate.id === params.data.id);
    if (!member) return "missing" as const;
    if (member.role === "owner") {
      return "owner" as const;
    }

    const labels = assignmentLabels(member);
    const clients = await tx
      .select()
      .from(clientsTable)
      .where(
        and(
          eq(clientsTable.workspaceId, access.workspaceId),
          eq(clientsTable.ownerMemberId, member.id),
        ),
      )
      .for("update");
    const matters = await tx
      .select()
      .from(mattersTable)
      .where(
        and(
          eq(mattersTable.workspaceId, access.workspaceId),
          eq(mattersTable.responsibleMemberId, member.id),
        ),
      )
      .for("update");
    const intakes = await tx
      .select()
      .from(intakesTable)
      .where(
        and(
          eq(intakesTable.workspaceId, access.workspaceId),
          eq(intakesTable.responsibleMemberId, member.id),
          inArray(intakesTable.status, ["review_required", "cleared"]),
        ),
      )
      .for("update");
    const [unresolvedClient, unresolvedMatter] = await Promise.all([
      tx.select({ id: clientsTable.id }).from(clientsTable).where(and(
        eq(clientsTable.workspaceId, access.workspaceId),
        isNull(clientsTable.ownerMemberId),
        inArray(clientsTable.owner, labels),
      )).limit(1),
      tx.select({ id: mattersTable.id }).from(mattersTable).where(and(
        eq(mattersTable.workspaceId, access.workspaceId),
        isNull(mattersTable.responsibleMemberId),
        inArray(mattersTable.responsible, labels),
      )).limit(1),
    ]);
    if (unresolvedClient.length || unresolvedMatter.length) {
      return "unresolved-assignments" as const;
    }

    const replacementId = parsedBody.data.replacementMemberId;
    if ((clients.length || matters.length || intakes.length) && replacementId === undefined) {
      return "replacement-required" as const;
    }

    if (replacementId !== undefined) {
      const replacement = members.find((candidate) => candidate.id === replacementId);
      if (!replacement) return "replacement-missing" as const;
      if (replacement.id === member.id) return "replacement-self" as const;

      const replacementLabel =
        replacement.displayName || replacement.email || "Firm teammate";
      if (clients.length) {
        await tx
          .update(clientsTable)
          .set({ owner: replacementLabel, ownerMemberId: replacement.id })
          .where(
            and(
              eq(clientsTable.workspaceId, access.workspaceId),
              inArray(
                clientsTable.id,
                clients.map((client) => client.id),
              ),
            ),
          );
      }
      if (matters.length) {
        await tx
          .update(mattersTable)
          .set({ responsible: replacementLabel, responsibleMemberId: replacement.id })
          .where(
            and(
              eq(mattersTable.workspaceId, access.workspaceId),
              inArray(
                mattersTable.id,
                matters.map((matter) => matter.id),
              ),
            ),
          );
      }
      if (intakes.length) {
        await tx
          .update(intakesTable)
          .set({
            responsible: replacementLabel,
            responsibleMemberId: replacement.id,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(intakesTable.workspaceId, access.workspaceId),
              inArray(
                intakesTable.id,
                intakes.map((intake) => intake.id),
              ),
            ),
          );
      }

      const actor = access.name || access.email || "Firm user";
      const previousLabel = member.displayName || member.email;
      if (clients.length) {
        await tx.insert(activitiesTable).values(
          clients.map((client) => ({
            workspaceId: access.workspaceId,
            clerkUserId: access.userId,
            actor,
            action: `reassigned client ownership from ${previousLabel} to ${replacementLabel}`,
            entityType: "client",
            entityId: client.id,
            entityLabel: client.name,
          })),
        );
      }
      if (matters.length) {
        await tx.insert(activitiesTable).values(
          matters.map((matter) => ({
            workspaceId: access.workspaceId,
            clerkUserId: access.userId,
            actor,
            action: `reassigned matter responsibility from ${previousLabel} to ${replacementLabel}`,
            entityType: "matter",
            entityId: matter.id,
            entityLabel: matter.title,
          })),
        );
      }
      if (intakes.length) {
        await tx.insert(activitiesTable).values(
          intakes.map((intake) => ({
            workspaceId: access.workspaceId,
            clerkUserId: access.userId,
            actor,
            action: `reassigned intake responsibility from ${previousLabel} to ${replacementLabel}`,
            entityType: "intake",
            entityId: intake.id,
            entityLabel: intake.matterTitle,
          })),
        );
      }
    }

    await tx.delete(membershipsTable).where(eq(membershipsTable.id, member.id));
    await tx.insert(activitiesTable).values({
      workspaceId: access.workspaceId,
      clerkUserId: access.userId,
      actor: access.name || access.email || "Firm user",
      action: `removed ${member.displayName || member.email} from the firm workspace`,
      entityType: "workspace",
      entityId: access.workspaceId,
      entityLabel: member.displayName || member.email,
    });
    return "removed" as const;
  });

  if (result === "replacement-required") {
    res.status(409).json({
      error: "Select an active firm member to take over this person's assigned clients, matters, and pending intakes.",
    });
    return;
  }
  if (result === "unresolved-assignments") {
    res.status(409).json({
      error: "Resolve legacy assignment labels in the Team page before removing this teammate.",
      code: "unresolved_assignments",
    });
    return;
  }
  if (result === "replacement-missing") {
    res.status(404).json({ error: "The selected replacement is no longer an active firm member." });
    return;
  }
  if (result === "replacement-self") {
    res.status(400).json({ error: "Choose another firm member to take over these assignments." });
    return;
  }
  if (result !== "removed") {
    res.status(404).json({ error: "That member could not be found in your firm." });
    return;
  }
  res.sendStatus(204);
});

function invitationResponse(
  invitation: Pick<
    typeof invitationsTable.$inferSelect,
    | "id"
    | "email"
    | "role"
    | "createdAt"
    | "expiresAt"
    | "revokedAt"
    | "providerRevocationFailed"
  >,
) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    expired: invitation.expiresAt <= new Date(),
    revoked: invitation.revokedAt !== null,
    providerRevocationFailed: invitation.providerRevocationFailed,
  };
}

router.get("/workspace/invitations", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  if (!canManageInvitations(access.role)) {
    res.status(403).json({ error: "Only firm owners and admins can view invitations." });
    return;
  }

  const invitations = await db
    .select({
      id: invitationsTable.id,
      email: invitationsTable.email,
      role: invitationsTable.role,
      createdAt: invitationsTable.createdAt,
      expiresAt: invitationsTable.expiresAt,
      revokedAt: invitationsTable.revokedAt,
      providerRevocationFailed: invitationsTable.providerRevocationFailed,
    })
    .from(invitationsTable)
    .where(
      and(
        eq(invitationsTable.workspaceId, access.workspaceId),
        isNull(invitationsTable.acceptedAt),
        or(
          isNull(invitationsTable.revokedAt),
          eq(invitationsTable.providerRevocationFailed, true),
        ),
      ),
    )
    .orderBy(desc(invitationsTable.createdAt));
  res.json(
    ListWorkspaceInvitationsResponse.parse(invitations.map(invitationResponse)),
  );
});

router.post("/workspace/invitations", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  if (!canManageInvitations(access.role)) {
    res.status(403).json({ error: "Only firm owners and admins can invite teammates." });
    return;
  }

  const parsed = CreateWorkspaceInvitationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const [existingMember] = await db
    .select({ id: membershipsTable.id })
    .from(membershipsTable)
    .where(sql`lower(${membershipsTable.email}) = ${email}`)
    .limit(1);
  if (existingMember) {
    res.status(409).json({ error: "That email address already belongs to a firm member." });
    return;
  }

  const token = randomUUID();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + invitationLifetimeMs);
  const creation = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`clientguard:invitation:${access.workspaceId}:${email}`}))`,
    );
    const [existingInvitation] = await tx
      .select({ id: invitationsTable.id })
      .from(invitationsTable)
      .where(
        and(
          eq(invitationsTable.workspaceId, access.workspaceId),
          sql`lower(${invitationsTable.email}) = ${email}`,
          isNull(invitationsTable.acceptedAt),
          isNull(invitationsTable.revokedAt),
          gt(invitationsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (existingInvitation) return { conflict: true as const };

    const [invitation] = await tx
      .insert(invitationsTable)
      .values({
        workspaceId: access.workspaceId,
        email,
        role: parsed.data.role,
        invitedByClerkUserId: access.userId,
        tokenHash,
        expiresAt,
      })
      .returning();
    return { conflict: false as const, invitation };
  });
  if (creation.conflict) {
    res.status(409).json({ error: "A pending invitation already exists for that email address." });
    return;
  }
  const { invitation } = creation;

  try {
    const clerkInvitation = await clerkClient.invitations.createInvitation({
      emailAddress: email,
      expiresInDays: 7,
      ignoreExisting: true,
      notify: true,
      redirectUrl: `/invite?token=${encodeURIComponent(token)}`,
    });
    const [updatedInvitation] = await db
      .update(invitationsTable)
      .set({ clerkInvitationId: clerkInvitation.id })
      .where(eq(invitationsTable.id, invitation.id))
      .returning();
    res.status(201).json(
      CreateWorkspaceInvitationResponse.parse(
        invitationResponse(updatedInvitation),
      ),
    );
  } catch {
    await db
      .delete(invitationsTable)
      .where(eq(invitationsTable.id, invitation.id));
    req.log.error(
      { workspaceId: access.workspaceId },
      "Could not send firm invitation email",
    );
    res.status(502).json({ error: "The invitation email could not be sent. Please try again." });
  }
});

router.post(
  "/workspace/invitations/:id/resend",
  async (req, res): Promise<void> => {
    const access = await firmAccess(req, res);
    if (!access) return;
    if (!canManageInvitations(access.role)) {
      res.status(403).json({ error: "Only firm owners and admins can manage invitations." });
      return;
    }

    const params = ResendWorkspaceInvitationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const token = randomUUID();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const now = new Date();
    let createdClerkInvitationId: string | undefined;

    try {
      const initialCheck = await db.transaction(async (tx) => {
        const [pending] = await tx
          .select()
          .from(invitationsTable)
          .where(
            and(
              eq(invitationsTable.id, params.data.id),
              eq(invitationsTable.workspaceId, access.workspaceId),
              isNull(invitationsTable.acceptedAt),
              isNull(invitationsTable.revokedAt),
            ),
          )
          .limit(1);
        if (!pending) return { kind: "missing" as const };

        const email = pending.email.trim().toLowerCase();
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`clientguard:invitation:${access.workspaceId}:${email}`}))`,
        );
        const [otherPending] = await tx
          .select({ id: invitationsTable.id })
          .from(invitationsTable)
          .where(
            and(
              eq(invitationsTable.workspaceId, access.workspaceId),
              sql`lower(${invitationsTable.email}) = ${email}`,
              sql`${invitationsTable.id} <> ${pending.id}`,
              isNull(invitationsTable.acceptedAt),
              isNull(invitationsTable.revokedAt),
              gt(invitationsTable.expiresAt, now),
            ),
          )
          .limit(1);
        if (otherPending) return { kind: "conflict" as const };

        return { kind: "ready" as const, pending, email };
      });

      if (initialCheck.kind === "missing") {
        res.status(404).json({ error: "This invitation is no longer pending in your firm." });
        return;
      }
      if (initialCheck.kind === "conflict") {
        res.status(409).json({
          error: "A pending invitation already exists for that email address.",
        });
        return;
      }

      const clerkInvitation = await clerkClient.invitations.createInvitation({
        emailAddress: initialCheck.pending.email,
        expiresInDays: 7,
        ignoreExisting: true,
        notify: true,
        redirectUrl: `/invite?token=${encodeURIComponent(token)}`,
      });
      createdClerkInvitationId = clerkInvitation.id;

      const result = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`clientguard:invitation:${access.workspaceId}:${initialCheck.email}`}))`,
        );
        const [current] = await tx
          .select()
          .from(invitationsTable)
          .where(
            and(
              eq(invitationsTable.id, initialCheck.pending.id),
              eq(invitationsTable.workspaceId, access.workspaceId),
            ),
          )
          .limit(1)
          .for("update");
        if (
          !current ||
          current.acceptedAt ||
          current.revokedAt ||
          current.tokenHash !== initialCheck.pending.tokenHash
        ) {
          return { kind: "stale" as const };
        }

        const [otherPending] = await tx
          .select({ id: invitationsTable.id })
          .from(invitationsTable)
          .where(
            and(
              eq(invitationsTable.workspaceId, access.workspaceId),
              sql`lower(${invitationsTable.email}) = ${initialCheck.email}`,
              sql`${invitationsTable.id} <> ${current.id}`,
              isNull(invitationsTable.acceptedAt),
              isNull(invitationsTable.revokedAt),
              gt(invitationsTable.expiresAt, now),
            ),
          )
          .limit(1);
        if (otherPending) return { kind: "conflict" as const };

        const [updated] = await tx
          .update(invitationsTable)
          .set({
            tokenHash,
            clerkInvitationId: clerkInvitation.id,
            createdAt: now,
            expiresAt: new Date(now.getTime() + invitationLifetimeMs),
          })
          .where(eq(invitationsTable.id, current.id))
          .returning();
        return {
          kind: "updated" as const,
          invitation: updated,
          previousClerkInvitationId: current.clerkInvitationId,
        };
      });

      if (result.kind !== "updated") {
        try {
          await clerkClient.invitations.revokeInvitation(createdClerkInvitationId);
        } catch (error) {
          req.log.warn(
            { invitationId: params.data.id, error },
            "Could not revoke a Clerk invitation created for a resend that lost its state check",
          );
        }
        createdClerkInvitationId = undefined;
        if (result.kind === "conflict") {
          res.status(409).json({
            error: "A pending invitation already exists for that email address.",
          });
          return;
        }
        res.status(404).json({ error: "This invitation is no longer pending in your firm." });
        return;
      }
      createdClerkInvitationId = undefined;

      let providerRevocationFailed = result.invitation.providerRevocationFailed;
      if (result.previousClerkInvitationId) {
        try {
          await clerkClient.invitations.revokeInvitation(
            result.previousClerkInvitationId,
          );
        } catch (error) {
          req.log.warn(
            { invitationId: params.data.id, error },
            "Could not revoke the superseded Clerk invitation",
          );
          providerRevocationFailed = true;
          await db
            .update(invitationsTable)
            .set({ providerRevocationFailed: true })
            .where(eq(invitationsTable.id, result.invitation.id));
        }
      }
      res.json(
        ResendWorkspaceInvitationResponse.parse(
          invitationResponse({
            ...result.invitation,
            providerRevocationFailed,
          }),
        ),
      );
    } catch (error) {
      if (createdClerkInvitationId) {
        try {
          await clerkClient.invitations.revokeInvitation(createdClerkInvitationId);
        } catch (revokeError) {
          req.log.warn(
            { invitationId: params.data.id, error: revokeError },
            "Could not revoke an unsaved Clerk invitation",
          );
        }
      }
      req.log.error(
        { invitationId: params.data.id, workspaceId: access.workspaceId, error },
        "Could not resend firm invitation",
      );
      res.status(502).json({ error: "The invitation email could not be sent. Please try again." });
    }
  },
);

router.delete(
  "/workspace/invitations/:id",
  async (req, res): Promise<void> => {
    const access = await firmAccess(req, res);
    if (!access) return;
    if (!canManageInvitations(access.role)) {
      res.status(403).json({ error: "Only firm owners and admins can manage invitations." });
      return;
    }

    const params = WithdrawWorkspaceInvitationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const now = new Date();
    const invitation = await db.transaction(async (tx) => {
      const [pending] = await tx
        .select()
        .from(invitationsTable)
        .where(
          and(
            eq(invitationsTable.id, params.data.id),
            eq(invitationsTable.workspaceId, access.workspaceId),
            isNull(invitationsTable.acceptedAt),
            isNull(invitationsTable.revokedAt),
            gt(invitationsTable.expiresAt, now),
          ),
        )
        .limit(1)
        .for("update");
      if (!pending) return null;

      const [withdrawn] = await tx
        .update(invitationsTable)
        .set({ revokedAt: now })
        .where(eq(invitationsTable.id, pending.id))
        .returning();
      return withdrawn;
    });

    if (!invitation) {
      res.status(404).json({ error: "This invitation is no longer pending in your firm." });
      return;
    }

    let providerRevocationFailed = invitation.providerRevocationFailed;
    if (invitation.clerkInvitationId) {
      try {
        await clerkClient.invitations.revokeInvitation(invitation.clerkInvitationId);
      } catch (error) {
        req.log.warn(
          { invitationId: params.data.id, error },
          "Could not revoke the withdrawn Clerk invitation",
        );
        providerRevocationFailed = true;
        await db
          .update(invitationsTable)
          .set({ providerRevocationFailed: true })
          .where(eq(invitationsTable.id, invitation.id));
      }
    }
    res.json(
      WithdrawWorkspaceInvitationResponse.parse(
        invitationResponse({
          ...invitation,
          providerRevocationFailed,
        }),
      ),
    );
  },
);

router.post("/workspace/invitations/accept", async (req, res): Promise<void> => {
  const identity = identify(req, res);
  if (!identity) return;

  const parsed = AcceptWorkspaceInvitationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const [initialInvitation] = await db
    .select()
    .from(invitationsTable)
    .where(eq(invitationsTable.tokenHash, tokenHash))
    .limit(1);
  if (!initialInvitation) {
    res.status(404).json({ error: "This invitation could not be found." });
    return;
  }
  if (initialInvitation.revokedAt || initialInvitation.expiresAt <= new Date()) {
    res.status(410).json({ error: "This invitation has expired." });
    return;
  }

  let clerkUser;
  try {
    clerkUser = await clerkClient.users.getUser(identity.userId);
  } catch {
    req.log.error("Could not verify the signed-in user's email with Clerk");
    res.status(502).json({ error: "Your account email could not be verified. Please try again." });
    return;
  }
  const verifiedEmails = clerkUser.emailAddresses
    .filter((emailAddress) => emailAddress.verification?.status === "verified")
    .map((emailAddress) => emailAddress.emailAddress.trim().toLowerCase());
  if (!verifiedEmails.includes(initialInvitation.email.toLowerCase())) {
    res.status(403).json({ error: "Sign in with the verified email address that received this invitation." });
    return;
  }

  const displayName =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
    clerkUser.primaryEmailAddress?.emailAddress ||
    "Firm user";
  let result: "accepted" | "already-accepted" | "missing" | "superseded" | "expired" | "used" | "other-firm" | "already-member" =
    "missing";
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tokenHash}))`);
    const [invitation] = await tx
      .select()
      .from(invitationsTable)
      .where(eq(invitationsTable.tokenHash, tokenHash))
      .limit(1)
      .for("update");
    if (!invitation) {
      result = "superseded";
      return;
    }
    if (invitation.acceptedAt) {
      if (invitation.acceptedByClerkUserId !== identity.userId) {
        result = "used";
        return;
      }
      const [existingMembership] = await tx
        .select({ workspaceId: membershipsTable.workspaceId })
        .from(membershipsTable)
        .where(eq(membershipsTable.clerkUserId, identity.userId))
        .limit(1);
      result =
        existingMembership?.workspaceId === invitation.workspaceId
          ? "already-accepted"
          : "other-firm";
      return;
    }
    if (invitation.expiresAt <= new Date()) {
      result = "expired";
      return;
    }
    if (invitation.revokedAt) {
      result = "expired";
      return;
    }

    const existingMemberships = await tx
      .select({ workspaceId: membershipsTable.workspaceId })
      .from(membershipsTable)
      .where(eq(membershipsTable.clerkUserId, identity.userId));
    if (
      existingMemberships.some(
        (membership) => membership.workspaceId !== invitation.workspaceId,
      )
    ) {
      result = "other-firm";
      return;
    }
    if (existingMemberships.length) {
      result = "already-member";
      return;
    }

    await tx.insert(membershipsTable).values({
      workspaceId: invitation.workspaceId,
      clerkUserId: identity.userId,
      email: initialInvitation.email,
      displayName,
      role: invitation.role,
    });
    await tx
      .update(invitationsTable)
      .set({
        acceptedAt: new Date(),
        acceptedByClerkUserId: identity.userId,
      })
      .where(eq(invitationsTable.id, invitation.id));
    const [workspace] = await tx
      .select({ name: workspacesTable.name })
      .from(workspacesTable)
      .where(eq(workspacesTable.id, invitation.workspaceId))
      .limit(1);
    await tx.insert(activitiesTable).values({
      workspaceId: invitation.workspaceId,
      clerkUserId: identity.userId,
      actor: displayName,
      action: "joined the firm workspace",
      entityType: "workspace",
      entityId: invitation.workspaceId,
      entityLabel: workspace?.name ?? "Firm workspace",
    });
    result = "accepted";
  });

  if (result === "missing") {
    res.status(404).json({ error: "This invitation could not be found." });
    return;
  }
  if (result === "superseded") {
    res.status(410).json({ error: "This invitation was replaced and can no longer be accepted." });
    return;
  }
  if (result === "expired" || result === "used") {
    res.status(410).json({ error: "This invitation has expired, been withdrawn, or has already been used." });
    return;
  }
  if (result === "other-firm") {
    res.status(409).json({ error: "This account already belongs to another firm workspace." });
    return;
  }
  if (result === "already-member") {
    res.status(409).json({ error: "This account is already a member of the invited firm." });
    return;
  }

  const row = await membershipFor(identity.userId);
  res.json(
    AcceptWorkspaceInvitationResponse.parse(
      workspaceContext(
        {
          ...identity,
          email: initialInvitation.email,
          name: displayName,
        },
        row,
      ),
    ),
  );
});

router.get("/dashboard", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;

  const [clientCount] = await db
    .select({ value: count() })
    .from(clientsTable)
    .where(eq(clientsTable.workspaceId, access.workspaceId));
  const [activeClientCount] = await db
    .select({ value: count() })
    .from(clientsTable)
    .where(
      and(
        eq(clientsTable.workspaceId, access.workspaceId),
        eq(clientsTable.status, "active"),
      ),
    );
  const [matterCount] = await db
    .select({ value: count() })
    .from(mattersTable)
    .where(eq(mattersTable.workspaceId, access.workspaceId));
  const [openMatterCount] = await db
    .select({ value: count() })
    .from(mattersTable)
    .where(
      and(
        eq(mattersTable.workspaceId, access.workspaceId),
        eq(mattersTable.status, "open"),
      ),
    );
  const [overdueMatterCount] = await db
    .select({ value: count() })
    .from(mattersTable)
    .where(
      and(
        eq(mattersTable.workspaceId, access.workspaceId),
        eq(mattersTable.status, "open"),
        lt(mattersTable.dueAt, new Date()),
      ),
    );
  const activity = await db
    .select()
    .from(activitiesTable)
    .where(eq(activitiesTable.workspaceId, access.workspaceId))
    .orderBy(desc(activitiesTable.occurredAt), desc(activitiesTable.id))
    .limit(6);

  res.json(
    GetDashboardResponse.parse({
      clientCount: clientCount.value,
      activeClientCount: activeClientCount.value,
      matterCount: matterCount.value,
      openMatterCount: openMatterCount.value,
      overdueMatterCount: overdueMatterCount.value,
      recentActivity: activity,
    }),
  );
});

router.get("/activity", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  const parsed = ListActivityQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const filters = [eq(activitiesTable.workspaceId, access.workspaceId)];
  let snapshotId = parsed.data.snapshotId;
  if (snapshotId === undefined) {
    const [snapshot] = await db
      .select({ snapshotId: max(activitiesTable.id) })
      .from(activitiesTable)
      .where(eq(activitiesTable.workspaceId, access.workspaceId));
    snapshotId = snapshot?.snapshotId ?? 0;
  }
  if (parsed.data.actorMemberId !== undefined) {
    const [actorMember] = await db
      .select({ clerkUserId: membershipsTable.clerkUserId })
      .from(membershipsTable)
      .where(
        and(
          eq(membershipsTable.id, parsed.data.actorMemberId),
          eq(membershipsTable.workspaceId, access.workspaceId),
        ),
      )
      .limit(1);
    if (!actorMember) {
      res.json(ListActivityResponse.parse({ items: [], snapshotId }));
      return;
    }
    filters.push(eq(activitiesTable.clerkUserId, actorMember.clerkUserId));
  }
  if (parsed.data.entityType !== undefined) {
    filters.push(eq(activitiesTable.entityType, parsed.data.entityType));
  }
  if (parsed.data.entityId !== undefined) {
    filters.push(eq(activitiesTable.entityId, parsed.data.entityId));
  }
  filters.push(lte(activitiesTable.id, snapshotId));
  const activity = await db
    .select()
    .from(activitiesTable)
    .where(and(...filters))
    .orderBy(desc(activitiesTable.occurredAt), desc(activitiesTable.id))
    .limit(parsed.data.limit)
    .offset(parsed.data.offset);
  res.json(ListActivityResponse.parse({ items: activity, snapshotId }));
});

router.get("/activity/export.csv", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  const parsed = ExportActivityQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const filters = [eq(activitiesTable.workspaceId, access.workspaceId)];
  if (parsed.data.actorMemberId !== undefined) {
    const [actorMember] = await db
      .select({ clerkUserId: membershipsTable.clerkUserId })
      .from(membershipsTable)
      .where(
        and(
          eq(membershipsTable.id, parsed.data.actorMemberId),
          eq(membershipsTable.workspaceId, access.workspaceId),
        ),
      )
      .limit(1);
    if (!actorMember) {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="clientguard-activity.csv"',
      );
      res.send(
        [
          "id,actor,action,entityType,entityId,entityLabel,occurredAt",
          "",
        ].join("\r\n"),
      );
      return;
    }
    filters.push(eq(activitiesTable.clerkUserId, actorMember.clerkUserId));
  }
  if (parsed.data.entityType !== undefined) {
    filters.push(eq(activitiesTable.entityType, parsed.data.entityType));
  }
  if (parsed.data.entityId !== undefined) {
    filters.push(eq(activitiesTable.entityId, parsed.data.entityId));
  }

  const activity = await db
    .select()
    .from(activitiesTable)
    .where(and(...filters))
    .orderBy(desc(activitiesTable.occurredAt), desc(activitiesTable.id));
  const csvCell = (value: string | number | Date): string => {
    const raw = value instanceof Date ? value.toISOString() : String(value);
    const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const csv = [
    ["id", "actor", "action", "entityType", "entityId", "entityLabel", "occurredAt"],
    ...activity.map((event) => [
      event.id,
      event.actor,
      event.action,
      event.entityType,
      event.entityId,
      event.entityLabel,
      event.occurredAt,
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="clientguard-activity.csv"',
  );
  res.send(`${csv}\r\n`);
});

router.get("/activity/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  const params = GetActivityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [activity] = await db
    .select()
    .from(activitiesTable)
    .where(
      and(
        eq(activitiesTable.id, params.data.id),
        eq(activitiesTable.workspaceId, access.workspaceId),
      ),
    )
    .limit(1);
  if (!activity) {
    res.status(404).json({ error: "Activity not found." });
    return;
  }
  res.json(GetActivityResponse.parse(activity));
});

router.get("/clients", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  await backfillAssignmentIdentities(access.workspaceId);
  const parsed = ListClientsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const filters = [eq(clientsTable.workspaceId, access.workspaceId)];
  if (parsed.data.status) filters.push(eq(clientsTable.status, parsed.data.status));
  if (parsed.data.search?.trim()) {
    const pattern = `%${parsed.data.search.trim()}%`;
    filters.push(
      or(
        ilike(clientsTable.name, pattern),
        ilike(clientsTable.email, pattern),
        ilike(clientsTable.industry, pattern),
      )!,
    );
  }
  const [clients, matterRows, activityRows, members] = await Promise.all([
    db
      .select()
      .from(clientsTable)
      .where(and(...filters))
      .orderBy(desc(clientsTable.updatedAt)),
    db
      .select({ clientId: mattersTable.clientId, value: count() })
      .from(mattersTable)
      .where(eq(mattersTable.workspaceId, access.workspaceId))
      .groupBy(mattersTable.clientId),
    db
      .select({
        clientId: activitiesTable.entityId,
        lastActivityAt: max(activitiesTable.occurredAt),
      })
      .from(activitiesTable)
      .where(
        and(
          eq(activitiesTable.workspaceId, access.workspaceId),
          eq(activitiesTable.entityType, "client"),
        ),
      )
      .groupBy(activitiesTable.entityId),
    db
      .select()
      .from(membershipsTable)
      .where(eq(membershipsTable.workspaceId, access.workspaceId)),
  ]);
  const matterCountByClient = new Map(matterRows.map((row) => [row.clientId, row.value]));
  const memberLabels = memberLabelById(members);
  const activityByClient = new Map(
    activityRows.map((row) => [row.clientId, row.lastActivityAt]),
  );
  res.json(
    ListClientsResponse.parse(
      clients.map((client) => ({
        ...client,
        owner: client.ownerMemberId === null
          ? client.owner
          : memberLabels.get(client.ownerMemberId) ?? client.owner,
        matterCount: matterCountByClient.get(client.id) ?? 0,
        lastActivityAt: activityByClient.get(client.id) ?? null,
      })),
    ),
  );
});

router.post("/clients", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [assignedMembership] = await tx
      .select()
      .from(membershipsTable)
      .where(and(
        eq(membershipsTable.workspaceId, access.workspaceId),
        parsed.data.ownerMemberId === undefined
          ? eq(membershipsTable.clerkUserId, access.userId)
          : eq(membershipsTable.id, parsed.data.ownerMemberId),
      ))
      .for("update")
      .limit(1);
    if (!assignedMembership) {
      return parsed.data.ownerMemberId === undefined
        ? { kind: "requesting-member-missing" as const }
        : { kind: "assigned-member-missing" as const };
    }
    const [client] = await tx
      .insert(clientsTable)
      .values({
        ...parsed.data,
        workspaceId: access.workspaceId,
        owner: assignedMembership.displayName || assignedMembership.email || "Firm teammate",
        ownerMemberId: assignedMembership.id,
      })
      .returning();
    return { kind: "created" as const, client };
  });
  if (result.kind === "requesting-member-missing") {
    res.status(403).json({ error: "An active firm membership is required to assign this client." });
    return;
  }
  if (result.kind === "assigned-member-missing") {
    res.status(400).json({ error: "Choose an active teammate in this firm." });
    return;
  }
  const { client } = result;
  await logActivity(access, "client", client.id, client.name, "created client");
  res.status(201).json(
    CreateClientResponse.parse({
      ...client,
      matterCount: 0,
      lastActivityAt: null,
    }),
  );
});

router.get("/clients/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  await backfillAssignmentIdentities(access.workspaceId);
  const params = GetClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(
      and(
        eq(clientsTable.id, params.data.id),
        eq(clientsTable.workspaceId, access.workspaceId),
      ),
    )
    .limit(1);
  if (!client) {
    res.status(404).json({ error: "Client not found." });
    return;
  }
  await logAuditEvent(access, "client_record_viewed", "client", client.id, client.name);
  const [matterCount] = await db
    .select({ value: count() })
    .from(mattersTable)
    .where(eq(mattersTable.clientId, client.id));
  const [lastActivity] = await db
    .select({ value: max(activitiesTable.occurredAt) })
    .from(activitiesTable)
    .where(
      and(
        eq(activitiesTable.workspaceId, access.workspaceId),
        eq(activitiesTable.entityType, "client"),
        eq(activitiesTable.entityId, client.id),
      ),
    );
  const [assignedMember] = client.ownerMemberId === null ? [] : await db
    .select({ displayName: membershipsTable.displayName, email: membershipsTable.email })
    .from(membershipsTable)
    .where(and(
      eq(membershipsTable.id, client.ownerMemberId),
      eq(membershipsTable.workspaceId, access.workspaceId),
    ))
    .limit(1);
  res.json(
    GetClientResponse.parse({
      ...client,
      owner: assignedMember
        ? assignedMember.displayName || assignedMember.email || client.owner
        : client.owner,
      matterCount: matterCount.value,
      lastActivityAt: lastActivity.value,
    }),
  );
});

router.patch("/clients/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = UpdateClientParams.safeParse(req.params);
  const parsed = UpdateClientBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = await db.transaction(async (tx) => {
    let ownerLabel: string | undefined;
    if (parsed.data.ownerMemberId !== undefined) {
      const [member] = await tx
        .select()
        .from(membershipsTable)
        .where(and(
          eq(membershipsTable.id, parsed.data.ownerMemberId),
          eq(membershipsTable.workspaceId, access.workspaceId),
        ))
        .for("update")
        .limit(1);
      if (!member) return { kind: "inactive-member" as const };
      ownerLabel = member.displayName || member.email || "Firm teammate";
    }
    const [client] = await tx
      .update(clientsTable)
      .set({
        ...parsed.data,
        owner: ownerLabel,
      })
      .where(
        and(
          eq(clientsTable.id, params.data.id),
          eq(clientsTable.workspaceId, access.workspaceId),
        ),
      )
      .returning();
    return client
      ? { kind: "updated" as const, client, ownerLabel }
      : { kind: "client-missing" as const };
  });
  if (result.kind === "inactive-member") {
    res.status(409).json({
      error: "That teammate is no longer active in this firm. Choose another teammate and try again.",
      code: "client_owner_inactive",
    });
    return;
  }
  if (result.kind === "client-missing") {
    res.status(404).json({ error: "Client not found." });
    return;
  }
  const { client, ownerLabel } = result;
  await logActivity(access, "client", client.id, client.name, "updated client");
  const [matterCount] = await db
    .select({ value: count() })
    .from(mattersTable)
    .where(eq(mattersTable.clientId, client.id));
  const [lastActivity] = await db
    .select({ value: max(activitiesTable.occurredAt) })
    .from(activitiesTable)
    .where(
      and(
        eq(activitiesTable.workspaceId, access.workspaceId),
        eq(activitiesTable.entityType, "client"),
        eq(activitiesTable.entityId, client.id),
      ),
    );
  res.json(
    UpdateClientResponse.parse({
      ...client,
      owner: ownerLabel ?? client.owner,
      matterCount: matterCount.value,
      lastActivityAt: lastActivity.value,
    }),
  );
});

router.delete("/clients/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = DeleteClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [client] = await db
    .update(clientsTable)
    .set({ status: "archived" })
    .where(
      and(
        eq(clientsTable.id, params.data.id),
        eq(clientsTable.workspaceId, access.workspaceId),
      ),
    )
    .returning();
  if (!client) {
    res.status(404).json({ error: "Client not found." });
    return;
  }
  await logActivity(access, "client", client.id, client.name, "archived client");
  res.sendStatus(204);
});

router.get("/matters", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  await backfillAssignmentIdentities(access.workspaceId);
  const parsed = ListMattersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const filters = [eq(mattersTable.workspaceId, access.workspaceId)];
  if (parsed.data.status) filters.push(eq(mattersTable.status, parsed.data.status));
  const [rows, members] = await Promise.all([
    db
      .select({ matter: mattersTable, clientName: clientsTable.name })
      .from(mattersTable)
      .innerJoin(
        clientsTable,
        and(
          eq(mattersTable.clientId, clientsTable.id),
          eq(mattersTable.workspaceId, clientsTable.workspaceId),
        ),
      )
      .where(
        and(
          ...filters,
          parsed.data.search?.trim()
            ? or(
                ilike(mattersTable.title, `%${parsed.data.search.trim()}%`),
                ilike(mattersTable.reference, `%${parsed.data.search.trim()}%`),
                ilike(clientsTable.name, `%${parsed.data.search.trim()}%`),
              )
            : undefined,
        ),
      )
      .orderBy(desc(mattersTable.updatedAt)),
    db.select().from(membershipsTable).where(eq(membershipsTable.workspaceId, access.workspaceId)),
  ]);
  const memberLabels = memberLabelById(members);
  res.json(
    ListMattersResponse.parse(
      rows.map(({ matter, clientName }) => ({
        ...matter,
        clientName,
        responsible: matter.responsibleMemberId === null
          ? matter.responsible
          : memberLabels.get(matter.responsibleMemberId) ?? matter.responsible,
      })),
    ),
  );
});

router.post("/matters", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const parsed = CreateMatterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [client] = await db.select({ id: clientsTable.id })
    .from(clientsTable)
    .where(and(
      eq(clientsTable.id, parsed.data.clientId),
      eq(clientsTable.workspaceId, access.workspaceId),
    ))
    .limit(1);
  if (!client) {
    res.status(404).json({ error: "Client not found in this firm." });
    return;
  }
  res.status(409).json({
    error: "New matters must be opened from a cleared client intake.",
    code: "intake_required",
  });
});

router.get("/matters/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  await backfillAssignmentIdentities(access.workspaceId);
  const params = GetMatterParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select({ matter: mattersTable, clientName: clientsTable.name })
    .from(mattersTable)
    .innerJoin(
      clientsTable,
      and(
        eq(mattersTable.clientId, clientsTable.id),
        eq(mattersTable.workspaceId, clientsTable.workspaceId),
      ),
    )
    .where(
      and(
        eq(mattersTable.id, params.data.id),
        eq(mattersTable.workspaceId, access.workspaceId),
      ),
    )
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Matter not found." });
    return;
  }
  await logAuditEvent(access, "matter_record_viewed", "matter", row.matter.id, row.matter.title);
  const [member] = row.matter.responsibleMemberId === null ? [] : await db
    .select({ displayName: membershipsTable.displayName, email: membershipsTable.email })
    .from(membershipsTable)
    .where(and(
      eq(membershipsTable.id, row.matter.responsibleMemberId),
      eq(membershipsTable.workspaceId, access.workspaceId),
    ))
    .limit(1);
  res.json(GetMatterResponse.parse({
    ...row.matter,
    clientName: row.clientName,
    responsible: member ? member.displayName || member.email || row.matter.responsible : row.matter.responsible,
  }));
});

router.patch("/matters/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = UpdateMatterParams.safeParse(req.params);
  const parsed = UpdateMatterBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.status !== undefined) {
    const [currentMatter] = await db.select({ status: mattersTable.status })
      .from(mattersTable)
      .where(and(
        eq(mattersTable.id, params.data.id),
        eq(mattersTable.workspaceId, access.workspaceId),
      ))
      .limit(1);
    if (!currentMatter) {
      res.status(404).json({ error: "Matter not found." });
      return;
    }
    if (currentMatter.status === "closed" && parsed.data.status !== "closed") {
      res.status(409).json({ error: "A closed matter cannot be reopened through an edit." });
      return;
    }
    if (parsed.data.status === "open" && !(await canMatterOpen(access.workspaceId, params.data.id))) {
      res.status(409).json({
        error: "This firm requires a completed engagement signature before a matter can be opened.",
        code: "engagement_signature_required",
      });
      return;
    }
    if (parsed.data.status === "closed" && !(await closeoutIsReady(access.workspaceId, params.data.id))) {
      res.status(409).json({
        error: "Complete all matter closeout checklist items before closing this matter.",
        code: "matter_closeout_required",
      });
      return;
    }
  }
  const result = await db.transaction(async (tx) => {
    let responsibleLabel: string | undefined;
    if (parsed.data.responsibleMemberId !== undefined) {
      const [member] = await tx
        .select()
        .from(membershipsTable)
        .where(and(
          eq(membershipsTable.id, parsed.data.responsibleMemberId),
          eq(membershipsTable.workspaceId, access.workspaceId),
        ))
        .for("update")
        .limit(1);
      if (!member) return { kind: "inactive-member" as const };
      responsibleLabel = member.displayName || member.email || "Firm teammate";
    }
    if (parsed.data.clientId) {
      const [client] = await tx
        .select({ id: clientsTable.id })
        .from(clientsTable)
        .where(and(
          eq(clientsTable.id, parsed.data.clientId),
          eq(clientsTable.workspaceId, access.workspaceId),
        ))
        .limit(1);
      if (!client) return { kind: "client-missing" as const };
    }
    const [matter] = await tx
      .update(mattersTable)
      .set({
        ...parsed.data,
        responsible: responsibleLabel,
        dueAt: parsed.data.dueAt === undefined ? undefined : parsed.data.dueAt,
      })
      .where(and(
        eq(mattersTable.id, params.data.id),
        eq(mattersTable.workspaceId, access.workspaceId),
      ))
      .returning();
    return matter
      ? { kind: "updated" as const, matter, responsibleLabel }
      : { kind: "matter-missing" as const };
  });
  if (result.kind === "inactive-member") {
    res.status(409).json({
      error: "That teammate is no longer active in this firm. Choose another teammate and try again.",
      code: "matter_assignee_inactive",
    });
    return;
  }
  if (result.kind === "client-missing") {
    res.status(404).json({ error: "Client not found in this firm." });
    return;
  }
  if (result.kind === "matter-missing") {
    res.status(404).json({ error: "Matter not found." });
    return;
  }
  const { matter, responsibleLabel } = result;
  const [client] = await db
    .select({ name: clientsTable.name })
    .from(clientsTable)
    .where(
      and(
        eq(clientsTable.id, matter.clientId),
        eq(clientsTable.workspaceId, access.workspaceId),
      ),
    )
    .limit(1);
  await logActivity(access, "matter", matter.id, matter.title, "updated matter");
  res.json(
    UpdateMatterResponse.parse({
      ...matter,
      clientName: client?.name ?? "Unknown client",
      responsible: responsibleLabel ?? matter.responsible,
    }),
  );
});

router.delete("/matters/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = CloseMatterParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db.select({ status: mattersTable.status, title: mattersTable.title })
    .from(mattersTable)
    .where(and(
      eq(mattersTable.id, params.data.id),
      eq(mattersTable.workspaceId, access.workspaceId),
    ))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Matter not found." });
    return;
  }
  if (existing.status === "closed") {
    res.status(409).json({ error: "This matter is already closed." });
    return;
  }
  if (!(await closeoutIsReady(access.workspaceId, params.data.id))) {
    res.status(409).json({
      error: "Complete all matter closeout checklist items before closing this matter.",
      code: "matter_closeout_required",
    });
    return;
  }
  const [matter] = await db
    .update(mattersTable)
    .set({ status: "closed" })
    .where(
      and(
        eq(mattersTable.id, params.data.id),
        eq(mattersTable.workspaceId, access.workspaceId),
      ),
    )
    .returning();
  if (!matter) {
    res.status(404).json({ error: "Matter not found." });
    return;
  }
  await logActivity(access, "matter", matter.id, matter.title, "closed matter");
  res.sendStatus(204);
});

export default router;
