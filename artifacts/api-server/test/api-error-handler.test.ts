import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { apiErrorHandler } from "../src/middlewares/apiErrorHandler.ts";

let server: Server;
let baseUrl: string;

before(async () => {
  const app = express();
  app.get("/failure", (_req, _res, next) => {
    next(new Error("sensitive database connection detail"));
  });
  app.use(apiErrorHandler);

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const address = server.address();
  assert(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("returns a stable JSON error without exposing internal error details", async () => {
  const response = await fetch(`${baseUrl}/failure`);

  assert.equal(response.status, 500);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  const body = await response.json();
  assert.deepEqual(body, {
    error: "An unexpected error occurred. Please try again.",
  });
  assert.equal(JSON.stringify(body).includes("sensitive database connection detail"), false);
});
