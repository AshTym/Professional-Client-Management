import assert from "node:assert/strict";
import { test } from "node:test";
import { providerReady, providers } from "../src/lib/clientguard-provider-service.ts";

test("provider setup is ready only with app credentials and a strong token-encryption key", () => {
  const names = providers.flatMap((provider) => {
    const prefix = {
      google: "GOOGLE",
      microsoft: "MICROSOFT",
      xero: "XERO",
      quickbooks: "QUICKBOOKS",
    }[provider.toLowerCase() as keyof typeof provider];
    return [`${prefix}_OAUTH_CLIENT_ID`, `${prefix}_OAUTH_CLIENT_SECRET`];
  });
  const keys = [...names, "CLIENTGUARD_OAUTH_TOKEN_ENCRYPTION_KEY"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    for (const key of keys) delete process.env[key];
    for (const provider of providers) assert.equal(providerReady(provider), false);

    process.env.CLIENTGUARD_OAUTH_TOKEN_ENCRYPTION_KEY = "short-key";
    for (const provider of providers) assert.equal(providerReady(provider), false);

    process.env.CLIENTGUARD_OAUTH_TOKEN_ENCRYPTION_KEY = "a-valid-test-encryption-key-with-32-chars";
    process.env.GOOGLE_OAUTH_CLIENT_ID = "google-client";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "google-secret";
    assert.equal(providerReady("google"), true);
    assert.equal(providerReady("microsoft"), false);

    process.env.MICROSOFT_OAUTH_CLIENT_ID = " ";
    process.env.MICROSOFT_OAUTH_CLIENT_SECRET = "microsoft-secret";
    assert.equal(providerReady("microsoft"), false);

    process.env.MICROSOFT_OAUTH_CLIENT_ID = "microsoft-client";
    process.env.XERO_OAUTH_CLIENT_ID = "xero-client";
    process.env.XERO_OAUTH_CLIENT_SECRET = "xero-secret";
    process.env.QUICKBOOKS_OAUTH_CLIENT_ID = "quickbooks-client";
    process.env.QUICKBOOKS_OAUTH_CLIENT_SECRET = "quickbooks-secret";
    for (const provider of providers) assert.equal(providerReady(provider), true);

    delete process.env.CLIENTGUARD_OAUTH_TOKEN_ENCRYPTION_KEY;
    for (const provider of providers) assert.equal(providerReady(provider), false);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
