/**
 * Scheduling env — read from process.env (loaded by Next.js from repo root `.env`).
 */

export function schedulingEnvConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() &&
      process.env.GOOGLE_CALENDAR_ID?.trim() &&
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim()
  );
}

export function getAdvisorTimezone(): string {
  return process.env.ADVISOR_TIMEZONE?.trim() || "Asia/Kolkata";
}

export function getSlotDurationMinutes(): number {
  const n = Number(process.env.SLOT_DURATION_MINUTES);
  return Number.isFinite(n) && n >= 15 && n <= 120 ? n : 30;
}

export function getBookingsTabName(): string {
  return process.env.GOOGLE_SHEETS_TAB_BOOKINGS?.trim() || "Bookings";
}

export function getAdvisorPreBookingsTabName(): string {
  return (
    process.env.GOOGLE_SHEETS_TAB_ADVISOR_PREBOOKINGS?.trim() ||
    "Advisor Pre-Bookings"
  );
}

export function getPiiSubmissionsTabName(): string {
  return process.env.GOOGLE_SHEETS_TAB_PII?.trim() || "PII_Submissions";
}

export function parseServiceAccountJson(): Record<string, unknown> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw?.trim()) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  }
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch (e1) {
    const msg1 = e1 instanceof Error ? e1.message : String(e1);
    try {
      const decoded = Buffer.from(trimmed, "base64").toString("utf8");
      return JSON.parse(decoded) as Record<string, unknown>;
    } catch {
      const looksTruncated =
        trimmed.startsWith("{") &&
        (!trimmed.includes('"private_key"') || trimmed.length < 200);
      const hint = looksTruncated
        ? "The value looks truncated or split across lines. Put the service account JSON on ONE line in .env, or set GOOGLE_SERVICE_ACCOUNT_JSON to the base64 encoding of the JSON file (multiline .env values often break when the MCP child process inherits env)."
        : "Use valid minified JSON on one line, or base64 of the entire JSON file.";
      throw new Error(
        `GOOGLE_SERVICE_ACCOUNT_JSON parse failed (${msg1}). ${hint}`
      );
    }
  }
}
