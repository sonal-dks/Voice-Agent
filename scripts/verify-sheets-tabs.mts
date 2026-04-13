/**
 * Loads repo-root `.env` and calls the same tab validation as the MCP server startup.
 * Exit 0 = all required tabs exist; exit 2 = missing tabs or API error.
 *
 * Usage: npm run verify:sheets-tabs
 */
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");
loadEnvConfig(root, true);

const { schedulingEnvConfigured } = await import(
  "../phase-2-scheduling-core/src/env.ts"
);
const { validateSchedulingSpreadsheetTabs } = await import(
  "../phase-2-scheduling-core/src/google_sheets.ts"
);

if (!schedulingEnvConfigured()) {
  console.error(
    "Missing scheduling env. Set GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_CALENDAR_ID, GOOGLE_SHEETS_SPREADSHEET_ID in repo-root .env"
  );
  process.exit(1);
}

try {
  const v = await validateSchedulingSpreadsheetTabs();
  console.log(JSON.stringify(v, null, 2));
  if (!v.ok) {
    console.error(
      "\nRequired tab names must match exactly (case-sensitive). Defaults: Bookings, Advisor Pre-Bookings, PII_Submissions. Override with GOOGLE_SHEETS_TAB_* in .env."
    );
    process.exit(2);
  }
  console.log("ok — spreadsheet has all required tabs.");
  process.exit(0);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("verify:sheets-tabs failed:", msg);
  process.exit(2);
}
