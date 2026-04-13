import { randomUUID } from "crypto";
import { google } from "googleapis";

import {
  getAdvisorPreBookingsTabName,
  getBookingsTabName,
  getPiiSubmissionsTabName,
} from "./env";
import { getOAuthClient } from "./google_auth";
import { buildA1Range } from "./sheetsA1";
import type { BookingRowInput } from "./types";

function tabRange(tab: string, cellRange: string): string {
  return buildA1Range(tab, cellRange);
}

function spreadsheetId(): string {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!id) throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID is not set");
  return id;
}

/**
 * Lists sheet tab titles and verifies required tabs exist (exact name match).
 * Call once at MCP startup or when debugging "Unable to parse range".
 */
export async function validateSchedulingSpreadsheetTabs(): Promise<{
  ok: boolean;
  found: string[];
  missing: string[];
}> {
  const auth = await getOAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.get({
    spreadsheetId: spreadsheetId(),
    fields: "sheets.properties.title",
  });
  const found = (res.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => typeof t === "string" && t.length > 0);
  const bookingsTab = getBookingsTabName();
  const piiTab = getPiiSubmissionsTabName();
  const configuredPre = process.env.GOOGLE_SHEETS_TAB_ADVISOR_PREBOOKINGS?.trim();
  /** Without explicit tab env, accept legacy "Notes" or default "Advisor Pre-Bookings". */
  const preBookingsOk =
    configuredPre != null && configuredPre !== ""
      ? found.includes(configuredPre)
      : found.includes("Advisor Pre-Bookings") || found.includes("Notes");
  const missing: string[] = [];
  if (!found.includes(bookingsTab)) missing.push(bookingsTab);
  if (!preBookingsOk) {
    missing.push(
      configuredPre ||
        "Advisor Pre-Bookings (or set GOOGLE_SHEETS_TAB_ADVISOR_PREBOOKINGS / add a Notes tab)"
    );
  }
  if (!found.includes(piiTab)) missing.push(piiTab);
  return {
    ok: missing.length === 0,
    found,
    missing,
  };
}

/**
 * Returns true if booking_code appears in column A of the Bookings tab (rows 2+).
 */
export async function bookingCodeExists(booking_code: string): Promise<boolean> {
  const auth = await getOAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const range = tabRange(getBookingsTabName(), "A:A");
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range,
  });
  const rows = res.data.values ?? [];
  const target = booking_code.trim();
  for (let i = 1; i < rows.length; i++) {
    const cell = rows[i]?.[0];
    if (cell != null && String(cell).trim() === target) return true;
  }
  return false;
}

function rowValues(row: BookingRowInput): unknown[] {
  return [
    row.booking_code,
    row.topic,
    row.slot_time,
    row.slot_display,
    row.status,
    row.google_event_id,
    row.side_effects_completed,
    row.secure_link_token,
    row.pii_submitted,
    row.created_at,
    row.updated_at,
  ];
}

/** Append one row — expects row 1 to be headers matching this column order */
export async function appendBookingRow(row: BookingRowInput): Promise<void> {
  const auth = await getOAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const range = tabRange(getBookingsTabName(), "A:K");

  await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [rowValues(row) as string[]],
    },
  });
}

export function newSecureLinkToken(): string {
  return randomUUID();
}

/**
 * Append one log line: date summary, topic, slot text, booking_code (architecture §7 Advisor Pre-Bookings).
 * Row 1 should be headers e.g. date | topic | slot | code
 */
async function appendAdvisorPreBookingsToTab(
  tabTitle: string,
  input: {
    dateSummary: string;
    topic: string;
    slotDisplay: string;
    booking_code: string;
  }
): Promise<void> {
  const auth = await getOAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const range = tabRange(tabTitle, "A:D");
  await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          input.dateSummary,
          input.topic,
          input.slotDisplay,
          input.booking_code,
        ],
      ],
    },
  });
}

/**
 * Append one log line: date summary, topic, slot text, booking_code.
 * If the default tab "Advisor Pre-Bookings" is missing but a "Notes" tab exists (legacy layout),
 * appends to "Notes" when `GOOGLE_SHEETS_TAB_ADVISOR_PREBOOKINGS` is unset.
 */
export async function appendAdvisorPreBookingsLine(input: {
  dateSummary: string;
  topic: string;
  slotDisplay: string;
  booking_code: string;
}): Promise<void> {
  const configured = process.env.GOOGLE_SHEETS_TAB_ADVISOR_PREBOOKINGS?.trim();
  const primary = getAdvisorPreBookingsTabName();
  try {
    await appendAdvisorPreBookingsToTab(primary, input);
    return;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const badRange = msg.includes("Unable to parse range");
    if (
      badRange &&
      !configured &&
      primary === "Advisor Pre-Bookings"
    ) {
      console.warn(
        "[appendAdvisorPreBookingsLine] Tab 'Advisor Pre-Bookings' not found; retrying with 'Notes'. Set GOOGLE_SHEETS_TAB_ADVISOR_PREBOOKINGS to your tab name to silence this."
      );
      await appendAdvisorPreBookingsToTab("Notes", input);
      return;
    }
    throw e;
  }
}

function padBookingCells(cells: unknown[] | undefined): string[] {
  const out: string[] = [];
  for (let i = 0; i < 11; i++) {
    const v = cells?.[i];
    out.push(v == null ? "" : String(v));
  }
  return out;
}

/** Data rows start at sheet row 2 (row 1 = headers). */
export async function getBookingByCode(
  booking_code: string
): Promise<{ rowIndex1Based: number; cells: string[] } | null> {
  const auth = await getOAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const range = tabRange(getBookingsTabName(), "A2:K");
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range,
  });
  const rows = res.data.values ?? [];
  const target = booking_code.trim();
  for (let i = 0; i < rows.length; i++) {
    const cell = rows[i]?.[0];
    if (cell != null && String(cell).trim() === target) {
      return {
        rowIndex1Based: i + 2,
        cells: padBookingCells(rows[i]),
      };
    }
  }
  return null;
}

export async function updateBookingRowRange(
  rowIndex1Based: number,
  cells: string[]
): Promise<void> {
  if (cells.length !== 11) {
    throw new Error("Booking row must have 11 columns A–K");
  }
  const auth = await getOAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const range = tabRange(getBookingsTabName(), `A${rowIndex1Based}:K${rowIndex1Based}`);
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [cells],
    },
  });
}

/** Append encrypted PII blob — tab columns: booking_code | submitted_at | ciphertext */
export async function appendPiiSubmissionRow(input: {
  booking_code: string;
  submitted_at_iso: string;
  ciphertext_b64: string;
}): Promise<void> {
  const auth = await getOAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const range = tabRange(getPiiSubmissionsTabName(), "A:C");
  await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          input.booking_code,
          input.submitted_at_iso,
          input.ciphertext_b64,
        ],
      ],
    },
  });
}
