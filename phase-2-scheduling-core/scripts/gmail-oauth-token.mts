/**
 * One-time helper: print a Gmail OAuth refresh token for personal Gmail.
 *
 * Prereqs:
 * - Google Cloud Console: enable Gmail API; create OAuth 2.0 Client ID (Desktop or Web).
 * - If Web client: add authorized redirect URI (must match GMAIL_OAUTH_REDIRECT_URI below).
 *   OAuth Playground: use https://developers.google.com/oauthplayground and its client id/secret from Step 1 there,
 *   or add that redirect to your Web client and use the same redirect here.
 *
 * Usage (from repo root):
 *   cd phase-2-scheduling-core && npx tsx scripts/gmail-oauth-token.mts
 *
 * Loads single-line GMAIL_OAUTH_* keys from ../../.env when present.
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OAuth2Client } from "google-auth-library";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadGmailOAuthLinesFromRootEnv(): void {
  const envPath = path.resolve(__dirname, "../../.env");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    if (!key.startsWith("GMAIL_OAUTH_")) continue;
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadGmailOAuthLinesFromRootEnv();

const clientId = process.env.GMAIL_OAUTH_CLIENT_ID?.trim();
const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET?.trim();
const redirectUri =
  process.env.GMAIL_OAUTH_REDIRECT_URI?.trim() ||
  "http://localhost:3005/oauth2/callback";

if (!clientId || !clientSecret) {
  console.error(
    "Set GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET (e.g. in repo root .env), then re-run."
  );
  process.exit(1);
}

const oauth2 = new OAuth2Client(clientId, clientSecret, redirectUri);
const scopes = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
];

const url = oauth2.generateAuthUrl({
  access_type: "offline",
  scope: scopes,
  prompt: "consent",
});

console.log("\n1. Open this URL in a browser (logged into the Gmail account you want):\n");
console.log(url);
console.log(
  "\n2. After approving, you will be redirected to your redirect URI with ?code=...\n" +
    "   If using localhost, copy the full redirect URL or paste only the `code` query value.\n"
);

const rl = createInterface({ input, output });
const pasted = await rl.question(
  "Paste the authorization `code` (or full redirect URL containing code=): "
);
rl.close();

let code = pasted.trim();
const fromQuery = code.match(/(?:[?&])code=([^&]+)/);
if (fromQuery) {
  code = decodeURIComponent(fromQuery[1]);
}

if (!code) {
  console.error("No code provided.");
  process.exit(1);
}

try {
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      "No refresh_token in response. Revoke app access in Google Account → Security → Third-party access, then run again with prompt=consent (this script already requests it)."
    );
    process.exit(1);
  }
  console.log("\nAdd to .env (and Vercel):\n");
  console.log(`GMAIL_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log(
    "\nSet GMAIL_OAUTH_REDIRECT_URI to the same redirect you registered (this run used:",
    redirectUri + ")."
  );
  console.log(
    "Set GMAIL_OAUTH_USER_EMAIL to the Gmail address you logged in with.\n"
  );
} catch (e) {
  console.error("Token exchange failed:", e instanceof Error ? e.message : e);
  process.exit(1);
}
