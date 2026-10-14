import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { SubmitContactInquiryBody } from "@workspace/api-zod";
import { ReplitConnectors } from "@replit/connectors-sdk";

const router: IRouter = Router();
const rateWindowMs = 15 * 60 * 1000;
const maxSubmissionsPerWindow = 5;
const submissionWindows = new Map<string, { startedAt: number; count: number }>();

function isRateLimited(ipAddress: string, now = Date.now()): boolean {
  for (const [ip, window] of submissionWindows) {
    if (now - window.startedAt >= rateWindowMs) submissionWindows.delete(ip);
  }

  if (submissionWindows.size > 5_000) {
    const oldestIp = submissionWindows.keys().next().value;
    if (oldestIp) submissionWindows.delete(oldestIp);
  }

  const current = submissionWindows.get(ipAddress);
  if (!current || now - current.startedAt >= rateWindowMs) {
    submissionWindows.set(ipAddress, { startedAt: now, count: 1 });
    return false;
  }

  if (current.count >= maxSubmissionsPerWindow) return true;
  current.count += 1;
  return false;
}

router.post("/contact", async (req, res): Promise<void> => {
  if (isRateLimited(req.ip || "unknown")) {
    res.status(429).json({ error: "Please wait before sending another message." });
    return;
  }

  const parsed = SubmitContactInquiryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the contact form fields and try again." });
    return;
  }

  // Quietly accept bot submissions without forwarding them.
  if (parsed.data.website?.trim()) {
    res.sendStatus(204);
    return;
  }

  const recipient = process.env.CLIENTGUARD_CONTACT_TO_EMAIL?.trim();
  const sender = process.env.CLIENTGUARD_CONTACT_FROM_EMAIL?.trim();
  if (!recipient || !sender) {
    req.log.error("Contact email delivery is not configured.");
    res.status(502).json({ error: "Contact delivery is temporarily unavailable. Please try again later." });
    return;
  }

  const { name, email, organization, message } = parsed.data;
  const text = [
    "New inquiry from the ClientGuard website",
    "",
    `Name: ${name.trim()}`,
    `Email: ${email.trim()}`,
    ...(organization?.trim() ? [`Organization: ${organization.trim()}`] : []),
    "",
    "Message:",
    message.trim(),
  ].join("\n");

  try {
    const connectors = new ReplitConnectors();
    const response = await connectors.proxy("resend", "/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        from: sender,
        to: recipient,
        reply_to: email.trim(),
        subject: "New ClientGuard website inquiry",
        text,
      }),
    });

    if (!response.ok) {
      req.log.warn({ statusCode: response.status }, "Resend rejected a ClientGuard contact inquiry.");
      res.status(502).json({ error: "Your message could not be delivered. Please try again later." });
      return;
    }
  } catch (error) {
    req.log.error(
      { errorType: error instanceof Error ? error.name : "UnknownError" },
      "Could not deliver a ClientGuard contact inquiry.",
    );
    res.status(502).json({ error: "Your message could not be delivered. Please try again later." });
    return;
  }

  res.sendStatus(204);
});

export default router;
