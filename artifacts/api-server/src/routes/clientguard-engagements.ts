import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import PDFDocument from "pdfkit";
import * as api from "@workspace/api-zod";
import {
  billingProfilesTable,
  clientsTable,
  documentsTable,
  engagementLettersTable,
  mattersTable,
  practiceSettingsTable,
  providerConnectionsTable,
} from "@workspace/db";
import { db } from "@workspace/db";
import { firmAccess, logAuditEvent } from "../lib/clientguard-auth";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  decryptToken,
  docuSignApiBase,
  encryptToken,
  providerJson,
  refreshProviderToken,
  tokenExpiry,
} from "../lib/clientguard-provider-service";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const MAX_SIGNED_PDF_BYTES = 30 * 1024 * 1024;

function idFrom(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function matterForLetter(workspaceId: number, matterId: number) {
  const [row] = await db
    .select({
      matter: mattersTable,
      clientName: clientsTable.name,
      clientEmail: clientsTable.email,
    })
    .from(mattersTable)
    .innerJoin(
      clientsTable,
      and(
        eq(clientsTable.id, mattersTable.clientId),
        eq(clientsTable.workspaceId, mattersTable.workspaceId),
      ),
    )
    .where(
      and(
        eq(mattersTable.workspaceId, workspaceId),
        eq(mattersTable.id, matterId),
      ),
    )
    .limit(1);
  return row;
}

function billingTermsFor(profile: typeof billingProfilesTable.$inferSelect) {
  const fee =
    profile.feeType === "hourly"
      ? `${(profile.hourlyRateCents ?? 0) / 100} ${profile.currency} per hour`
      : `${(profile.fixedFeeCents ?? 0) / 100} ${profile.currency} fixed fee`;
  return [
    profile.feeDescription,
    fee,
    `Billing cycle: ${profile.billingCycle}`,
    `Tax rate: ${(profile.taxRateBps / 100).toFixed(2)}%`,
  ].join("\n");
}

function renderLetterPdf(letter: {
  matterTitle: string;
  clientName: string;
  clientEmail: string;
  scope: string;
  billingTerms: string;
  revision: number;
}) {
  return new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margins: { top: 58, right: 58, bottom: 58, left: 58 } });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.once("error", reject);
    pdf.once("end", () => resolve(Buffer.concat(chunks)));

    pdf.font("Helvetica-Bold").fontSize(21).text("Engagement letter", { align: "left" });
    pdf.moveDown(0.4);
    pdf.font("Helvetica").fontSize(10).fillColor("#53636a")
      .text(`Matter: ${letter.matterTitle}`)
      .text(`Prepared for: ${letter.clientName} <${letter.clientEmail}>`)
      .text(`Revision: ${letter.revision} · Prepared ${new Date().toLocaleDateString()}`);
    pdf.moveDown(1.4);
    pdf.fillColor("#1f2e33").font("Helvetica-Bold").fontSize(13).text("Scope of engagement");
    pdf.moveDown(0.4);
    pdf.font("Helvetica").fontSize(11).text(letter.scope, { lineGap: 4 });
    pdf.moveDown(1.2);
    pdf.font("Helvetica-Bold").fontSize(13).text("Billing terms");
    pdf.moveDown(0.4);
    pdf.font("Helvetica").fontSize(11).text(letter.billingTerms, { lineGap: 4 });
    pdf.moveDown(1.5);
    pdf.fontSize(9).fillColor("#58686b")
      .text("Please review this letter and the scope and billing terms with your professional before signing.");
    pdf.moveDown(1.2);
    pdf.fillColor("#1f2e33").font("Helvetica-Bold").fontSize(10).text("Client signature");
    pdf.moveDown(1.6);
    pdf.font("Helvetica").fontSize(10).text("[CLIENT_SIGNATURE]");
    pdf.moveDown(0.3);
    pdf.fontSize(9).fillColor("#58686b").text(`Name: ${letter.clientName}`);
    pdf.end();
  });
}

async function persistPdf(
  workspaceId: number,
  matterId: number,
  userId: string,
  fileName: string,
  contents: Buffer,
) {
  const uploadURL = await objectStorage.getObjectEntityUploadURL();
  const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
  if (!objectPath.startsWith("/objects/uploads/")) {
    throw new Error("Private document storage returned an invalid path.");
  }
  const uploaded = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: contents,
    signal: AbortSignal.timeout(30_000),
  });
  if (!uploaded.ok) throw new Error("The PDF could not be stored privately.");
  await objectStorage.trySetObjectEntityAclPolicy(objectPath, {
    owner: userId,
    visibility: "private",
  });
  const [document] = await db.insert(documentsTable).values({
    workspaceId,
    matterId,
    uploadedByClerkUserId: userId,
    objectPath,
    originalName: fileName.slice(0, 255),
    contentType: "application/pdf",
    sizeBytes: contents.byteLength,
    status: "ready",
    clientVisible: false,
  }).returning();
  return document;
}

async function docuSignConnection(workspaceId: number) {
  const [connection] = await db.select().from(providerConnectionsTable).where(and(
    eq(providerConnectionsTable.workspaceId, workspaceId),
    eq(providerConnectionsTable.provider, "docusign"),
  )).limit(1);
  if (!connection || !connection.remoteAccountId || !connection.remoteBaseUri) {
    return null;
  }
  let accessToken = decryptToken(connection.accessTokenCiphertext);
  let refreshToken = connection.refreshTokenCiphertext
    ? decryptToken(connection.refreshTokenCiphertext)
    : null;
  if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() <= Date.now() + 30_000) {
    if (!refreshToken) throw new Error("DocuSign authorization expired. Reconnect the firm account.");
    const refreshed = await refreshProviderToken("docusign", refreshToken);
    accessToken = refreshed.access_token;
    refreshToken = refreshed.refresh_token ?? refreshToken;
    await db.update(providerConnectionsTable).set({
      accessTokenCiphertext: encryptToken(accessToken),
      refreshTokenCiphertext: encryptToken(refreshToken),
      tokenExpiresAt: tokenExpiry(refreshed),
      updatedAt: new Date(),
    }).where(eq(providerConnectionsTable.id, connection.id));
  }
  return {
    connection,
    accessToken,
    accountId: connection.remoteAccountId,
    apiBase: docuSignApiBase(connection.remoteBaseUri),
  };
}

function mapLetter(
  letter: typeof engagementLettersTable.$inferSelect,
  matterTitle: string,
  clientName: string,
  requiresSignatureToOpen: boolean,
) {
  return {
    id: letter.id,
    matterId: letter.matterId,
    matterTitle,
    clientName,
    clientEmail: letter.clientEmail,
    scope: letter.scope,
    billingTerms: letter.billingTerms,
    revision: letter.revision,
    status: letter.status,
    provider: "docusign" as const,
    envelopeId: letter.envelopeId,
    draftDocumentId: letter.draftDocumentId,
    signedDocumentId: letter.signedDocumentId,
    sentAt: letter.sentAt,
    signedAt: letter.signedAt,
    requiresSignatureToOpen,
    createdAt: letter.createdAt,
  };
}

router.get("/engagement-letters", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res);
  if (!access) return;
  const [settings, rows] = await Promise.all([
    db.select({ required: practiceSettingsTable.requireEngagementSignature })
      .from(practiceSettingsTable)
      .where(eq(practiceSettingsTable.workspaceId, access.workspaceId))
      .limit(1),
    db.select({
      letter: engagementLettersTable,
      matterTitle: mattersTable.title,
      clientName: clientsTable.name,
    }).from(engagementLettersTable)
      .innerJoin(mattersTable, and(
        eq(mattersTable.id, engagementLettersTable.matterId),
        eq(mattersTable.workspaceId, engagementLettersTable.workspaceId),
      ))
      .innerJoin(clientsTable, and(
        eq(clientsTable.id, mattersTable.clientId),
        eq(clientsTable.workspaceId, mattersTable.workspaceId),
      ))
      .where(eq(engagementLettersTable.workspaceId, access.workspaceId))
      .orderBy(desc(engagementLettersTable.createdAt))
      .limit(250),
  ]);
  await logAuditEvent(access, "engagement_letters_viewed", "engagement_letter", null, "Engagement letters", {
    count: rows.length,
  });
  res.json(api.ListEngagementLettersResponse.parse(rows.map(({ letter, matterTitle, clientName }) =>
    mapLetter(letter, matterTitle, clientName, settings[0]?.required ?? false),
  )));
});

router.post("/matters/:id/engagement-letter", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = api.CreateEngagementLetterParams.safeParse(req.params);
  const body = api.CreateEngagementLetterBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const row = await matterForLetter(access.workspaceId, params.data.id);
  if (!row) {
    res.status(404).json({ error: "Matter not found." });
    return;
  }
  const [profile] = await db.select().from(billingProfilesTable).where(and(
    eq(billingProfilesTable.workspaceId, access.workspaceId),
    eq(billingProfilesTable.matterId, params.data.id),
  )).limit(1);
  if (!profile) {
    res.status(409).json({ error: "Add a billing profile to the matter before drafting its engagement letter." });
    return;
  }
  const [latest] = await db.select({ revision: engagementLettersTable.revision })
    .from(engagementLettersTable)
    .where(and(
      eq(engagementLettersTable.workspaceId, access.workspaceId),
      eq(engagementLettersTable.matterId, params.data.id),
    ))
    .orderBy(desc(engagementLettersTable.revision))
    .limit(1);
  const revision = (latest?.revision ?? 0) + 1;
  const values = {
    matterTitle: row.matter.title,
    clientName: row.clientName,
    clientEmail: body.data.clientEmail.trim(),
    scope: body.data.scope.trim(),
    billingTerms: billingTermsFor(profile),
    revision,
  };
  const pdf = await renderLetterPdf(values);
  const file = await persistPdf(
    access.workspaceId,
    params.data.id,
    access.userId,
    `engagement-${row.matter.reference}-draft-r${revision}.pdf`,
    pdf,
  );
  const [letter] = await db.insert(engagementLettersTable).values({
    workspaceId: access.workspaceId,
    matterId: params.data.id,
    ...values,
    status: "draft",
    draftDocumentId: file.id,
    createdByClerkUserId: access.userId,
  }).returning();
  const [settings] = await db.select({ required: practiceSettingsTable.requireEngagementSignature })
    .from(practiceSettingsTable)
    .where(eq(practiceSettingsTable.workspaceId, access.workspaceId))
    .limit(1);
  await logAuditEvent(access, "engagement_letter_drafted", "engagement_letter", letter.id, row.matter.title, {
    matterId: row.matter.id,
    revision,
    documentId: file.id,
  });
  res.status(201).json(api.CreateEngagementLetterResponse.parse(
    mapLetter(letter, row.matter.title, row.clientName, settings?.required ?? false),
  ));
});

router.post("/engagement-letters/:id/send", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = api.SendEngagementLetterParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [letterRow] = await db.select({
    letter: engagementLettersTable,
    matterTitle: mattersTable.title,
    clientName: clientsTable.name,
  }).from(engagementLettersTable)
    .innerJoin(mattersTable, and(
      eq(mattersTable.id, engagementLettersTable.matterId),
      eq(mattersTable.workspaceId, engagementLettersTable.workspaceId),
    ))
    .innerJoin(clientsTable, and(
      eq(clientsTable.id, mattersTable.clientId),
      eq(clientsTable.workspaceId, mattersTable.workspaceId),
    ))
    .where(and(
      eq(engagementLettersTable.id, params.data.id),
      eq(engagementLettersTable.workspaceId, access.workspaceId),
    ))
    .limit(1);
  if (!letterRow) {
    res.status(404).json({ error: "Engagement letter not found." });
    return;
  }
  if (letterRow.letter.status !== "draft") {
    res.status(409).json({ error: "Only a draft engagement letter can be sent." });
    return;
  }
  let docusign;
  try {
    docusign = await docuSignConnection(access.workspaceId);
  } catch (error) {
    req.log.warn({ err: error }, "DocuSign token refresh failed");
    res.status(409).json({ error: "Reconnect the firm's DocuSign account before sending this letter." });
    return;
  }
  if (!docusign) {
    res.status(409).json({ error: "Connect a firm-owned DocuSign account in Integrations before sending." });
    return;
  }
  if (!letterRow.letter.draftDocumentId) {
    res.status(409).json({ error: "The draft PDF is not available. Create a new letter revision." });
    return;
  }
  let pdf: Buffer;
  try {
    const file = await objectStorage.getObjectEntityFile(
      (await db.select({ objectPath: documentsTable.objectPath }).from(documentsTable).where(and(
        eq(documentsTable.id, letterRow.letter.draftDocumentId),
        eq(documentsTable.workspaceId, access.workspaceId),
      )).limit(1))[0]?.objectPath ?? "",
    );
    const [download] = await file.download();
    pdf = Buffer.from(download);
  } catch (error) {
    req.log.warn({ err: error, letterId: letterRow.letter.id }, "Engagement draft PDF could not be read");
    res.status(409).json({ error: "The private engagement PDF could not be loaded." });
    return;
  }
  const envelopeDefinition = {
    emailSubject: `Engagement letter: ${letterRow.matterTitle}`,
    transactionId: `clientguard-engagement-${letterRow.letter.id}-r${letterRow.letter.revision}`,
    documents: [{
      documentBase64: pdf.toString("base64"),
      name: `Engagement - ${letterRow.matterTitle}`.slice(0, 100),
      fileExtension: "pdf",
      documentId: "1",
    }],
    recipients: {
      signers: [{
        email: letterRow.letter.clientEmail,
        name: letterRow.clientName,
        recipientId: "1",
        routingOrder: "1",
        tabs: {
          signHereTabs: [{
            anchorString: "[CLIENT_SIGNATURE]",
            anchorUnits: "pixels",
            anchorXOffset: "0",
            anchorYOffset: "0",
          }],
        },
      }],
    },
    status: "sent",
  };
  try {
    const result = await providerJson(
      `${docusign.apiBase}/accounts/${encodeURIComponent(docusign.accountId)}/envelopes`,
      docusign.accessToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelopeDefinition),
      },
    );
    if (typeof result.envelopeId !== "string") throw new Error("DocuSign did not return an envelope identifier.");
    const [updated] = await db.update(engagementLettersTable).set({
      envelopeId: result.envelopeId,
      status: "sent",
      sentAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(engagementLettersTable.id, letterRow.letter.id),
      eq(engagementLettersTable.workspaceId, access.workspaceId),
      eq(engagementLettersTable.status, "draft"),
    )).returning();
    if (!updated) {
      res.status(409).json({ error: "This letter changed while it was being sent. Refresh its status before retrying." });
      return;
    }
    const [settings] = await db.select({ required: practiceSettingsTable.requireEngagementSignature })
      .from(practiceSettingsTable)
      .where(eq(practiceSettingsTable.workspaceId, access.workspaceId))
      .limit(1);
    await logAuditEvent(access, "engagement_letter_sent", "engagement_letter", updated.id, letterRow.matterTitle, {
      matterId: updated.matterId,
      revision: updated.revision,
    });
    res.json(api.SendEngagementLetterResponse.parse(
      mapLetter(updated, letterRow.matterTitle, letterRow.clientName, settings?.required ?? false),
    ));
  } catch (error) {
    req.log.warn({ err: error, letterId: letterRow.letter.id }, "DocuSign envelope creation failed");
    res.status(502).json({ error: "DocuSign could not confirm the send. Refresh the provider status before trying again." });
  }
});

router.post("/engagement-letters/:id/sync", async (req, res): Promise<void> => {
  const access = await firmAccess(req, res, true);
  if (!access) return;
  const params = api.SyncEngagementLetterParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select({
    letter: engagementLettersTable,
    matterTitle: mattersTable.title,
    matterStatus: mattersTable.status,
    matterReference: mattersTable.reference,
    clientName: clientsTable.name,
  }).from(engagementLettersTable)
    .innerJoin(mattersTable, and(
      eq(mattersTable.id, engagementLettersTable.matterId),
      eq(mattersTable.workspaceId, engagementLettersTable.workspaceId),
    ))
    .innerJoin(clientsTable, and(
      eq(clientsTable.id, mattersTable.clientId),
      eq(clientsTable.workspaceId, mattersTable.workspaceId),
    ))
    .where(and(
      eq(engagementLettersTable.id, params.data.id),
      eq(engagementLettersTable.workspaceId, access.workspaceId),
    ))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Engagement letter not found." });
    return;
  }
  if (!row.letter.envelopeId) {
    res.status(409).json({ error: "This letter has not been sent through DocuSign." });
    return;
  }
  if (row.letter.status === "completed" && row.letter.signedDocumentId) {
    const [settings] = await db.select({ required: practiceSettingsTable.requireEngagementSignature })
      .from(practiceSettingsTable)
      .where(eq(practiceSettingsTable.workspaceId, access.workspaceId))
      .limit(1);
    res.json(api.SyncEngagementLetterResponse.parse(
      mapLetter(row.letter, row.matterTitle, row.clientName, settings?.required ?? false),
    ));
    return;
  }
  let docusign;
  try {
    docusign = await docuSignConnection(access.workspaceId);
  } catch (error) {
    req.log.warn({ err: error }, "DocuSign token refresh failed");
    res.status(409).json({ error: "Reconnect the firm's DocuSign account to check signing status." });
    return;
  }
  if (!docusign) {
    res.status(409).json({ error: "Connect the firm's DocuSign account before checking signature status." });
    return;
  }
  try {
    const envelope = await providerJson(
      `${docusign.apiBase}/accounts/${encodeURIComponent(docusign.accountId)}/envelopes/${encodeURIComponent(row.letter.envelopeId)}`,
      docusign.accessToken,
    );
    const providerStatus = typeof envelope.status === "string" ? envelope.status.toLowerCase() : "";
    let letterStatus: string = "sent";
    if (providerStatus === "completed") letterStatus = "completed";
    else if (providerStatus === "declined") letterStatus = "declined";
    else if (providerStatus === "voided") letterStatus = "voided";
    let signedDocumentId = row.letter.signedDocumentId;
    let signedAt = row.letter.signedAt;
    if (letterStatus === "completed" && !signedDocumentId) {
      const response = await fetch(
        `${docusign.apiBase}/accounts/${encodeURIComponent(docusign.accountId)}/envelopes/${encodeURIComponent(row.letter.envelopeId)}/documents/combined`,
        {
          headers: {
            Authorization: `Bearer ${docusign.accessToken}`,
            Accept: "application/pdf",
          },
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok) throw new Error(`DocuSign signed document download failed with HTTP ${response.status}.`);
      const data = Buffer.from(await response.arrayBuffer());
      if (!data.byteLength || data.byteLength > MAX_SIGNED_PDF_BYTES) {
        throw new Error("DocuSign returned an invalid signed document size.");
      }
      const document = await persistPdf(
        access.workspaceId,
        row.letter.matterId,
        access.userId,
        `engagement-${row.matterReference}-signed-r${row.letter.revision}.pdf`,
        data,
      );
      signedDocumentId = document.id;
      signedAt = new Date();
    }
    const [updated] = await db.update(engagementLettersTable).set({
      status: letterStatus,
      signedDocumentId,
      signedAt,
      updatedAt: new Date(),
    }).where(and(
      eq(engagementLettersTable.id, row.letter.id),
      eq(engagementLettersTable.workspaceId, access.workspaceId),
    )).returning();
    await db.update(providerConnectionsTable).set({ lastSyncAt: new Date() }).where(eq(
      providerConnectionsTable.id,
      docusign.connection.id,
    ));
    const [settings] = await db.select({ required: practiceSettingsTable.requireEngagementSignature })
      .from(practiceSettingsTable)
      .where(eq(practiceSettingsTable.workspaceId, access.workspaceId))
      .limit(1);
    if (letterStatus === "completed" && settings?.required && row.matterStatus === "on_hold") {
      await db.update(mattersTable).set({ status: "open" }).where(and(
        eq(mattersTable.id, row.letter.matterId),
        eq(mattersTable.workspaceId, access.workspaceId),
        eq(mattersTable.status, "on_hold"),
      ));
    }
    await logAuditEvent(access, "engagement_letter_status_synced", "engagement_letter", updated.id, row.matterTitle, {
      matterId: updated.matterId,
      status: updated.status,
      signedDocumentId: updated.signedDocumentId ?? null,
    });
    if (letterStatus === "completed" && settings?.required && row.matterStatus === "on_hold") {
      await logAuditEvent(access, "matter_opened_after_engagement_signature", "matter", row.letter.matterId, row.matterTitle, {
        engagementLetterId: updated.id,
      });
    }
    res.json(api.SyncEngagementLetterResponse.parse(
      mapLetter(updated, row.matterTitle, row.clientName, settings?.required ?? false),
    ));
  } catch (error) {
    req.log.warn({ err: error, letterId: row.letter.id }, "DocuSign status sync failed");
    res.status(502).json({ error: "Could not confirm the DocuSign status or store its signed copy. Retry the status check." });
  }
});

export default router;
