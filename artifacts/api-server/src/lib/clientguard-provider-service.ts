import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Request } from "express";

export type Provider = "google" | "microsoft" | "xero" | "quickbooks";

export const providers: Provider[] = ["google", "microsoft", "xero", "quickbooks"];

type ProviderConfig = {
  clientId: string;
  clientSecret: string;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  token_type?: string;
};

export class ProviderHttpError extends Error {
  constructor(readonly status: number) {
    super(`Provider request failed with HTTP ${status}.`);
    this.name = "ProviderHttpError";
  }
}

function configFor(provider: Provider): ProviderConfig | null {
  const prefix = {
    google: "GOOGLE",
    microsoft: "MICROSOFT",
    xero: "XERO",
    quickbooks: "QUICKBOOKS",
  }[provider];
  const clientId = process.env[`${prefix}_OAUTH_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_OAUTH_CLIENT_SECRET`];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function providerReady(provider: Provider): boolean {
  return Boolean(
    configFor(provider) &&
      process.env.CLIENTGUARD_OAUTH_TOKEN_ENCRYPTION_KEY?.length,
  );
}

function originFor(req: Request): string {
  const host = (req.get("x-forwarded-host") ?? req.get("host") ?? "")
    .split(",")[0]
    .trim();
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0].trim();
  const protocol = forwardedProto || req.protocol || "https";
  if (!host || /[\s/@]/.test(host)) throw new Error("Cannot determine the public callback host.");
  return `${protocol}://${host}`;
}

export function redirectUriFor(req: Request, provider: Provider): string {
  return `${originFor(req)}/api/integrations/${provider}/callback`;
}

function scopesFor(provider: Provider) {
  switch (provider) {
    case "google":
      return [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/gmail.readonly",
      ];
    case "microsoft":
      return ["openid", "profile", "email", "offline_access", "User.Read", "Calendars.ReadWrite", "Mail.ReadWrite", "Mail.Send"];
    case "xero":
      return ["openid", "profile", "email", "offline_access", "accounting.transactions", "accounting.contacts"];
    case "quickbooks":
      return ["openid", "profile", "email", "com.intuit.quickbooks.accounting"];
  }
}

export function authorizationUrl(
  provider: Provider,
  redirectUri: string,
  state: string,
) {
  const config = configFor(provider);
  if (!config || !process.env.CLIENTGUARD_OAUTH_TOKEN_ENCRYPTION_KEY) {
    throw new Error("Provider OAuth credentials and the token encryption secret must be configured.");
  }
  const url = {
    google: new URL("https://accounts.google.com/o/oauth2/v2/auth"),
    microsoft: new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize"),
    xero: new URL("https://login.xero.com/identity/connect/authorize"),
    quickbooks: new URL("https://appcenter.intuit.com/connect/oauth2"),
  }[provider];
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopesFor(provider).join(" "));
  url.searchParams.set("state", state);
  if (provider === "google") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
  } else if (provider === "microsoft") {
    url.searchParams.set("response_mode", "query");
  } else if (provider === "quickbooks") {
    url.searchParams.set("response_mode", "query");
  }
  return url.toString();
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!response.ok) {
    throw new ProviderHttpError(response.status);
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Provider returned an invalid response.");
  }
}

export async function exchangeAuthorizationCode(
  provider: Provider,
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const config = configFor(provider);
  if (!config) throw new Error("Provider OAuth credentials are not configured.");
  const tokenUrl = {
    google: "https://oauth2.googleapis.com/token",
    microsoft: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    xero: "https://identity.xero.com/connect/token",
    quickbooks: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  }[provider];
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (provider === "xero" || provider === "quickbooks") {
    headers.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", config.clientId);
    body.set("client_secret", config.clientSecret);
  }
  const result = await responseJson(await fetch(tokenUrl, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(20_000),
  }));
  if (typeof result.access_token !== "string") {
    throw new Error("Provider did not return an access token.");
  }
  return result as unknown as TokenResponse;
}

export async function refreshProviderToken(
  provider: Provider,
  refreshToken: string,
): Promise<TokenResponse> {
  const config = configFor(provider);
  if (!config) throw new Error("Provider OAuth credentials are not configured.");
  const tokenUrl = {
    google: "https://oauth2.googleapis.com/token",
    microsoft: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    xero: "https://identity.xero.com/connect/token",
    quickbooks: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  }[provider];
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (provider === "xero" || provider === "quickbooks") {
    headers.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", config.clientId);
    body.set("client_secret", config.clientSecret);
  }
  const result = await responseJson(await fetch(tokenUrl, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(20_000),
  }));
  if (typeof result.access_token !== "string") {
    throw new Error("Provider did not return a refreshed access token.");
  }
  return result as unknown as TokenResponse;
}

function encryptionKey() {
  const secret = process.env.CLIENTGUARD_OAUTH_TOKEN_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new Error("The OAuth token encryption secret must contain at least 32 characters.");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptToken(value: string) {
  const [ivText, tagText, cipherText] = value.split(".");
  if (!ivText || !tagText || !cipherText) throw new Error("Stored provider token is malformed.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function randomOAuthState() {
  return randomBytes(32).toString("base64url");
}

export function hashOAuthState(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function providerJson(
  url: string,
  token: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");
  const response = await fetch(url, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
  return responseJson(response);
}

export async function getProviderProfile(
  provider: Provider,
  token: string,
  quickbooksRealmId?: string,
) {
  if (provider === "google") {
    const profile = await providerJson("https://www.googleapis.com/oauth2/v2/userinfo", token);
    return {
      label: String(profile.email ?? "Google account"),
      remoteAccountId: String(profile.id ?? ""),
    };
  }
  if (provider === "microsoft") {
    const profile = await providerJson("https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName,id", token);
    return {
      label: String(profile.displayName ?? profile.mail ?? "Microsoft account"),
      remoteAccountId: String(profile.id ?? ""),
    };
  }
  if (provider === "xero") {
    const connections = await providerJson("https://api.xero.com/connections", token);
    const tenants = Array.isArray(connections) ? connections as Array<Record<string, unknown>> : [];
    const first = tenants[0];
    if (!first?.tenantId) throw new Error("No Xero organisation is connected to this account.");
    return {
      label: String(first.tenantName ?? "Xero organisation"),
      remoteAccountId: String(first.tenantId),
    };
  }
  if (!quickbooksRealmId) throw new Error("QuickBooks did not return a company identifier.");
  return { label: `QuickBooks company ${quickbooksRealmId}`, remoteAccountId: quickbooksRealmId };
}

export function oauthConfigFor(provider: Provider) {
  return configFor(provider);
}

export function tokenExpiry(token: TokenResponse) {
  const expiresIn = Number(token.expires_in ?? 3600);
  return new Date(Date.now() + Math.max(0, expiresIn - 60) * 1000);
}
