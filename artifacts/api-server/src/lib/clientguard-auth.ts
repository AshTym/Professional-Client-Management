import { clerkClient, getAuth } from "@clerk/express";
import type { Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { auditEventsTable, db, membershipsTable, workspacesTable } from "@workspace/db";

export type ClientGuardIdentity = {
  userId: string;
  email: string;
  name: string;
};

export type FirmAccess = ClientGuardIdentity & {
  workspaceId: number;
  workspaceName: string;
  practiceType: string;
  role: string;
};

export type OwnershipTransferNoticeRecipient = {
  clerkUserId: string;
  displayName: string;
};

export async function sendOwnershipTransferNotices(input: {
  transferId: string;
  workspaceName: string;
  previousOwner: OwnershipTransferNoticeRecipient;
  newOwner: OwnershipTransferNoticeRecipient;
}): Promise<Array<{ recipientRole: "former_owner" | "new_owner"; error: unknown | null }>> {
  return Promise.all(
    (["former_owner", "new_owner"] as const).map((recipientRole) =>
      sendOwnershipTransferNotice({ ...input, recipientRole }),
    ),
  );
}

export async function sendOwnershipTransferNotice(input: {
  transferId: string;
  workspaceName: string;
  previousOwner: OwnershipTransferNoticeRecipient;
  newOwner: OwnershipTransferNoticeRecipient;
  recipientRole: "former_owner" | "new_owner";
}): Promise<{ recipientRole: "former_owner" | "new_owner"; error: unknown | null }> {
  const senderAddress = process.env.CLIENTGUARD_NOTIFICATION_FROM_EMAIL?.trim();
  const isFormerOwner = input.recipientRole === "former_owner";
  const recipient = isFormerOwner ? input.previousOwner : input.newOwner;
  const notice = {
    recipient,
    subject: isFormerOwner
      ? `Your role changed at ${input.workspaceName}`
      : `You are now the owner of ${input.workspaceName}`,
    text: isFormerOwner
      ? `Hello ${input.previousOwner.displayName},\n\nFirm ownership of ${input.workspaceName} has been transferred to ${input.newOwner.displayName}. Your role is now admin, and you continue to have admin access to the firm.`
      : `Hello ${input.newOwner.displayName},\n\nYou are now the owner of ${input.workspaceName}. ${input.previousOwner.displayName} is now an admin.`,
    idempotencyKey: `ownership_${input.transferId}_${input.recipientRole}`,
  };

  if (!senderAddress) {
    return {
      recipientRole: input.recipientRole,
      error: new Error("CLIENTGUARD_NOTIFICATION_FROM_EMAIL is not configured."),
    };
  }

  try {
    await clerkClient.emails.create(
      {
        to: { userId: notice.recipient.clerkUserId },
        from: { address: senderAddress, name: "ClientGuard" },
        subject: notice.subject,
        text: notice.text,
      },
      { idempotencyKey: notice.idempotencyKey },
    );
    return { recipientRole: input.recipientRole, error: null };
  } catch (error) {
    return { recipientRole: input.recipientRole, error };
  }
}

function claimString(
  claims: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = claims[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

export function identify(
  req: Request,
  res: Response,
): ClientGuardIdentity | null {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Sign in is required." });
    return null;
  }

  const claims = (auth.sessionClaims ?? {}) as Record<string, unknown>;
  return {
    userId: auth.userId,
    email: claimString(claims, "email", "email_address") ?? "",
    name:
      claimString(claims, "name", "full_name") ||
      [claimString(claims, "first_name"), claimString(claims, "last_name")]
        .filter(Boolean)
        .join(" ") ||
      "Firm user",
  };
}

export async function membershipFor(userId: string) {
  const [row] = await db
    .select({
      workspace: workspacesTable,
      membership: membershipsTable,
    })
    .from(membershipsTable)
    .innerJoin(
      workspacesTable,
      eq(membershipsTable.workspaceId, workspacesTable.id),
    )
    .where(eq(membershipsTable.clerkUserId, userId))
    .orderBy(desc(membershipsTable.createdAt))
    .limit(1);
  return row;
}

export async function firmAccess(
  req: Request,
  res: Response,
  writable = false,
): Promise<FirmAccess | null> {
  const identity = identify(req, res);
  if (!identity) return null;

  const row = await membershipFor(identity.userId);
  if (!row) {
    res.status(403).json({
      error: "You do not have access to a firm workspace.",
      code: "firm_authorization_required",
    });
    return null;
  }

  if (
    writable &&
    !["owner", "admin", "advisor", "professional"].includes(row.membership.role)
  ) {
    res.status(403).json({
      error: "Your firm role does not allow this change.",
      code: "role_not_permitted",
    });
    return null;
  }

  return {
    ...identity,
    workspaceId: row.workspace.id,
    workspaceName: row.workspace.name,
    practiceType: row.workspace.practiceType,
    role: row.membership.role,
  };
}

export function workspaceContext(
  identity: ClientGuardIdentity,
  row: Awaited<ReturnType<typeof membershipFor>>,
) {
  return {
    userId: identity.userId,
    email: row?.membership.email || identity.email,
    name: row?.membership.displayName || identity.name,
    workspace: row
      ? {
          id: row.workspace.id,
          name: row.workspace.name,
          practiceType: row.workspace.practiceType as "law" | "financial" | "both",
          createdAt: row.workspace.createdAt,
        }
      : null,
    role: row?.membership.role ?? null,
  };
}

export async function logActivity(
  access: FirmAccess,
  entityType: "client" | "matter" | "workspace",
  entityId: number,
  entityLabel: string,
  action: string,
): Promise<void> {
  const { activitiesTable } = await import("@workspace/db");
  await db.insert(activitiesTable).values({
    workspaceId: access.workspaceId,
    clerkUserId: access.userId,
    actor: access.name || access.email || "Firm user",
    action,
    entityType,
    entityId,
    entityLabel,
  });
}

export async function logAuditEvent(
  access: FirmAccess,
  action: string,
  entityType: string,
  entityId: number | null,
  entityLabel: string,
  details: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  await db.insert(auditEventsTable).values({
    workspaceId: access.workspaceId,
    clerkUserId: access.userId,
    actor: access.name || access.email || "Firm user",
    action,
    entityType,
    entityId,
    entityLabel,
    details,
  });
}
