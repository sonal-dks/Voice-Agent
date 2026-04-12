import { randomInt } from "crypto";

const CODE_RE = /^NL-[A-Z]\d{3}$/;

export function isValidBookingCodeFormat(code: string): boolean {
  return CODE_RE.test(code.trim());
}

export function randomBookingCode(): string {
  const letter = String.fromCharCode(65 + randomInt(0, 26));
  const digits = String(randomInt(0, 1000)).padStart(3, "0");
  return `NL-${letter}${digits}`;
}

/**
 * Generate a code and retry until `isTaken` returns false (Sheets scan).
 */
export async function generateUniqueBookingCode(
  isTaken: (code: string) => Promise<boolean>
): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = randomBookingCode();
    if (!(await isTaken(code))) return code;
  }
  throw new Error("Could not allocate a unique booking code");
}
