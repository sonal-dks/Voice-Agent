#!/usr/bin/env node
/**
 * Print minified one-line JSON for GOOGLE_SERVICE_ACCOUNT_JSON (paste into .env).
 * Usage: node scripts/minify-service-account-json.mjs path/to/service-account.json
 */
import fs from "node:fs";

const p = process.argv[2];
if (!p) {
  console.error("Usage: node scripts/minify-service-account-json.mjs <path-to-key.json>");
  process.exit(1);
}
const text = fs.readFileSync(p, "utf8");
const obj = JSON.parse(text);
process.stdout.write(JSON.stringify(obj));
