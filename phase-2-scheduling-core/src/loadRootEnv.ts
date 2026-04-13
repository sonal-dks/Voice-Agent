/**
 * Load repo-root `.env` into `process.env` when values are missing or blank.
 * Ensures the MCP stdio child (spawned from Next) picks up Gmail and Google keys
 * even if the parent only forwarded empty placeholders.
 *
 * Import this module first in `mcp/advisor-mcp-server.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const loaded = { done: false };

function parseEnvLine(line: string): { key: string; val: string } | null {
  const t = line.trim();
  if (!t || t.startsWith("#")) return null;
  const eq = t.indexOf("=");
  if (eq === -1) return null;
  const key = t.slice(0, eq).trim();
  if (!key) return null;
  let val = t.slice(eq + 1).trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  return { key, val };
}

export function loadRepoRootEnvFromFile(): void {
  if (loaded.done) return;
  loaded.done = true;

  const here = path.dirname(fileURLToPath(import.meta.url));
  const rootEnv = path.resolve(here, "..", "..", ".env");
  if (!existsSync(rootEnv)) return;

  const text = readFileSync(rootEnv, "utf8");
  for (const line of text.split("\n")) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const cur = process.env[parsed.key];
    if (cur === undefined || cur.trim() === "") {
      process.env[parsed.key] = parsed.val;
    }
  }
}

loadRepoRootEnvFromFile();
