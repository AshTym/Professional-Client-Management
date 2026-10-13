import { and, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import * as api from "@workspace/api-zod";
import {
  clientsTable,
  mattersTable,
  practiceSettingsTable,
  trustAccountsTable,
  trustLedgerEntriesTable,
  trustStatementLinesTable,
  trustStatementsTable,
} from "@workspace/db";
import { db } from "@workspace/db";
import { firmAccess, logAuditEvent } from "../lib/clientguard-auth";

const router: IRouter = Router();
const JURISDICTIONS = ["Australia", "USA", "Great Britain"] as const;

function idFrom(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isAdmin(role: string) {
  return role === "owner" || role === "admin";
}

function signedAmount(entryType: string, amountCents: number) {
  return entryType === "deposit" ? amountCents : -amountCents;
}

async function jurisdictionsFor(workspaceId: number) {
  const [settings] = await db.select({ supportedJurisdictions: practiceSettingsTable.supportedJurisdictions })
    .from(practiceSettingsTable)
    .where(eq(practiceSettingsTable.workspaceId, workspaceId))
    .limit(1);
  const allowed = settings?.supportedJurisdictions.filter((value): value is typeof JURISDICTIONS[number] =>
    JURISDICTIONS.includes(value as typeof JURISDICTIONS[number]),
  );
  return allowed?.length ? allowed : [...JURISDICTIONS];
}

router.get("/trust/overview", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  const [jurisdictions, accounts, entryRows, statementRows] = await Promise.all([
    jurisdictionsFor(access.workspaceId),
    db.select().from(trustAccountsTable)
      .where(eq(trustAccountsTable.workspaceId, access.workspaceId))
      .orderBy(trustAccountsTable.name),
    db.select({
      entry: trustLedgerEntriesTable,
      accountName: trustAccountsTable.name,
      currency: trustAccountsTable.currency,
      matterTitle: mattersTable.title,
      clientName: clientsTable.name,
    }).from(trustLedgerEntriesTable)
      .innerJoin(trustAccountsTable, and(
        eq(trustAccountsTable.id, trustLedgerEntriesTable.accountId),
        eq(trustAccountsTable.workspaceId, trustLedgerEntriesTable.workspaceId),
      ))
      .innerJoin(mattersTable, and(
        eq(mattersTable.id, trustLedgerEntriesTable.matterId),
        eq(mattersTable.workspaceId, trustLedgerEntriesTable.workspaceId),
      ))
      .innerJoin(clientsTable, and(
        eq(clientsTable.id, mattersTable.clientId),
        eq(clientsTable.workspaceId, mattersTable.workspaceId),
      ))
      .where(eq(trustLedgerEntriesTable.workspaceId, access.workspaceId))
      .orderBy(desc(trustLedgerEntriesTable.entryDate), desc(trustLedgerEntriesTable.id))
      .limit(300),
    db.select({
      statement: trustStatementsTable,
      accountName: trustAccountsTable.name,
    }).from(trustStatementsTable)
      .innerJoin(trustAccountsTable, and(
        eq(trustAccountsTable.id, trustStatementsTable.accountId),
        eq(trustAccountsTable.workspaceId, trustStatementsTable.workspaceId),
      ))
      .where(eq(trustStatementsTable.workspaceId, access.workspaceId))
      .orderBy(desc(trustStatementsTable.periodEnd), desc(trustStatementsTable.id))
      .limit(80),
  ]);
  const accountIds = accounts.map((account) => account.id);
  const statementIds = statementRows.map(({ statement }) => statement.id);
  const [balances, lines, statementMovements] = await Promise.all([
    accountIds.length
      ? db.select({
          accountId: trustLedgerEntriesTable.accountId,
          balanceCents: sql<number>`coalesce(sum(case when ${trustLedgerEntriesTable.entryType} = 'deposit' then ${trustLedgerEntriesTable.amountCents} else -${trustLedgerEntriesTable.amountCents} end), 0)::int`,
        }).from(trustLedgerEntriesTable)
          .where(and(
            eq(trustLedgerEntriesTable.workspaceId, access.workspaceId),
            eq(trustLedgerEntriesTable.status, "approved"),
            inArray(trustLedgerEntriesTable.accountId, accountIds),
          ))
          .groupBy(trustLedgerEntriesTable.accountId)
      : Promise.resolve([]),
    statementIds.length
      ? db.select().from(trustStatementLinesTable)
          .where(and(
            eq(trustStatementLinesTable.workspaceId, access.workspaceId),
            inArray(trustStatementLinesTable.statementId, statementIds),
          ))
          .orderBy(trustStatementLinesTable.lineDate, trustStatementLinesTable.id)
      : Promise.resolve([]),
    statementIds.length
      ? db.select({
          statementId: trustStatementsTable.id,
          ledgerMovementCents: sql<number>`coalesce(sum(case when ${trustLedgerEntriesTable.entryType} = 'deposit' then ${trustLedgerEntriesTable.amountCents} else -${trustLedgerEntriesTable.amountCents} end), 0)::int`,
        }).from(trustStatementsTable)
          .leftJoin(trustLedgerEntriesTable, and(
            eq(trustLedgerEntriesTable.workspaceId, trustStatementsTable.workspaceId),
            eq(trustLedgerEntriesTable.accountId, trustStatementsTable.accountId),
            eq(trustLedgerEntriesTable.status, "approved"),
            gte(trustLedgerEntriesTable.entryDate, trustStatementsTable.periodStart),
            lte(trustLedgerEntriesTable.entryDate, trustStatementsTable.periodEnd),
          ))
          .where(and(
            eq(trustStatementsTable.workspaceId, access.workspaceId),
            inArray(trustStatementsTable.id, statementIds),
          ))
          .groupBy(trustStatementsTable.id)
      : Promise.resolve([]),
  ]);
  const balanceByAccount = new Map(balances.map((row) => [row.accountId, Number(row.balanceCents)]));
  const linesByStatement = new Map<number, typeof lines>();
  for (const line of lines) {
    const bucket = linesByStatement.get(line.statementId) ?? [];
    bucket.push(line);
    linesByStatement.set(line.statementId, bucket);
  }
  const movementByStatement = new Map(statementMovements.map((row) => [
    row.statementId,
    Number(row.ledgerMovementCents),
  ]));
  const mappedStatements = statementRows.map(({ statement }) => {
    const statementLines = linesByStatement.get(statement.id) ?? [];
    const movementDifferenceCents =
      statement.closingBalanceCents -
      statement.openingBalanceCents -
      (movementByStatement.get(statement.id) ?? 0);
    const matchedLines = statementLines.filter((line) => line.status === "matched").length;
    const unmatchedLineCount = statementLines.length - matchedLines;
    return {
      id: statement.id,
      accountId: statement.accountId,
      sourceType: statement.sourceType,
      sourceName: statement.sourceName,
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      openingBalanceCents: statement.openingBalanceCents,
      closingBalanceCents: statement.closingBalanceCents,
      status: statement.status,
      lineCount: statementLines.length,
      matchedLines,
      unmatchedLineCount,
      movementDifferenceCents,
      createdAt: statement.createdAt,
      lines: statementLines.map((line) => ({
        id: line.id,
        statementId: line.statementId,
        lineDate: line.lineDate,
        description: line.description,
        reference: line.reference,
        amountCents: line.amountCents,
        matchedEntryId: line.matchedEntryId,
        status: line.status,
      })),
    };
  });
  const alerts: Array<{
    id: string;
    severity: "attention" | "warning";
    title: string;
    detail: string;
    accountId: number;
    statementId: number | null;
  }> = [];
  for (const account of accounts) {
    const pendingCount = entryRows.filter((row) =>
      row.entry.accountId === account.id && row.entry.status === "pending_approval",
    ).length;
    if (pendingCount) alerts.push({
      id: `pending-${account.id}`,
      severity: "attention",
      title: "Ledger entries need approval",
      detail: `${pendingCount} pending entr${pendingCount === 1 ? "y" : "ies"} in ${account.name}.`,
      accountId: account.id,
      statementId: null,
    });
  }
  for (const statement of mappedStatements) {
    if (statement.unmatchedLineCount || statement.movementDifferenceCents !== 0) {
      alerts.push({
        id: `statement-${statement.id}`,
        severity: statement.unmatchedLineCount ? "attention" : "warning",
        title: "Statement needs reconciliation",
        detail: `${statement.unmatchedLineCount} unmatched line(s); ledger-to-statement movement difference ${statement.movementDifferenceCents} cents.`,
        accountId: statement.accountId,
        statementId: statement.id,
      });
    }
  }
  await logAuditEvent(access, "trust_ledger_viewed", "trust_ledger", null, "Trust ledger", {
    accountCount: accounts.length,
    entryCount: entryRows.length,
  });
  res.json(api.GetTrustOverviewResponse.parse({
    supportedJurisdictions: jurisdictions,
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      jurisdiction: account.jurisdiction,
      currency: account.currency,
      accountReference: account.accountReference,
      requireSecondApproval: account.requireSecondApproval,
      active: account.active,
      balanceCents: balanceByAccount.get(account.id) ?? 0,
      createdAt: account.createdAt,
    })),
    entries: entryRows.map(({ entry, accountName, currency, matterTitle, clientName }) => ({
      id: entry.id,
      accountId: entry.accountId,
      accountName,
      matterId: entry.matterId,
      matterTitle,
      clientName,
      entryType: entry.entryType,
      amountCents: entry.amountCents,
      currency,
      entryDate: entry.entryDate,
      description: entry.description,
      reference: entry.reference,
      status: entry.status,
      createdBy: "Firm teammate",
      approvedBy: entry.approvedByClerkUserId ? "Firm teammate" : null,
      approvedAt: entry.approvedAt,
      createdAt: entry.createdAt,
    })),
    statements: mappedStatements,
    alerts,
  }));
});

router.get("/trust/statement", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  const parsed = api.GetTrustAccountStatementQueryParams.safeParse(req.query);
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
    res.status(400).json({ error: "The statement start date must be on or before the end date." });
    return;
  }
  const [account] = await db.select().from(trustAccountsTable).where(and(
    eq(trustAccountsTable.id, parsed.data.accountId),
    eq(trustAccountsTable.workspaceId, access.workspaceId),
  )).limit(1);
  const [matter] = await db.select({
    matterId: mattersTable.id,
    matterTitle: mattersTable.title,
    clientName: clientsTable.name,
  }).from(mattersTable).innerJoin(clientsTable, and(
    eq(clientsTable.id, mattersTable.clientId),
    eq(clientsTable.workspaceId, mattersTable.workspaceId),
  )).where(and(
    eq(mattersTable.id, parsed.data.matterId),
    eq(mattersTable.workspaceId, access.workspaceId),
  )).limit(1);
  if (!account || !matter) {
    res.status(404).json({ error: "Trust account or matter not found in this firm." });
    return;
  }
  const [opening] = await db.select({
    balanceCents: sql<number>`coalesce(sum(case when ${trustLedgerEntriesTable.entryType} = 'deposit' then ${trustLedgerEntriesTable.amountCents} else -${trustLedgerEntriesTable.amountCents} end), 0)`,
  }).from(trustLedgerEntriesTable).where(and(
    eq(trustLedgerEntriesTable.workspaceId, access.workspaceId),
    eq(trustLedgerEntriesTable.accountId, account.id),
    eq(trustLedgerEntriesTable.matterId, matter.matterId),
    eq(trustLedgerEntriesTable.status, "approved"),
    lt(trustLedgerEntriesTable.entryDate, from),
  ));
  const openingBalanceCents = Number(opening.balanceCents);
  const rows = await db.select({
    id: trustLedgerEntriesTable.id,
    entryDate: trustLedgerEntriesTable.entryDate,
    description: trustLedgerEntriesTable.description,
    reference: trustLedgerEntriesTable.reference,
    entryType: trustLedgerEntriesTable.entryType,
    amountCents: trustLedgerEntriesTable.amountCents,
  }).from(trustLedgerEntriesTable).where(and(
    eq(trustLedgerEntriesTable.workspaceId, access.workspaceId),
    eq(trustLedgerEntriesTable.accountId, account.id),
    eq(trustLedgerEntriesTable.matterId, matter.matterId),
    eq(trustLedgerEntriesTable.status, "approved"),
    gte(trustLedgerEntriesTable.entryDate, from),
    lte(trustLedgerEntriesTable.entryDate, to),
  )).orderBy(trustLedgerEntriesTable.entryDate, trustLedgerEntriesTable.id);
  let balanceCents = openingBalanceCents;
  const entries = rows.map((entry) => {
    balanceCents += signedAmount(entry.entryType, entry.amountCents);
    return {
      ...entry,
      balanceCents,
    };
  });
  await logAuditEvent(access, "trust_account_statement_exported", "trust_account", account.id, account.name, {
    matterId: matter.matterId,
    from,
    to,
    entryCount: entries.length,
  });
  res.json(api.GetTrustAccountStatementResponse.parse({
    accountId: account.id,
    accountName: account.name,
    jurisdiction: account.jurisdiction,
    currency: account.currency,
    matterId: matter.matterId,
    matterTitle: matter.matterTitle,
    clientName: matter.clientName,
    from,
    to,
    openingBalanceCents,
    closingBalanceCents: balanceCents,
    entries,
  }));
});

router.post("/trust/accounts", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  if (!isAdmin(access.role)) {
    res.status(403).json({ error: "Only a firm owner or admin can configure trust accounts." });
    return;
  }
  const parsed = api.CreateTrustAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const jurisdictions = await jurisdictionsFor(access.workspaceId);
  if (!jurisdictions.includes(parsed.data.jurisdiction as typeof JURISDICTIONS[number])) {
    res.status(409).json({ error: "That jurisdiction is not enabled in this firm's practice settings." });
    return;
  }
  const currency = parsed.data.currency.toUpperCase();
  try {
    new Intl.NumberFormat("en", { style: "currency", currency }).format(0);
  } catch {
    res.status(400).json({ error: "Enter a valid three-letter currency code." });
    return;
  }
  const [account] = await db.insert(trustAccountsTable).values({
    workspaceId: access.workspaceId,
    name: parsed.data.name.trim(),
    jurisdiction: parsed.data.jurisdiction,
    currency,
    accountReference: parsed.data.accountReference?.trim() || null,
    requireSecondApproval: parsed.data.requireSecondApproval,
    createdByClerkUserId: access.userId,
  }).returning();
  await logAuditEvent(access, "trust_account_created", "trust_account", account.id, account.name, {
    jurisdiction: account.jurisdiction,
    currency: account.currency,
    secondApprovalRequired: account.requireSecondApproval,
  });
  res.status(201).json(api.CreateTrustAccountResponse.parse({
    ...account,
    balanceCents: 0,
  }));
});

router.post("/trust/entries", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const parsed = api.CreateTrustEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [account] = await db.select().from(trustAccountsTable).where(and(
    eq(trustAccountsTable.id, parsed.data.accountId),
    eq(trustAccountsTable.workspaceId, access.workspaceId),
  )).limit(1);
  const [matter] = await db.select({
    matter: mattersTable,
    clientName: clientsTable.name,
  }).from(mattersTable)
    .innerJoin(clientsTable, and(
      eq(clientsTable.id, mattersTable.clientId),
      eq(clientsTable.workspaceId, mattersTable.workspaceId),
    ))
    .where(and(
      eq(mattersTable.id, parsed.data.matterId),
      eq(mattersTable.workspaceId, access.workspaceId),
    ))
    .limit(1);
  if (!account || !account.active || !matter) {
    res.status(404).json({ error: "Select an active trust account and a matter in this firm." });
    return;
  }
  if (matter.matter.status === "closed") {
    res.status(409).json({ error: "A closed matter cannot receive a new trust ledger entry." });
    return;
  }
  const [entry] = await db.insert(trustLedgerEntriesTable).values({
    workspaceId: access.workspaceId,
    accountId: account.id,
    matterId: matter.matter.id,
    entryType: parsed.data.entryType,
    amountCents: parsed.data.amountCents,
    entryDate: parsed.data.entryDate instanceof Date
      ? parsed.data.entryDate.toISOString().slice(0, 10)
      : parsed.data.entryDate,
    description: parsed.data.description.trim(),
    reference: parsed.data.reference?.trim() || null,
    status: "pending_approval",
    createdByClerkUserId: access.userId,
  }).returning();
  await logAuditEvent(access, "trust_ledger_entry_created", "trust_ledger_entry", entry.id, entry.description, {
    accountId: account.id,
    matterId: matter.matter.id,
    entryType: entry.entryType,
    amountCents: entry.amountCents,
  });
  res.status(201).json(api.CreateTrustEntryResponse.parse({
    id: entry.id,
    accountId: account.id,
    accountName: account.name,
    matterId: matter.matter.id,
    matterTitle: matter.matter.title,
    clientName: matter.clientName,
    entryType: entry.entryType,
    amountCents: entry.amountCents,
    currency: account.currency,
    entryDate: entry.entryDate,
    description: entry.description,
    reference: entry.reference,
    status: entry.status,
    createdBy: "Firm teammate",
    approvedBy: null,
    approvedAt: null,
    createdAt: entry.createdAt,
  }));
});

router.patch("/trust/entries/:id/decision", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  if (!isAdmin(access.role)) {
    res.status(403).json({ error: "Only a firm owner or admin can approve trust ledger entries." });
    return;
  }
  const params = api.DecideTrustEntryParams.safeParse(req.params);
  const body = api.DecideTrustEntryBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const outcome = await db.transaction(async (tx) => {
    const [entry] = await tx.select().from(trustLedgerEntriesTable).where(and(
      eq(trustLedgerEntriesTable.id, params.data.id),
      eq(trustLedgerEntriesTable.workspaceId, access.workspaceId),
    )).for("update").limit(1);
    if (!entry) return { kind: "missing" as const };
    if (entry.status !== "pending_approval") return { kind: "already-decided" as const };
    const [account] = await tx.select().from(trustAccountsTable).where(and(
      eq(trustAccountsTable.id, entry.accountId),
      eq(trustAccountsTable.workspaceId, access.workspaceId),
    )).for("update").limit(1);
    if (!account) return { kind: "missing-account" as const };
    if (account.requireSecondApproval && entry.createdByClerkUserId === access.userId) {
      return { kind: "same-approver" as const };
    }
    const [updated] = await tx.update(trustLedgerEntriesTable).set({
      status: body.data.decision === "approve" ? "approved" : "rejected",
      approvedByClerkUserId: access.userId,
      approvedAt: new Date(),
    }).where(and(
      eq(trustLedgerEntriesTable.id, entry.id),
      eq(trustLedgerEntriesTable.status, "pending_approval"),
    )).returning();
    return updated ? { kind: "decided" as const, entry: updated, account } : { kind: "already-decided" as const };
  });
  if (outcome.kind === "missing" || outcome.kind === "missing-account") {
    res.status(404).json({ error: "Trust ledger entry not found." });
    return;
  }
  if (outcome.kind === "same-approver") {
    res.status(409).json({ error: "This account requires a second firm member to approve the entry." });
    return;
  }
  if (outcome.kind === "already-decided") {
    res.status(409).json({ error: "This trust ledger entry has already been decided." });
    return;
  }
  const [matter] = await db.select({
    matterTitle: mattersTable.title,
    clientName: clientsTable.name,
  }).from(mattersTable).innerJoin(clientsTable, and(
    eq(clientsTable.id, mattersTable.clientId),
    eq(clientsTable.workspaceId, mattersTable.workspaceId),
  )).where(and(
    eq(mattersTable.id, outcome.entry.matterId),
    eq(mattersTable.workspaceId, access.workspaceId),
  )).limit(1);
  const decisionStatus = body.data.decision === "approve" ? "approved" : "rejected";
  await logAuditEvent(access, `trust_ledger_entry_${decisionStatus}`, "trust_ledger_entry", outcome.entry.id, outcome.entry.description, {
    accountId: outcome.account.id,
    matterId: outcome.entry.matterId,
    note: body.data.note.trim(),
  });
  res.json(api.DecideTrustEntryResponse.parse({
    id: outcome.entry.id,
    accountId: outcome.account.id,
    accountName: outcome.account.name,
    matterId: outcome.entry.matterId,
    matterTitle: matter?.matterTitle ?? "",
    clientName: matter?.clientName ?? "",
    entryType: outcome.entry.entryType,
    amountCents: outcome.entry.amountCents,
    currency: outcome.account.currency,
    entryDate: outcome.entry.entryDate,
    description: outcome.entry.description,
    reference: outcome.entry.reference,
    status: outcome.entry.status,
    createdBy: "Firm teammate",
    approvedBy: "Firm teammate",
    approvedAt: outcome.entry.approvedAt,
    createdAt: outcome.entry.createdAt,
  }));
});

router.post("/trust/statements", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  if (!isAdmin(access.role)) {
    res.status(403).json({ error: "Only a firm owner or admin can import trust statements." });
    return;
  }
  const parsed = api.ImportTrustStatementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const periodStart = input.periodStart instanceof Date
    ? input.periodStart.toISOString().slice(0, 10)
    : input.periodStart;
  const periodEnd = input.periodEnd instanceof Date
    ? input.periodEnd.toISOString().slice(0, 10)
    : input.periodEnd;
  if (periodStart > periodEnd || input.lines.some((line) => line.amountCents === 0)) {
    res.status(400).json({ error: "Statement dates must be ordered and each line must have a non-zero amount." });
    return;
  }
  const [account] = await db.select().from(trustAccountsTable).where(and(
    eq(trustAccountsTable.id, input.accountId),
    eq(trustAccountsTable.workspaceId, access.workspaceId),
    eq(trustAccountsTable.active, true),
  )).limit(1);
  if (!account) {
    res.status(404).json({ error: "Active trust account not found." });
    return;
  }
  const [statement] = await db.transaction(async (tx) => {
    const [created] = await tx.insert(trustStatementsTable).values({
      workspaceId: access.workspaceId,
      accountId: account.id,
      sourceType: input.sourceType,
      sourceName: input.sourceName.trim(),
      periodStart,
      periodEnd,
      openingBalanceCents: input.openingBalanceCents,
      closingBalanceCents: input.closingBalanceCents,
      importedByClerkUserId: access.userId,
    }).returning();
    await tx.insert(trustStatementLinesTable).values(input.lines.map((line) => ({
      workspaceId: access.workspaceId,
      statementId: created.id,
      lineDate: line.lineDate instanceof Date
        ? line.lineDate.toISOString().slice(0, 10)
        : line.lineDate,
      description: line.description.trim(),
      reference: line.reference?.trim() || null,
      amountCents: line.amountCents,
    })));
    return [created];
  });
  const [lines] = await Promise.all([
    db.select().from(trustStatementLinesTable).where(and(
      eq(trustStatementLinesTable.statementId, statement.id),
      eq(trustStatementLinesTable.workspaceId, access.workspaceId),
    )),
  ]);
  const ledgerRows = await db.select({
    entryType: trustLedgerEntriesTable.entryType,
    amountCents: trustLedgerEntriesTable.amountCents,
  }).from(trustLedgerEntriesTable).where(and(
    eq(trustLedgerEntriesTable.workspaceId, access.workspaceId),
    eq(trustLedgerEntriesTable.accountId, account.id),
    eq(trustLedgerEntriesTable.status, "approved"),
    gte(trustLedgerEntriesTable.entryDate, statement.periodStart),
    lte(trustLedgerEntriesTable.entryDate, statement.periodEnd),
  ));
  const ledgerMovement = ledgerRows.reduce((sum, entry) =>
    sum + signedAmount(entry.entryType, entry.amountCents), 0);
  const movementDifferenceCents = statement.closingBalanceCents - statement.openingBalanceCents - ledgerMovement;
  const result = statement;
  await logAuditEvent(access, "trust_statement_imported", "trust_statement", statement.id, statement.sourceName, {
    accountId: account.id,
    lineCount: lines.length,
    movementDifferenceCents,
  });
  res.status(201).json(api.ImportTrustStatementResponse.parse({
    id: result.id,
    accountId: result.accountId,
    sourceType: result.sourceType,
    sourceName: result.sourceName,
    periodStart: result.periodStart,
    periodEnd: result.periodEnd,
    openingBalanceCents: result.openingBalanceCents,
    closingBalanceCents: result.closingBalanceCents,
    status: result.status,
    lineCount: lines.length,
    matchedLines: 0,
    unmatchedLineCount: lines.length,
    movementDifferenceCents,
    createdAt: result.createdAt,
    lines: lines.map((line) => ({
      id: line.id,
      statementId: line.statementId,
      lineDate: line.lineDate,
      description: line.description,
      reference: line.reference,
      amountCents: line.amountCents,
      matchedEntryId: line.matchedEntryId,
      status: line.status,
    })),
  }));
});

router.patch("/trust/statements/:statementId/lines/:lineId", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  if (!isAdmin(access.role)) {
    res.status(403).json({ error: "Only a firm owner or admin can reconcile trust statements." });
    return;
  }
  const params = api.MatchTrustStatementLineParams.safeParse(req.params);
  const body = api.MatchTrustStatementLineBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const outcome = await db.transaction(async (tx) => {
    const [statement] = await tx.select().from(trustStatementsTable).where(and(
      eq(trustStatementsTable.id, params.data.statementId),
      eq(trustStatementsTable.workspaceId, access.workspaceId),
    )).for("update").limit(1);
    const [line] = await tx.select().from(trustStatementLinesTable).where(and(
      eq(trustStatementLinesTable.id, params.data.lineId),
      eq(trustStatementLinesTable.statementId, params.data.statementId),
      eq(trustStatementLinesTable.workspaceId, access.workspaceId),
    )).for("update").limit(1);
    if (!statement || !line) return { kind: "missing" as const };
    if (statement.status === "reconciled") return { kind: "locked" as const };
    if (body.data.matchedEntryId === null) {
      await tx.update(trustStatementLinesTable).set({
        matchedEntryId: null,
        status: "unmatched",
      }).where(eq(trustStatementLinesTable.id, line.id));
      return { kind: "updated" as const, statementId: statement.id };
    }
    const [entry] = await tx.select().from(trustLedgerEntriesTable).where(and(
      eq(trustLedgerEntriesTable.id, body.data.matchedEntryId),
      eq(trustLedgerEntriesTable.workspaceId, access.workspaceId),
      eq(trustLedgerEntriesTable.accountId, statement.accountId),
      eq(trustLedgerEntriesTable.status, "approved"),
      gte(trustLedgerEntriesTable.entryDate, statement.periodStart),
      lte(trustLedgerEntriesTable.entryDate, statement.periodEnd),
    )).for("update").limit(1);
    if (!entry) return { kind: "entry-missing" as const };
    if (signedAmount(entry.entryType, entry.amountCents) !== line.amountCents) {
      return { kind: "amount-mismatch" as const };
    }
    const [existingMatch] = await tx.select({ id: trustStatementLinesTable.id })
      .from(trustStatementLinesTable)
      .where(and(
        eq(trustStatementLinesTable.workspaceId, access.workspaceId),
        eq(trustStatementLinesTable.matchedEntryId, entry.id),
      ))
      .limit(1);
    if (existingMatch && existingMatch.id !== line.id) return { kind: "already-matched" as const };
    await tx.update(trustStatementLinesTable).set({
      matchedEntryId: entry.id,
      status: "matched",
    }).where(eq(trustStatementLinesTable.id, line.id));
    const openLines = await tx.select({ id: trustStatementLinesTable.id }).from(trustStatementLinesTable).where(and(
      eq(trustStatementLinesTable.workspaceId, access.workspaceId),
      eq(trustStatementLinesTable.statementId, statement.id),
      eq(trustStatementLinesTable.status, "unmatched"),
    ));
    const [movement] = await tx.select({
      ledgerMovementCents: sql<number>`coalesce(sum(case when ${trustLedgerEntriesTable.entryType} = 'deposit' then ${trustLedgerEntriesTable.amountCents} else -${trustLedgerEntriesTable.amountCents} end), 0)`,
    }).from(trustLedgerEntriesTable).where(and(
      eq(trustLedgerEntriesTable.workspaceId, access.workspaceId),
      eq(trustLedgerEntriesTable.accountId, statement.accountId),
      eq(trustLedgerEntriesTable.status, "approved"),
      gte(trustLedgerEntriesTable.entryDate, statement.periodStart),
      lte(trustLedgerEntriesTable.entryDate, statement.periodEnd),
    ));
    const movementDifference =
      statement.closingBalanceCents -
      statement.openingBalanceCents -
      Number(movement.ledgerMovementCents);
    if (openLines.length === 0 && movementDifference === 0) {
      await tx.update(trustStatementsTable).set({
        status: "reconciled",
        reconciledByClerkUserId: access.userId,
        reconciledAt: new Date(),
      }).where(eq(trustStatementsTable.id, statement.id));
    }
    return { kind: "updated" as const, statementId: statement.id };
  });
  if (outcome.kind === "missing") {
    res.status(404).json({ error: "Trust statement line not found." });
    return;
  }
  if (outcome.kind === "locked") {
    res.status(409).json({ error: "This statement is already reconciled." });
    return;
  }
  if (outcome.kind === "entry-missing") {
    res.status(404).json({ error: "Choose an approved ledger entry from this account and statement period." });
    return;
  }
  if (outcome.kind === "amount-mismatch") {
    res.status(409).json({ error: "The statement line amount does not match the signed ledger movement." });
    return;
  }
  if (outcome.kind === "already-matched") {
    res.status(409).json({ error: "That ledger entry is already matched to another statement line." });
    return;
  }
  await logAuditEvent(access, "trust_statement_line_reconciled", "trust_statement", outcome.statementId, "Statement line", {
    lineId: params.data.lineId,
    matchedEntryId: body.data.matchedEntryId,
  });
  const [statement] = await db.select({
    statement: trustStatementsTable,
  }).from(trustStatementsTable).where(and(
    eq(trustStatementsTable.id, outcome.statementId),
    eq(trustStatementsTable.workspaceId, access.workspaceId),
  )).limit(1);
  if (!statement) {
    res.status(404).json({ error: "Trust statement not found." });
    return;
  }
  const statementLines = await db.select().from(trustStatementLinesTable).where(and(
    eq(trustStatementLinesTable.statementId, outcome.statementId),
    eq(trustStatementLinesTable.workspaceId, access.workspaceId),
  ));
  const ledgerRows = await db.select({
    entryType: trustLedgerEntriesTable.entryType,
    amountCents: trustLedgerEntriesTable.amountCents,
  }).from(trustLedgerEntriesTable).where(and(
    eq(trustLedgerEntriesTable.workspaceId, access.workspaceId),
    eq(trustLedgerEntriesTable.accountId, statement.statement.accountId),
    eq(trustLedgerEntriesTable.status, "approved"),
    gte(trustLedgerEntriesTable.entryDate, statement.statement.periodStart),
    lte(trustLedgerEntriesTable.entryDate, statement.statement.periodEnd),
  ));
  const ledgerMovement = ledgerRows.reduce((sum, entry) => sum + signedAmount(entry.entryType, entry.amountCents), 0);
  const matchedLines = statementLines.filter((item) => item.status === "matched").length;
  const movementDifferenceCents = statement.statement.closingBalanceCents - statement.statement.openingBalanceCents - ledgerMovement;
  res.json(api.MatchTrustStatementLineResponse.parse({
    id: statement.statement.id,
    accountId: statement.statement.accountId,
    sourceType: statement.statement.sourceType,
    sourceName: statement.statement.sourceName,
    periodStart: statement.statement.periodStart,
    periodEnd: statement.statement.periodEnd,
    openingBalanceCents: statement.statement.openingBalanceCents,
    closingBalanceCents: statement.statement.closingBalanceCents,
    status: statement.statement.status,
    lineCount: statementLines.length,
    matchedLines,
    unmatchedLineCount: statementLines.length - matchedLines,
    movementDifferenceCents,
    createdAt: statement.statement.createdAt,
    lines: statementLines.map((line) => ({
      id: line.id,
      statementId: line.statementId,
      lineDate: line.lineDate,
      description: line.description,
      reference: line.reference,
      amountCents: line.amountCents,
      matchedEntryId: line.matchedEntryId,
      status: line.status,
    })),
  }));
});

export default router;
