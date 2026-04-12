import { randomUUID } from "crypto";
import { google } from "googleapis";

import {
  getAdvisorPreBookingsTabName,
  getBookingsTabName,
  getPiiSubmissionsTabName,
} from "./env";
import { getOAuthClient } from "./google_auth";
import type { BookingRowInput } from "./types";

/** A1 notation tab — quote if name has spaces/special chars */
function tabRange(tab: string, cellRange: string): string {
  const safe = /[^a-zA-Z0-9_]/.test(tab)
    ? `'${tab.replace(/'/g, "''")}'`
    : tab;
  return `${safe}!${cellRange}`;
}

function spreadsheetId(): string {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!id) throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID is not set");
  return id;
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
export async function appendAdvisorPreBookingsLine(input: {
  dateSummary: string;
  topic: string;
  slotDisplay: string;
  booking_code: string;
}): Promise<void> {
  const auth = await getOAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const range = tabRange(getAdvisorPreBookingsTabName(), "A:D");
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
