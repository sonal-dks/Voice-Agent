/** In-memory rate limits for POST /api/booking/:code/submit (Phase 3). */

import { NextRequest, NextResponse } from "next/server";

const WINDOW_MS = 60 * 60 * 1000;

const hitsByCode = new Map<string, number[]>();
const hitsByIp = new Map<string, number[]>();

function prune(ts: number[]): number[] {
  const now = Date.now();
  return ts.filter((t) => now - t < WINDOW_MS);
}

export function allowPiiSubmit(
  map: Map<string, number[]>,
  key: string,
  limit: number
): boolean {
  const arr = prune(map.get(key) ?? []);
  if (arr.length >= limit) return false;
  arr.push(Date.now());
  map.set(key, arr);
  return true;
}

export function getPiiRateLimitMaps() {
  return { hitsByCode, hitsByIp };
}

/**
 * Apply rate limits before reading the request body (cheap 429 for abuse).
 * Returns a JSON `NextResponse` when limited, otherwise `null`.
 */
export function checkPiiSubmitRateLimits(
  request: NextRequest,
  bookingCode: string
): NextResponse | null {
  const code = bookingCode.trim();
  if (!code) {
    return NextResponse.json({ error: "Missing booking code" }, { status: 400 });
  }

  const limitCode = Number(process.env.RATE_LIMIT_PII_PER_CODE ?? "5");
  const limitIp = Number(process.env.RATE_LIMIT_PII_PER_IP ?? "100");
  const { hitsByCode, hitsByIp } = getPiiRateLimitMaps();

  if (!allowPiiSubmit(hitsByCode, code, Number.isFinite(limitCode) ? limitCode : 5)) {
    return NextResponse.json({ error: "Too many attempts for this code" }, { status: 429 });
  }
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  if (!allowPiiSubmit(hitsByIp, ip, Number.isFinite(limitIp) ? limitIp : 100)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  return null;
}
