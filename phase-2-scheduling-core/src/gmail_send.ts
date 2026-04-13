import { JWT, OAuth2Client } from "google-auth-library";
import { google } from "googleapis";

import { parseServiceAccountJson } from "./env";

export type GmailAuthClient = JWT | OAuth2Client;

function toRawBase64(message: string): string {
  return Buffer.from(message, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildRfc822(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
}): string {
  const lines = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    input.body,
  ];
  return lines.join("\r\n");
}

/** True when OAuth user credentials are present (personal @gmail.com path). */
export function oauthGmailConfigured(): boolean {
  return Boolean(
    process.env.GMAIL_OAUTH_CLIENT_ID?.trim() &&
      process.env.GMAIL_OAUTH_CLIENT_SECRET?.trim() &&
      process.env.GMAIL_OAUTH_REFRESH_TOKEN?.trim()
  );
}

/** If the same refresh token was pasted twice on one .env line, Google returns invalid_grant. */
function normalizeOAuthRefreshToken(raw: string): string {
  const t = raw.trim();
  if (t.length >= 40 && t.length % 2 === 0) {
    const mid = t.length / 2;
    if (t.slice(0, mid) === t.slice(mid)) return t.slice(0, mid);
  }
  return t;
}

/**
 * OAuth2 user creds for Gmail API (consumer Gmail / "installed app" or OAuth Playground).
 * Redirect URI must match the one used when the refresh token was issued.
 */
export function getGmailOAuthClient(): OAuth2Client | null {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET?.trim();
  const refreshToken = normalizeOAuthRefreshToken(
    process.env.GMAIL_OAUTH_REFRESH_TOKEN ?? ""
  );
  if (!clientId || !clientSecret || !refreshToken) return null;

  const redirectUri =
    process.env.GMAIL_OAUTH_REDIRECT_URI?.trim() ||
    "https://developers.google.com/oauthplayground";

  const oauth2 = new OAuth2Client(clientId, clientSecret, redirectUri);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

/** Workspace: service account JWT with domain-wide delegation (`subject` = mailbox to impersonate). */
export async function getGmailJwtClient(): Promise<JWT | null> {
  const subject = process.env.GMAIL_DELEGATED_USER?.trim();
  if (!subject) return null;
  const creds = parseServiceAccountJson();
  const email = String(creds.client_email ?? "");
  const key = String(creds.private_key ?? "");
  if (!email || !key) return null;
  return new JWT({
    email,
    key,
    scopes: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.compose",
    ],
    subject,
  });
}

/**
 * Prefer OAuth (personal Gmail) when all OAuth vars are set; otherwise Workspace JWT delegation.
 */
export async function getGmailAuthClient(): Promise<GmailAuthClient | null> {
  const oauth = getGmailOAuthClient();
  if (oauth) return oauth;
  return getGmailJwtClient();
}

/**
 * RFC822 From / delegated identity: OAuth uses `GMAIL_OAUTH_USER_EMAIL`; Workspace uses `GMAIL_DELEGATED_USER`.
 */
export function getConfiguredGmailSenderEmail(): string | null {
  if (oauthGmailConfigured()) {
    return process.env.GMAIL_OAUTH_USER_EMAIL?.trim() || null;
  }
  return process.env.GMAIL_DELEGATED_USER?.trim() || null;
}

function gmailConfigErrorMessage(): string {
  if (oauthGmailConfigured()) {
    return "Gmail OAuth is partial — set GMAIL_OAUTH_USER_EMAIL to the Gmail address that authorized the app.";
  }
  return (
    "Gmail not configured: use either (1) GMAIL_OAUTH_CLIENT_ID + GMAIL_OAUTH_CLIENT_SECRET + " +
    "GMAIL_OAUTH_REFRESH_TOKEN + GMAIL_OAUTH_USER_EMAIL for personal Gmail, or (2) GMAIL_DELEGATED_USER + " +
    "Workspace domain-wide delegation with GOOGLE_SERVICE_ACCOUNT_JSON."
  );
}

/** Human-readable suffix for logs and API `email_errors` (no secrets). */
export function formatGmailAuthFailure(err: unknown): string {
  const g = err as {
    message?: string;
    response?: { data?: { error?: string; error_description?: string } };
  };
  const body = g.response?.data;
  const apiPart =
    body?.error != null
      ? `${body.error}${body.error_description ? ` (${body.error_description})` : ""}`
      : "";
  const s = err instanceof Error ? err.message : String(err);
  const combined = [apiPart, s].filter(Boolean).join(" — ") || s;
  if (/invalid_grant/i.test(combined)) {
    return (
      `${combined} — Regenerate the refresh token: from repo root run \`npm run gmail:oauth-token\`, then put the printed GMAIL_OAUTH_REFRESH_TOKEN in .env (single line). ` +
      `Use the same GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET as in Google Cloud; GMAIL_OAUTH_REDIRECT_URI must match an authorized redirect URI exactly.`
    );
  }
  return combined;
}

function requireSenderForDraft(): string {
  const from = getConfiguredGmailSenderEmail();
  if (from) return from;
  if (oauthGmailConfigured()) {
    throw new Error(
      "Set GMAIL_OAUTH_USER_EMAIL to the same Gmail account you authorized (OAuth From: line)."
    );
  }
  throw new Error("GMAIL_DELEGATED_USER required for draft From line (Workspace path).");
}

export async function sendPlainTextEmail(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  const auth = await getGmailAuthClient();
  if (!auth) {
    throw new Error(gmailConfigErrorMessage());
  }
  const gmail = google.gmail({ version: "v1", auth });
  const raw = toRawBase64(
    buildRfc822({
      from: input.from,
      to: input.to,
      subject: input.subject,
      body: input.body,
    })
  );
  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
}

/**
 * Creates a Gmail **draft** in the authenticated user's mailbox (OAuth: that user; Workspace: delegated user).
 */
export async function createPlainTextDraft(input: {
  to: string;
  subject: string;
  body: string;
}): Promise<string> {
  const auth = await getGmailAuthClient();
  if (!auth) {
    throw new Error(gmailConfigErrorMessage());
  }
  const from = requireSenderForDraft();
  const gmail = google.gmail({ version: "v1", auth });
  const raw = toRawBase64(
    buildRfc822({
      from,
      to: input.to,
      subject: input.subject,
      body: input.body,
    })
  );
  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: { raw },
    },
  });
  const id = res.data.id;
  if (!id) throw new Error("Gmail drafts.create returned no draft id");
  return id;
}
