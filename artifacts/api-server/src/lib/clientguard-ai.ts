import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { openai } from "@workspace/integrations-openai-ai-server";

const MODEL = "gpt-5.6-luna";
const MAX_DOCUMENT_TEXT = 100_000;

export type SourcePage = { page: number; text: string };

export type ExtractedSuggestion = {
  kind: "event" | "task";
  title: string;
  details: string;
  dueAt: Date | null;
  sourcePage: number;
  sourceQuote: string;
  confidence: number;
};

export async function extractDocumentPages(
  bytes: Buffer,
  contentType: string,
): Promise<SourcePage[]> {
  if (contentType === "text/plain") {
    const text = bytes.toString("utf8").trim();
    return text ? [{ page: 1, text }] : [];
  }

  if (
    contentType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer: bytes });
    const text = result.value.trim();
    return text ? [{ page: 1, text }] : [];
  }

  if (contentType !== "application/pdf") {
    throw new Error("Only PDF, DOCX, and plain-text documents can be analyzed.");
  }

  const pdf = await getDocument({
    data: new Uint8Array(bytes),
  }).promise;
  if (pdf.numPages > 120) {
    throw new Error("This PDF has more than 120 pages. Split it before analysis.");
  }

  const pages: SourcePage[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) pages.push({ page: pageNumber, text });
  }

  return pages;
}

export function validateDocumentLength(pages: SourcePage[]): string {
  const combined = pages
    .map(({ page, text }) => `[Page ${page}]\n${text}`)
    .join("\n\n");
  if (!combined.trim()) {
    throw new Error(
      "No selectable text was found. Scanned or image-only documents need OCR before they can be analyzed.",
    );
  }
  if (combined.length > MAX_DOCUMENT_TEXT) {
    throw new Error(
      "This document contains too much text for one reliable review. Split it into smaller files.",
    );
  }
  return combined;
}

export async function draftBillNarrative(input: {
  matterTitle: string;
  clientName: string;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  feeDescription: string;
  lineItems: Array<{
    description: string;
    workDate: string | null;
    durationMinutes: number | null;
    amountCents: number;
  }>;
}): Promise<string> {
  const response = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Draft a concise, neutral invoice narrative for a professional-services firm. Use only the supplied matter and work descriptions. Do not add work, outcomes, rates, hours, amounts, tax, legal conclusions, or dates that are not supplied. Monetary totals are calculated separately by the application. Return JSON with one string property named narrative.",
      },
      {
        role: "user",
        content: JSON.stringify({
          matter: input.matterTitle,
          client: input.clientName,
          currency: input.currency,
          period: {
            start: input.periodStart.toISOString(),
            end: input.periodEnd.toISOString(),
          },
          feeDescription: input.feeDescription,
          work: input.lineItems.map((item) => ({
            description: item.description,
            workDate: item.workDate,
            durationMinutes: item.durationMinutes,
          })),
        }),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("AI returned an empty bill narrative.");
  const parsed = JSON.parse(content) as { narrative?: unknown };
  if (typeof parsed.narrative !== "string" || !parsed.narrative.trim()) {
    throw new Error("AI returned an invalid bill narrative.");
  }
  return parsed.narrative.trim().slice(0, 4000);
}

export async function draftClientUpdate(input: {
  clientName: string;
  matterTitle: string;
  activities: Array<{ date: string; actor: string; action: string; label: string }>;
}): Promise<{ subject: string; body: string }> {
  const response = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Draft a professional, concise client update using only the supplied matter activity. Do not invent work, outcomes, deadlines, promises, advice, or status. Avoid exposing internal actor names; describe only the recorded matter activity. If the activity is administrative, state that plainly. Return JSON with string properties subject and body. This is a draft for professional review, not a message to send.",
      },
      {
        role: "user",
        content: JSON.stringify({
          client: input.clientName,
          matter: input.matterTitle,
          recordedActivity: input.activities,
        }),
      },
    ],
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("AI returned an empty client update.");
  const parsed = JSON.parse(content) as { subject?: unknown; body?: unknown };
  if (
    typeof parsed.subject !== "string" ||
    typeof parsed.body !== "string" ||
    !parsed.subject.trim() ||
    !parsed.body.trim()
  ) {
    throw new Error("AI returned an invalid client update.");
  }
  return {
    subject: parsed.subject.trim().slice(0, 200),
    body: parsed.body.trim().slice(0, 10_000),
  };
}

export async function extractSourceSuggestions(
  pages: SourcePage[],
): Promise<ExtractedSuggestion[]> {
  const source = validateDocumentLength(pages);
  const response = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Extract only explicitly stated calendar events and actionable tasks from the source. Do not infer dates, deadlines, owners, or obligations. Each item must include an exact verbatim evidenceQuote copied from one source page and its one-based pageNumber. Return JSON with an items array. Each item has kind (event or task), title, details, dueDate (ISO date or ISO date-time, or null if not explicit), pageNumber, evidenceQuote, and confidence (0 to 1). If no explicit item is supported by a direct quote, return an empty array.",
      },
      { role: "user", content: source },
    ],
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("AI returned no document suggestions.");
  const parsed = JSON.parse(content) as { items?: unknown };
  if (!Array.isArray(parsed.items)) {
    throw new Error("AI returned an invalid document-suggestion list.");
  }

  const pageByNumber = new Map(pages.map((page) => [page.page, page.text]));
  const suggestions: ExtractedSuggestion[] = [];
  for (const raw of parsed.items) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    if (
      (item.kind !== "event" && item.kind !== "task") ||
      typeof item.title !== "string" ||
      typeof item.evidenceQuote !== "string" ||
      typeof item.pageNumber !== "number"
    ) {
      continue;
    }
    const pageText = pageByNumber.get(item.pageNumber);
    const quote = item.evidenceQuote.trim();
    if (
      !pageText ||
      quote.length < 8 ||
      !normalizeForMatch(pageText).includes(normalizeForMatch(quote))
    ) {
      continue;
    }

    let dueAt: Date | null = null;
    if (typeof item.dueDate === "string") {
      const rawDate = item.dueDate.trim();
      const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
        ? `${rawDate}T12:00:00.000Z`
        : rawDate;
      const parsedDate = new Date(normalizedDate);
      if (!Number.isNaN(parsedDate.getTime())) dueAt = parsedDate;
    }
    const confidence =
      typeof item.confidence === "number" && Number.isFinite(item.confidence)
        ? Math.min(1, Math.max(0, item.confidence))
        : 0;
    suggestions.push({
      kind: item.kind,
      title: item.title.trim().slice(0, 240),
      details:
        typeof item.details === "string" ? item.details.trim().slice(0, 2000) : "",
      dueAt,
      sourcePage: item.pageNumber,
      sourceQuote: quote.slice(0, 3000),
      confidence,
    });
  }
  return suggestions;
}

function normalizeForMatch(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}
