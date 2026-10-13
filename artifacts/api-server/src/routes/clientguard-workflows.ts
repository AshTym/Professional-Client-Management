import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { pipeline } from "node:stream/promises";
import { db } from "@workspace/db";
import {
  billingDraftsTable,
  billingProfilesTable,
  clientsTable,
  documentSuggestionsTable,
  documentsTable,
  legalHoldsTable,
  mattersTable,
  plannerItemsTable,
  timeEntriesTable,
  updateDraftsTable,
  updateSchedulesTable,
} from "@workspace/db";
import {
  AnalyzeDocumentParams,
  AnalyzeDocumentResponse,
  UpdateBillingDraftBody,
  UpdateBillingDraftParams,
  UpdateBillingDraftResponse,
  CreateClientUpdateDraftBody,
  CreateClientUpdateDraftResponse,
  UpdateClientUpdateDraftBody,
  UpdateClientUpdateDraftParams,
  UpdateClientUpdateDraftResponse,
  CompleteDocumentUploadParams,
  CompleteDocumentUploadResponse,
  CreateTimeEntryBody,
  CreateTimeEntryResponse,
  DeleteMatterDocumentParams,
  GetBillingOverviewResponse,
  GetClientUpdateOverviewResponse,
  GetDocumentOverviewResponse,
  MarkMatterDocumentReviewedParams,
  MarkMatterDocumentReviewedResponse,
  RequestDocumentUploadBody,
  RequestDocumentUploadResponse,
  ReviewDocumentSuggestionBody,
  ReviewDocumentSuggestionParams,
  ReviewDocumentSuggestionResponse,
  SaveBillingProfileBody,
  SaveBillingProfileResponse,
  SaveClientUpdateScheduleBody,
  SaveClientUpdateScheduleResponse,
  UpdatePlannerItemBody,
  UpdatePlannerItemParams,
  UpdatePlannerItemResponse,
} from "@workspace/api-zod";
import { firmAccess, logActivity, logAuditEvent } from "../lib/clientguard-auth";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import {
  analyzeDocument as analyzeDocumentContent,
  createClientUpdateDraft,
  getBillingOverview,
  getClientUpdateOverview,
  getDocumentOverview,
  nextCadenceDate,
} from "../lib/clientguard-workflows-service";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const allowedDocumentTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

function routeId(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

async function documentForWorkspace(workspaceId: number, id: number) {
  const [document] = await db
    .select()
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.workspaceId, workspaceId),
        eq(documentsTable.id, id),
      ),
    )
    .limit(1);
  return document;
}

async function matterForWorkspace(workspaceId: number, matterId: number) {
  const [matter] = await db
    .select({
      id: mattersTable.id,
      title: mattersTable.title,
      clientId: mattersTable.clientId,
      status: mattersTable.status,
      workspaceId: mattersTable.workspaceId,
      clientName: clientsTable.name,
    })
    .from(mattersTable)
    .innerJoin(clientsTable, eq(mattersTable.clientId, clientsTable.id))
    .where(
      and(
        eq(mattersTable.workspaceId, workspaceId),
        eq(mattersTable.id, matterId),
      ),
    )
    .limit(1);
  return matter;
}

router.get("/billing", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  const overview = await getBillingOverview(access.workspaceId);
  await logAuditEvent(access, "billing_records_viewed", "billing", null, "Billing overview", {
    draftCount: overview.drafts.length,
  });
  res.json(GetBillingOverviewResponse.parse(overview));
});

router.put("/billing", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const parsed = SaveBillingProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const currency = input.currency.toUpperCase();
  let currencyIsSupported = false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency });
    currencyIsSupported = true;
  } catch {
    currencyIsSupported = false;
  }
  if (!/^[A-Z]{3}$/.test(currency) || !currencyIsSupported) {
    res.status(400).json({ error: "Currency must be a three-letter code." });
    return;
  }
  if (!input.feeDescription.trim()) {
    res.status(400).json({ error: "Enter a fee description." });
    return;
  }
  if (
    (input.feeType === "hourly" &&
      (!input.hourlyRateCents || input.hourlyRateCents > 10_000_000)) ||
    (input.feeType === "fixed" &&
      (!input.fixedFeeCents || input.fixedFeeCents > 100_000_000))
  ) {
    res.status(400).json({
      error: "Enter a positive rate or fee within the supported limit.",
    });
    return;
  }
  const matter = await matterForWorkspace(access.workspaceId, input.matterId);
  if (!matter) {
    res.status(404).json({ error: "Matter not found." });
    return;
  }

  const nextDraftAt = toDate(input.nextDraftAt);
  if (Number.isNaN(nextDraftAt.getTime())) {
    res.status(400).json({ error: "Choose a valid next draft date." });
    return;
  }
  const [existing] = await db
    .select()
    .from(billingProfilesTable)
    .where(
      and(
        eq(billingProfilesTable.workspaceId, access.workspaceId),
        eq(billingProfilesTable.matterId, input.matterId),
      ),
    )
    .limit(1);

  const values = {
    feeType: input.feeType,
    currency,
    hourlyRateCents:
      input.feeType === "hourly" ? input.hourlyRateCents : null,
    fixedFeeCents:
      input.feeType === "fixed" ? input.fixedFeeCents : null,
    feeDescription: input.feeDescription.trim(),
    billingCycle: input.billingCycle,
    taxRateBps: input.taxRateBps,
    scheduleEnabled: input.scheduleEnabled,
    nextDraftAt,
  };
  const [profile] = existing
    ? await db
        .update(billingProfilesTable)
        .set(values)
        .where(eq(billingProfilesTable.id, existing.id))
        .returning()
    : await db
        .insert(billingProfilesTable)
        .values({
          ...values,
          workspaceId: access.workspaceId,
          matterId: input.matterId,
          periodStartAt: new Date(),
        })
        .returning();

  res.json(
    SaveBillingProfileResponse.parse({
      ...profile,
      matterTitle: matter.title,
      clientName: matter.clientName,
    }),
  );
});

router.post("/billing/time-entries", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const parsed = CreateTimeEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const matter = await matterForWorkspace(access.workspaceId, input.matterId);
  if (!matter) {
    res.status(404).json({ error: "Matter not found." });
    return;
  }
  const [entry] = await db
    .insert(timeEntriesTable)
    .values({
      workspaceId: access.workspaceId,
      matterId: input.matterId,
      clerkUserId: access.userId,
      description: input.description.trim(),
      workDate:
        input.workDate instanceof Date
          ? input.workDate.toISOString().slice(0, 10)
          : input.workDate,
      durationMinutes: input.durationMinutes,
      billable: input.billable,
    })
    .returning();
  await logActivity(
    access,
    "matter",
    matter.id,
    input.description.trim(),
    "recorded work",
  );
  res.status(201).json(
    CreateTimeEntryResponse.parse({ ...entry, matterTitle: matter.title }),
  );
});

router.patch("/billing/drafts/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = UpdateBillingDraftParams.safeParse(req.params);
  const body = UpdateBillingDraftBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: !params.success
        ? params.error.message
        : !body.success
          ? body.error.message
          : "Invalid draft update.",
    });
    return;
  }
  const [draft] = await db
    .update(billingDraftsTable)
    .set({
      status: body.data.status,
      reviewedAt: body.data.status === "reviewed" ? new Date() : null,
    })
    .where(
      and(
        eq(billingDraftsTable.id, params.data.id),
        eq(billingDraftsTable.workspaceId, access.workspaceId),
      ),
    )
    .returning();
  if (!draft) {
    res.status(404).json({ error: "Draft bill not found." });
    return;
  }
  if (body.data.status === "reviewed") {
    await logAuditEvent(access, "ai_bill_draft_approved", "billing_draft", draft.id, `Billing draft ${draft.id}`);
  }
  const matter = await matterForWorkspace(access.workspaceId, draft.matterId);
  res.json(
    UpdateBillingDraftResponse.parse({
      ...draft,
      matterTitle: matter?.title ?? "",
      clientName: matter?.clientName ?? "",
    }),
  );
});

router.get("/documents", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  const overview = await getDocumentOverview(access.workspaceId);
  await logAuditEvent(access, "document_records_viewed", "documents", null, "Matter documents", {
    documentCount: overview.documents.length,
  });
  res.json(
    GetDocumentOverviewResponse.parse(overview),
  );
});

router.post("/documents/:id/review", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = MarkMatterDocumentReviewedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const document = await documentForWorkspace(access.workspaceId, params.data.id);
  if (!document) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  if (!document.uploadedFromPortal || document.status === "uploading") {
    res.status(409).json({ error: "Only completed client portal uploads can be marked reviewed." });
    return;
  }

  const [updated] = document.reviewedAt
    ? [undefined]
    : await db
      .update(documentsTable)
      .set({ reviewedAt: new Date() })
      .where(
        and(
          eq(documentsTable.id, document.id),
          eq(documentsTable.workspaceId, access.workspaceId),
          isNull(documentsTable.reviewedAt),
        ),
      )
      .returning();
  const reviewed = updated ?? await documentForWorkspace(access.workspaceId, document.id);
  if (!reviewed) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  const matter = await matterForWorkspace(access.workspaceId, reviewed.matterId);
  if (updated) {
    await logAuditEvent(
      access,
      "client_portal_document_reviewed",
      "document",
      reviewed.id,
      reviewed.originalName,
      { matterId: reviewed.matterId },
    );
  }
  res.json(MarkMatterDocumentReviewedResponse.parse({
    ...reviewed,
    matterTitle: matter?.title ?? "",
  }));
});

router.post("/documents/upload-url", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const parsed = RequestDocumentUploadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  if (
    input.size > MAX_UPLOAD_BYTES ||
    !allowedDocumentTypes.has(input.contentType)
  ) {
    res.status(400).json({
      error: "Upload a PDF, DOCX, or plain-text file up to 15 MB.",
    });
    return;
  }
  const matter = await matterForWorkspace(access.workspaceId, input.matterId);
  if (!matter) {
    res.status(404).json({ error: "Matter not found." });
    return;
  }

  const uploadURL = await objectStorage.getObjectEntityUploadURL();
  const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
  if (!objectPath.startsWith("/objects/uploads/")) {
    res.status(502).json({ error: "Could not create a private upload." });
    return;
  }
  const [document] = await db
    .insert(documentsTable)
    .values({
      workspaceId: access.workspaceId,
      matterId: input.matterId,
      uploadedByClerkUserId: access.userId,
      objectPath,
      originalName: input.name.trim(),
      contentType: input.contentType,
      sizeBytes: input.size,
      status: "uploading",
    })
    .returning();
  res.status(201).json(
    RequestDocumentUploadResponse.parse({
      id: document.id,
      uploadURL,
      objectPath,
      originalName: document.originalName,
    }),
  );
});

router.post("/documents/:id/complete", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = CompleteDocumentUploadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const document = await documentForWorkspace(
    access.workspaceId,
    params.data.id,
  );
  if (!document) {
    res.status(404).json({ error: "Document upload not found." });
    return;
  }
  if (document.status !== "uploading") {
    const matter = await matterForWorkspace(access.workspaceId, document.matterId);
    res.json(
      CompleteDocumentUploadResponse.parse({
        ...document,
        matterTitle: matter?.title ?? "",
      }),
    );
    return;
  }
  try {
    const file = await objectStorage.getObjectEntityFile(document.objectPath);
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size ?? 0) !== document.sizeBytes) {
      res.status(400).json({ error: "The uploaded file size does not match." });
      return;
    }
    const storedContentType = metadata.contentType?.split(";")[0].trim().toLowerCase();
    if (storedContentType && storedContentType !== document.contentType) {
      res.status(400).json({ error: "The uploaded file type does not match." });
      return;
    }
    const [ready] = await db
      .update(documentsTable)
      .set({ status: "ready" })
      .where(
        and(
          eq(documentsTable.id, document.id),
          eq(documentsTable.workspaceId, access.workspaceId),
        ),
      )
      .returning();
    const matter = await matterForWorkspace(access.workspaceId, document.matterId);
    res.json(
      CompleteDocumentUploadResponse.parse({
        ...ready,
        matterTitle: matter?.title ?? "",
      }),
    );
  } catch (error) {
    req.log.warn({ err: error, documentId: document.id }, "Uploaded object not found");
    res.status(404).json({ error: "The uploaded file was not found in private storage." });
  }
});

router.post("/documents/:id/analyze", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = AnalyzeDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const document = await documentForWorkspace(access.workspaceId, params.data.id);
  if (!document) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  if (document.status === "analyzed") {
    const overview = await getDocumentOverview(access.workspaceId);
    res.json(
      AnalyzeDocumentResponse.parse(
        overview.suggestions.filter(
          (suggestion) => suggestion.documentId === document.id,
        ),
      ),
    );
    return;
  }
  if (document.status !== "ready" && document.status !== "failed") {
    res.status(400).json({ error: "Complete the upload before analyzing it." });
    return;
  }
  await db
    .update(documentsTable)
    .set({ status: "analyzing", lastAnalysisError: null })
    .where(eq(documentsTable.id, document.id));
  try {
    const file = await objectStorage.getObjectEntityFile(document.objectPath);
    const [bytes] = await file.download();
    const analyzed = await analyzeDocumentContent(document, bytes);
    const overview = await getDocumentOverview(access.workspaceId);
    res.json(
      AnalyzeDocumentResponse.parse(
        overview.suggestions.filter(
          (suggestion) => suggestion.documentId === document.id,
        ),
      ),
    );
    req.log.info(
      {
        documentId: document.id,
        suggestionCount: analyzed.suggestions.length,
        sourcePageCount: analyzed.sourcePageCount,
      },
      "Matter document analyzed",
    );
  } catch (error) {
    const detail =
      error instanceof Error &&
      /No selectable text|more than 120 pages|too much text|Only PDF/i.test(
        error.message,
      )
        ? error.message
        : "Document analysis failed. Check the file and try again.";
    await db
      .update(documentsTable)
      .set({ status: "failed", lastAnalysisError: detail })
      .where(eq(documentsTable.id, document.id));
    req.log.error({ err: error, documentId: document.id }, "Matter document analysis failed");
    res.status(422).json({ error: detail });
  }
});

router.get("/documents/:id/file", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  const id = routeId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid document ID." });
    return;
  }
  const document = await documentForWorkspace(access.workspaceId, id);
  if (!document || document.status === "uploading") {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  await logAuditEvent(access, "document_downloaded", "document", document.id, document.originalName);
  try {
    const file = await objectStorage.getObjectEntityFile(document.objectPath);
    const [metadata] = await file.getMetadata();
    const safeName = encodeURIComponent(document.originalName.replace(/[\r\n]/g, ""));
    res.setHeader("Content-Type", document.contentType);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${safeName}`);
    res.setHeader("Cache-Control", "private, no-store");
    if (metadata.size) res.setHeader("Content-Length", String(metadata.size));
    await pipeline(file.createReadStream(), res);
  } catch (error) {
    req.log.warn({ err: error, documentId: id }, "Private document could not be streamed");
    if (!res.headersSent) res.status(404).json({ error: "Document not found." });
  }
});

router.delete("/documents/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = DeleteMatterDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const document = await documentForWorkspace(access.workspaceId, params.data.id);
  if (!document) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  const [matter] = await db.select({ clientId: mattersTable.clientId }).from(mattersTable)
    .where(and(eq(mattersTable.id, document.matterId), eq(mattersTable.workspaceId, access.workspaceId)))
    .limit(1);
  const [matterHold] = await db.select({ id: legalHoldsTable.id }).from(legalHoldsTable).where(and(
    eq(legalHoldsTable.workspaceId, access.workspaceId),
    eq(legalHoldsTable.entityType, "matter"),
    eq(legalHoldsTable.entityId, document.matterId),
    isNull(legalHoldsTable.releasedAt),
  )).limit(1);
  const [clientHold] = matter?.clientId
    ? await db.select({ id: legalHoldsTable.id }).from(legalHoldsTable).where(and(
      eq(legalHoldsTable.workspaceId, access.workspaceId),
      eq(legalHoldsTable.entityType, "client"),
      eq(legalHoldsTable.entityId, matter.clientId),
      isNull(legalHoldsTable.releasedAt),
    )).limit(1)
    : [];
  if (matterHold || clientHold) {
    res.status(409).json({ error: "This record is protected by an active legal hold." });
    return;
  }
  try {
    const file = await objectStorage.getObjectEntityFile(document.objectPath);
    await file.delete({ ignoreNotFound: true });
  } catch (error) {
    if (!(error instanceof ObjectNotFoundError)) {
      req.log.error({ err: error, documentId: document.id }, "Document removal failed");
      res.status(502).json({ error: "The private file could not be removed." });
      return;
    }
  }
  await db
    .delete(documentsTable)
    .where(
      and(
        eq(documentsTable.id, document.id),
        eq(documentsTable.workspaceId, access.workspaceId),
      ),
    );
  res.sendStatus(204);
});

router.patch("/document-suggestions/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = ReviewDocumentSuggestionParams.safeParse(req.params);
  const body = ReviewDocumentSuggestionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: !params.success
        ? params.error.message
        : !body.success
          ? body.error.message
          : "Invalid suggestion review.",
    });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [suggestion] = await tx
      .select()
      .from(documentSuggestionsTable)
      .where(
        and(
          eq(documentSuggestionsTable.id, params.data.id),
          eq(documentSuggestionsTable.workspaceId, access.workspaceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!suggestion) return { kind: "missing" as const };
    if (suggestion.status !== "pending") return { kind: "already-reviewed" as const };

    if (body.data.status === "confirmed") {
      await tx.insert(plannerItemsTable).values({
        workspaceId: suggestion.workspaceId,
        matterId: suggestion.matterId,
        documentId: suggestion.documentId,
        kind: suggestion.kind,
        title: suggestion.title,
        details: suggestion.details,
        dueAt: suggestion.dueAt,
        sourcePage: suggestion.sourcePage,
        sourceQuote: suggestion.sourceQuote,
        status: "open",
        confirmedByClerkUserId: access.userId,
      });
    }
    const [updated] = await tx
      .update(documentSuggestionsTable)
      .set({ status: body.data.status })
      .where(
        and(
          eq(documentSuggestionsTable.id, suggestion.id),
          eq(documentSuggestionsTable.status, "pending"),
        ),
      )
      .returning();
    return { kind: "updated" as const, suggestion: updated };
  });
  if (result.kind === "missing") {
    res.status(404).json({ error: "Suggestion not found." });
    return;
  }
  if (result.kind === "already-reviewed") {
    res.status(409).json({ error: "This suggestion has already been reviewed." });
    return;
  }
  await logAuditEvent(
    access,
    "ai_document_suggestion_reviewed",
    "document_suggestion",
    result.suggestion.id,
    result.suggestion.title,
    { decision: result.suggestion.status },
  );
  const [document] = await db
    .select({ originalName: documentsTable.originalName })
    .from(documentsTable)
    .where(eq(documentsTable.id, result.suggestion.documentId))
    .limit(1);
  const matter = await matterForWorkspace(access.workspaceId, result.suggestion.matterId);
  res.json(
    ReviewDocumentSuggestionResponse.parse({
      ...result.suggestion,
      documentName: document?.originalName ?? "",
      matterTitle: matter?.title ?? "",
    }),
  );
});

router.patch("/planner-items/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = UpdatePlannerItemParams.safeParse(req.params);
  const body = UpdatePlannerItemBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: !params.success
        ? params.error.message
        : !body.success
          ? body.error.message
          : "Invalid planner-item update.",
    });
    return;
  }
  const [item] = await db
    .update(plannerItemsTable)
    .set({ status: body.data.status })
    .where(
      and(
        eq(plannerItemsTable.id, params.data.id),
        eq(plannerItemsTable.workspaceId, access.workspaceId),
      ),
    )
    .returning();
  if (!item) {
    res.status(404).json({ error: "Planner item not found." });
    return;
  }
  const [document] = await db
    .select({ originalName: documentsTable.originalName })
    .from(documentsTable)
    .where(eq(documentsTable.id, item.documentId))
    .limit(1);
  const matter = await matterForWorkspace(access.workspaceId, item.matterId);
  res.json(
    UpdatePlannerItemResponse.parse({
      ...item,
      documentName: document?.originalName ?? "",
      matterTitle: matter?.title ?? "",
    }),
  );
});

router.get("/updates", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  const overview = await getClientUpdateOverview(access.workspaceId);
  await logAuditEvent(access, "client_update_records_viewed", "client_updates", null, "Client updates", {
    draftCount: overview.drafts.length,
  });
  res.json(
    GetClientUpdateOverviewResponse.parse(overview),
  );
});

router.put("/updates/schedules", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const parsed = SaveClientUpdateScheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const matter = await matterForWorkspace(access.workspaceId, input.matterId);
  if (!matter) {
    res.status(404).json({ error: "Matter not found." });
    return;
  }
  const [existing] = await db
    .select()
    .from(updateSchedulesTable)
    .where(
      and(
        eq(updateSchedulesTable.workspaceId, access.workspaceId),
        eq(updateSchedulesTable.matterId, input.matterId),
      ),
    )
    .limit(1);
  const nextDraftAt = input.enabled
    ? nextCadenceDate(new Date(), input.cadence)
    : null;
  const [schedule] = existing
    ? await db
        .update(updateSchedulesTable)
        .set({
          enabled: input.enabled,
          cadence: input.cadence,
          nextDraftAt,
        })
        .where(eq(updateSchedulesTable.id, existing.id))
        .returning()
    : await db
        .insert(updateSchedulesTable)
        .values({
          workspaceId: access.workspaceId,
          matterId: input.matterId,
          enabled: input.enabled,
          cadence: input.cadence,
          nextDraftAt,
        })
        .returning();
  res.json(
    SaveClientUpdateScheduleResponse.parse({
      ...schedule,
      matterTitle: matter.title,
      clientName: matter.clientName,
    }),
  );
});

router.post("/updates/drafts", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const parsed = CreateClientUpdateDraftBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const draft = await createClientUpdateDraft(
    access.workspaceId,
    parsed.data.matterId,
    "user",
  );
  if (!draft) {
    res.status(409).json({
      error: "No matter activity from the last 90 days is available to support a draft.",
    });
    return;
  }
  res.status(201).json(CreateClientUpdateDraftResponse.parse(draft));
});

router.patch("/updates/drafts/:id", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = UpdateClientUpdateDraftParams.safeParse(req.params);
  const body = UpdateClientUpdateDraftBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: !params.success
        ? params.error.message
        : !body.success
          ? body.error.message
          : "Invalid client-update change.",
    });
    return;
  }
  const values = {
    ...body.data,
    ...(body.data.status
      ? { reviewedAt: body.data.status === "reviewed" ? new Date() : null }
      : {}),
  };
  const [draft] = await db
    .update(updateDraftsTable)
    .set(values)
    .where(
      and(
        eq(updateDraftsTable.id, params.data.id),
        eq(updateDraftsTable.workspaceId, access.workspaceId),
      ),
    )
    .returning();
  if (!draft) {
    res.status(404).json({ error: "Client update draft not found." });
    return;
  }
  if (body.data.status === "reviewed") {
    await logAuditEvent(access, "ai_client_update_approved", "client_update_draft", draft.id, draft.subject);
  }
  const matter = await matterForWorkspace(access.workspaceId, draft.matterId);
  res.json(
    UpdateClientUpdateDraftResponse.parse({
      ...draft,
      matterTitle: matter?.title ?? "",
      clientName: matter?.clientName ?? "",
    }),
  );
});

export default router;
