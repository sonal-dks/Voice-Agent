/**
 * Run: npx tsx phase-2-scheduling-core/src/sheetsA1.test.ts
 */
import assert from "node:assert/strict";

import { buildA1Range, escapeSheetTitleForA1 } from "./sheetsA1";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok — ${name}`);
  } catch (e) {
    console.error(`FAIL — ${name}`, e);
    process.exit(1);
  }
}

test("Bookings column scan", () => {
  assert.equal(buildA1Range("Bookings", "A:A"), "'Bookings'!A:A");
});

test("append row range A:K", () => {
  assert.equal(buildA1Range("Bookings", "A:K"), "'Bookings'!A:K");
});

test("Advisor Pre-Bookings with space and hyphen", () => {
  assert.equal(
    buildA1Range("Advisor Pre-Bookings", "A:D"),
    "'Advisor Pre-Bookings'!A:D"
  );
});

test("sheet title with apostrophe is escaped", () => {
  assert.equal(escapeSheetTitleForA1("It's Fine"), "It''s Fine");
  assert.equal(buildA1Range("It's Fine", "A1"), "'It''s Fine'!A1");
});

test("empty sheet title throws", () => {
  assert.throws(() => buildA1Range("", "A1"), /empty/);
  assert.throws(() => buildA1Range("   ", "A1"), /empty/);
});

test("cell range must not contain !", () => {
  assert.throws(() => buildA1Range("Bookings", "A1!B2"), /!/);
});

console.log("\n✅ sheetsA1 tests passed.");
