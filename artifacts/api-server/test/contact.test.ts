import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express, { type Express } from "express";
import pinoHttp from "pino-http";
import type { Server } from "node:http";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "../src/lib/logger.ts";
import contactRouter from "../src/routes/contact.ts";

const originalRecipient = process.env.CLIENTGUARD_CONTACT_TO_EMAIL;
const originalSender = process.env.CLIENTGUARD_CONTACT_FROM_EMAIL;
let app: Express;
let server: Server;
let baseUrl: string;

before(async () => {
  process.env.CLIENTGUARD_CONTACT_TO_EMAIL = "contact@example.test";
  process.env.CLIENTGUARD_CONTACT_FROM_EMAIL = "ClientGuard <onboarding@resend.dev>";
  app = express();
  app.use(pinoHttp({ logger }));
  app.use(express.json());
  app.use(contactRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (originalRecipient === undefined) delete process.env.CLIENTGUARD_CONTACT_TO_EMAIL;
  else process.env.CLIENTGUARD_CONTACT_TO_EMAIL = originalRecipient;
  if (originalSender === undefined) delete process.env.CLIENTGUARD_CONTACT_FROM_EMAIL;
  else process.env.CLIENTGUARD_CONTACT_FROM_EMAIL = originalSender;
});

async function submit(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("contact form sends a plain-text message to the configured inbox", async (t) => {
  let requestPath = "";
  let requestBody: Record<string, unknown> | undefined;
  let requestHeaders: Record<string, string> | undefined;
  const proxy = t.mock.method(
    ReplitConnectors.prototype,
    "proxy",
    async (_connector: string, path: string, options?: { body?: string; headers?: Record<string, string> }) => {
      requestPath = path;
      requestBody = options?.body ? JSON.parse(options.body) as Record<string, unknown> : undefined;
      requestHeaders = options?.headers;
      return new Response(null, { status: 200 });
    },
  );

  const response = await submit({
    name: "Morgan Lee",
    email: "morgan@example.test",
    organization: "Northline Advisory",
    message: "Please send information about ClientGuard.",
  });

  assert.equal(response.status, 204);
  assert.equal(proxy.mock.callCount(), 1);
  assert.equal(requestPath, "/emails");
  assert.equal(requestBody?.from, "ClientGuard <onboarding@resend.dev>");
  assert.equal(requestBody?.to, "contact@example.test");
  assert.equal(requestBody?.reply_to, "morgan@example.test");
  assert.equal(requestBody?.subject, "New ClientGuard website inquiry");
  assert.ok(requestHeaders?.["Idempotency-Key"]);
  assert.match(String(requestBody?.text), /Northline Advisory/);
  assert.match(String(requestBody?.text), /Please send information about ClientGuard\./);
});

test("contact form rejects invalid input before attempting delivery", async (t) => {
  const proxy = t.mock.method(
    ReplitConnectors.prototype,
    "proxy",
    async () => new Response(null, { status: 200 }),
  );

  const response = await submit({
    name: "",
    email: "not-an-email",
    message: "",
  });

  assert.equal(response.status, 400);
  assert.equal(proxy.mock.callCount(), 0);
});

test("contact form reports provider failures instead of claiming delivery", async (t) => {
  t.mock.method(
    ReplitConnectors.prototype,
    "proxy",
    async () => new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 }),
  );

  const response = await submit({
    name: "Morgan Lee",
    email: "morgan@example.test",
    message: "Please send information about ClientGuard.",
  });

  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /could not be delivered/i);
});
