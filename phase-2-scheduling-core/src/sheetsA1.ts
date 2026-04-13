/**
 * Google Sheets API v4 A1 notation for `spreadsheetId` + `range` parameters.
 * @see https://developers.google.com/sheets/api/guides/concepts#a1_notation
 *
 * Sheet titles must be wrapped in single quotes when they contain spaces, quotes,
 * or some punctuation. **Always quoting** the sheet title avoids "Unable to parse range"
 * edge cases with unquoted names and matches API examples.
 */

/** Minimal guard — Sheets accepts many A1 forms (e.g. A2:K, A:A, A1). */
export function assertValidCellOrRangeSpec(spec: string): void {
  const s = spec.trim();
  if (!s) throw new Error("Cell/range spec is empty");
  if (s.includes("!")) {
    throw new Error('Cell/range must not include "!" (pass sheet title separately)');
  }
}

/**
 * Escape a sheet title for use inside single quotes in A1 notation.
 */
export function escapeSheetTitleForA1(title: string): string {
  return title.trim().replace(/'/g, "''");
}

/**
 * Build a full A1 range: `'Sheet Name'!A1:B2` or `'Bookings'!A:A`
 */
export function buildA1Range(sheetTitle: string, cellRange: string): string {
  const name = sheetTitle.trim();
  if (!name) {
    throw new Error(
      "Sheet title is empty — set GOOGLE_SHEETS_TAB_BOOKINGS (and related) in .env"
    );
  }
  const range = cellRange.trim();
  assertValidCellOrRangeSpec(range);
  const escaped = escapeSheetTitleForA1(name);
  return `'${escaped}'!${range}`;
}
