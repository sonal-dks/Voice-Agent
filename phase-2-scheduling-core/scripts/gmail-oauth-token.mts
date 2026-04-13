/**
 * Obtain a Gmail OAuth refresh token using GMAIL_OAUTH_* from repo-root `.env`.
 *
 * Default: starts a local HTTP server on the port from `GMAIL_OAUTH_REDIRECT_URI`,
 * opens your browser, completes the OAuth redirect, prints `GMAIL_OAUTH_REFRESH_TOKEN=...`.
 *
 * Prereqs (Google Cloud Console):
 * - Enable Gmail API
 * - OAuth client (Web application): add Authorized redirect URI exactly matching
 *   `GMAIL_OAUTH_REDIRECT_URI` (e.g. http://localhost:3005/oauth2/callback)
 *
 * Usage (repo root):
 *   npm run gmail:oauth-token
 *
 * Paste mode (no local server):
 *   npx tsx phase-2-scheduling-core/scripts/gmail-oauth-token.mts --manual
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
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

const manual = process.argv.includes("--manual");

const clientId = process.env.GMAIL_OAUTH_CLIENT_ID?.trim();
const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET?.trim();
const redirectUri =
  process.env.GMAIL_OAUTH_REDIRECT_URI?.trim() ||
  "http://localhost:3005/oauth2/callback";

if (!clientId || !clientSecret) {
  console.error(
    "Set GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET in repo root .env, then re-run."
  );
  process.exit(1);
}

const oauth2 = new OAuth2Client(clientId, clientSecret, redirectUri);
const scopes = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
];

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  scope: scopes,
  prompt: "consent",
});

function parseRedirectTarget(uri: string): { hostname: string; port: number; pathname: string } {
  const u = new URL(uri);
  const hostname = u.hostname || "localhost";
  const port = u.port
    ? parseInt(u.port, 10)
    : u.protocol === "https:"
      ? 443
      : 80;
  const pathname = u.pathname || "/";
  return { hostname, port, pathname };
}

async function exchangeCode(code: string) {
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      "\nNo refresh_token in response. Try:\n" +
        "  • Google Account → Security → Third-party access → remove this app, then run again.\n" +
        "  • Ensure this script uses prompt=consent (it does).\n"
    );
    process.exit(1);
  }
  console.log("\n--- Add or update in repo root .env ---\n");
  console.log(`GMAIL_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log(
    "\nConfirm GMAIL_OAUTH_REDIRECT_URI matches Google Cloud (this run used):",
    redirectUri
  );
  console.log(
    "Confirm GMAIL_OAUTH_USER_EMAIL is the Gmail you signed in with.\n"
  );
}

function openBrowser(url: string): void {
  const platform = process.platform;
  if (platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
  else if (platform === "win32")
    spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
  else spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
}

async function runWithLocalServer(): Promise<void> {
  const { hostname, port, pathname } = parseRedirectTarget(redirectUri);

  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    console.error(
      `Redirect URI host is "${hostname}". Automatic callback only works for localhost / 127.0.0.1.\n` +
        "Use a redirect like http://localhost:3005/oauth2/callback or run with --manual.\n"
    );
    process.exit(1);
  }

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const host = req.headers.host || `localhost:${port}`;
        const u = new URL(req.url || "/", `http://${host}`);

        if (u.pathname !== pathname) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not found");
          return;
        }

        const err = u.searchParams.get("error");
        const desc = u.searchParams.get("error_description") || "";
        if (err) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            `<body style="font-family:sans-serif"><h1>Authorization failed</h1><p>${err}</p><p>${desc}</p></body>`
          );
          server.close();
          reject(new Error(`${err}: ${desc}`));
          return;
        }

        const code = u.searchParams.get("code");
        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<body><p>Missing <code>code</code> query parameter.</p></body>");
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          "<body style=\"font-family:sans-serif;padding:2rem\">" +
            "<h1>Success</h1><p>You can close this tab. Refresh token is printed in the terminal.</p>" +
            "</body>"
        );

        server.close();
        try {
          await exchangeCode(code);
          resolve();
        } catch (e) {
          reject(e);
        }
      } catch (e) {
        server.close();
        reject(e);
      }
    });

    server.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EADDRINUSE") {
        console.error(
          `Port ${port} is in use. Stop the other process or change GMAIL_OAUTH_REDIRECT_URI (and Google Cloud) to another port.`
        );
      }
      reject(e);
    });

    server.listen(port, hostname, () => {
      console.log(`\nListening on http://${hostname}:${port}${pathname} for OAuth redirect.\n`);
      console.log("Opening browser — sign in with the Gmail account you want to send from.\n");
      console.log("If the browser does not open, visit:\n");
      console.log(authUrl);
      console.log("");
      openBrowser(authUrl);
    });
  });
}

async function runManualPaste(): Promise<void> {
  console.log("\n1. Open this URL in a browser (logged into the Gmail account you want):\n");
  console.log(authUrl);
  console.log(
    "\n2. After approving, copy the full redirect URL or the `code` query value.\n"
  );
  const rl = createInterface({ input, output });
  const pasted = await rl.question(
    "Paste the authorization `code` (or full redirect URL containing code=): "
  );
  rl.close();

  let code = pasted.trim();
  const fromQuery = code.match(/(?:[?&])code=([^&]+)/);
  if (fromQuery) code = decodeURIComponent(fromQuery[1]);

  if (!code) {
    console.error("No code provided.");
    process.exit(1);
  }
  await exchangeCode(code);
}

try {
  if (manual) {
    await runManualPaste();
  } else {
    await runWithLocalServer();
  }
} catch (e) {
  console.error("Failed:", e instanceof Error ? e.message : e);
  process.exit(1);
}
