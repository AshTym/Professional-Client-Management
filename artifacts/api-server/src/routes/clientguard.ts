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
  mattersTable,
  membershipsTable,
  workspacesTable,
} from "@workspace/db";
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
  GetWorkspaceMemberAssignmentsParams,
  GetWorkspaceMemberAssignmentsResponse,
  ResendWorkspaceInvitationParams,
  ResendWorkspaceInvitationResponse,
  WithdrawWorkspaceInvitationParams,
  ListActivityQueryParams,
  ListActivityResponse,
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
} from "@workspace/api-zod";
import {
  firmAccess,
  identify,
  logActivity,
  logAuditEvent,
  membershipFor,
  workspaceContext,
} from "../lib/clientguard-auth";

const router: IRouter = Router();

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

  const row = await membershipFor(identity.userId);
  const response = CreateWorkspaceResponse.parse(workspaceContext(identity, row));
  res.status(created ? 201 : 200).json(response);
});

const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;

function canManageInvitations(role: string): boolean {
  return role === "owner" || role === "admin";
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
              inArray(clientsTable.owner, labels),
            ),
          )
          .for("update");
        const assignedMatters = await tx
          .select()
          .from(mattersTable)
          .where(
            and(
              eq(mattersTable.workspaceId, access.workspaceId),
              inArray(mattersTable.responsible, labels),
            ),
          )
          .for("update");
        if (
          (assignedClients.length || assignedMatters.length) &&
          body.data.replacementMemberId === undefined
        ) {
          return {
            kind: "replacement_required" as const,
            assignedClientCount: assignedClients.length,
            assignedMatterCount: assignedMatters.length,
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
              .set({ owner: replacementLabel, updatedAt: new Date() })
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
              .set({ responsible: replacementLabel, updatedAt: new Date() })
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
    if (result.kind === "self_removal") {
      res.status(409).json({
        error: "You cannot remove your own firm access through conflict review.",
        code: "self_removal_protected",
      });
      return;
    }
    if (result.kind === "replacement_required") {
      res.status(409).json({
        error: "Assigned clients and matters need an active teammate before access is removed.",
        code: "membership_assignments_replacement_required",
        assignedClientCount: result.assignedClientCount,
        assignedMatterCount: result.assignedMatterCount,
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

    const labels = assignmentLabels(member);
    const [clients, matters] = await Promise.all([
      db
        .select({ id: clientsTable.id, name: clientsTable.name })
        .from(clientsTable)
        .where(
          and(
            eq(clientsTable.workspaceId, access.workspaceId),
            inArray(clientsTable.owner, labels),
          ),
        )
        .orderBy(clientsTable.name),
      db
        .select({
          id: mattersTable.id,
          title: mattersTable.title,
          reference: mattersTable.reference,
          clientName: clientsTable.name,
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
            inArray(mattersTable.responsible, labels),
          ),
        )
        .orderBy(mattersTable.reference),
    ]);

    res.json(
      GetWorkspaceMemberAssignmentsResponse.parse({ clients, matters }),
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

      return { kind: "transferred" as const, member: updatedOwner };
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
    res.json(TransferWorkspaceOwnershipResponse.parse(memberResponse(result.member)));
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
          inArray(clientsTable.owner, labels),
        ),
      )
      .for("update");
    const matters = await tx
      .select()
      .from(mattersTable)
      .where(
        and(
          eq(mattersTable.workspaceId, access.workspaceId),
          inArray(mattersTable.responsible, labels),
        ),
      )
      .for("update");

    const replacementId = parsedBody.data.replacementMemberId;
    if ((clients.length || matters.length) && replacementId === undefined) {
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
          .set({ owner: replacementLabel })
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
          .set({ responsible: replacementLabel })
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
      error: "Select an active firm member to take over this person's assigned clients and matters.",
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

function invitationResponse(invitation: typeof invitationsTable.$inferSelect) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    expired: invitation.expiresAt <= new Date(),
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
    .select()
    .from(invitationsTable)
    .where(
      and(
        eq(invitationsTable.workspaceId, access.workspaceId),
        isNull(invitationsTable.acceptedAt),
        isNull(invitationsTable.revokedAt),
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
  const [existingInvitation] = await db
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
  if (existingInvitation) {
    res.status(409).json({ error: "A pending invitation already exists for that email address." });
    return;
  }

  const token = randomUUID();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + invitationLifetimeMs);
  const [invitation] = await db
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
      const result = await db.transaction(async (tx) => {
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
          .limit(1)
          .for("update");
        if (!pending) return null;

        const clerkInvitation = await clerkClient.invitations.createInvitation({
          emailAddress: pending.email,
          expiresInDays: 7,
          ignoreExisting: true,
          notify: true,
          redirectUrl: `/invite?token=${encodeURIComponent(token)}`,
        });
        createdClerkInvitationId = clerkInvitation.id;

        const [updated] = await tx
          .update(invitationsTable)
          .set({
            tokenHash,
            clerkInvitationId: clerkInvitation.id,
            createdAt: now,
            expiresAt: new Date(now.getTime() + invitationLifetimeMs),
          })
          .where(eq(invitationsTable.id, pending.id))
          .returning();
        return { invitation: updated, previousClerkInvitationId: pending.clerkInvitationId };
      });

      if (!result) {
        res.status(404).json({ error: "This invitation is no longer pending in your firm." });
        return;
      }

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
        }
      }
      res.json(
        ResendWorkspaceInvitationResponse.parse(
          invitationResponse(result.invitation),
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

    if (invitation.clerkInvitationId) {
      try {
        await clerkClient.invitations.revokeInvitation(invitation.clerkInvitationId);
      } catch (error) {
        req.log.warn(
          { invitationId: params.data.id, error },
          "Could not revoke the withdrawn Clerk invitation",
        );
      }
    }
    res.sendStatus(204);
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
  const activity = await db
    .select()
    .from(activitiesTable)
    .where(eq(activitiesTable.workspaceId, access.workspaceId))
    .orderBy(desc(activitiesTable.occurredAt), desc(activitiesTable.id))
    .limit(parsed.data.limit)
    .offset(parsed.data.offset);
  res.json(ListActivityResponse.parse(activity));
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
  const clients = await db
    .select()
    .from(clientsTable)
    .where(and(...filters))
    .orderBy(desc(clientsTable.updatedAt));
  const [matterRows, activityRows] = await Promise.all([
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
  ]);
  const matterCountByClient = new Map(matterRows.map((row) => [row.clientId, row.value]));
  const activityByClient = new Map(
    activityRows.map((row) => [row.clientId, row.lastActivityAt]),
  );
  res.json(
    ListClientsResponse.parse(
      clients.map((client) => ({
        ...client,
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
  const [client] = await db
    .insert(clientsTable)
    .values({
      ...parsed.data,
      workspaceId: access.workspaceId,
      owner: access.name || access.email || "Firm user",
    })
    .returning();
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
  res.json(
    GetClientResponse.parse({
      ...client,
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
  const [client] = await db
    .update(clientsTable)
    .set(parsed.data)
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
  const parsed = ListMattersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const filters = [eq(mattersTable.workspaceId, access.workspaceId)];
  if (parsed.data.status) filters.push(eq(mattersTable.status, parsed.data.status));
  const rows = await db
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
    .orderBy(desc(mattersTable.updatedAt));
  res.json(
    ListMattersResponse.parse(
      rows.map(({ matter, clientName }) => ({
        ...matter,
        clientName,
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
  res.json(GetMatterResponse.parse({ ...row.matter, clientName: row.clientName }));
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
  if (parsed.data.clientId) {
    const [client] = await db
      .select({ id: clientsTable.id })
      .from(clientsTable)
      .where(
        and(
          eq(clientsTable.id, parsed.data.clientId),
          eq(clientsTable.workspaceId, access.workspaceId),
        ),
      )
      .limit(1);
    if (!client) {
      res.status(404).json({ error: "Client not found in this firm." });
      return;
    }
  }
  const [matter] = await db
    .update(mattersTable)
    .set({
      ...parsed.data,
      dueAt: parsed.data.dueAt === undefined ? undefined : parsed.data.dueAt,
    })
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
