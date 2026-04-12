import { randomUUID } from "crypto";

import type { OfferedSlot } from "@/lib/mcp/schedulingTypes";

export type IntentKind =
  | "book_new"
  | "reschedule"
  | "cancel"
  | "what_to_prepare"
  | "check_availability"
  | "unclear";

export interface SessionState {
  sessionId: string;
  /** Gemini chat turns: user/model alternating text parts */
  history: { role: "user" | "model"; text: string }[];
  disclaimerDelivered: boolean;
  lastIntent: IntentKind | null;
  updatedAt: number;
  /** Phase 2 — last topic used for booking */
  bookingTopic?: string | null;
  /** Phase 2 — slots from last offer_slots tool (IST) */
  offeredSlots?: OfferedSlot[];
  /** Phase 2 — last issued booking code (confirmed or waitlist) */
  lastBookingCode?: string | null;
  /** Phase 3 — secure token for post-call PII link (never send to LLM in tool responses) */
  lastSecureLinkToken?: string | null;
}

const store = new Map<string, SessionState>();

const TTL_MS = 1000 * 60 * 60 * 4; // 4 hours

export function createSession(): SessionState {
  const sessionId = randomUUID();
  const s: SessionState = {
    sessionId,
    history: [],
    disclaimerDelivered: false,
    lastIntent: null,
    bookingTopic: null,
    offeredSlots: undefined,
    lastBookingCode: null,
    lastSecureLinkToken: null,
    updatedAt: Date.now(),
  };
  store.set(sessionId, s);
  return s;
}

export function getSession(sessionId: string): SessionState | undefined {
  const s = store.get(sessionId);
  if (!s) return undefined;
  if (Date.now() - s.updatedAt > TTL_MS) {
    store.delete(sessionId);
    return undefined;
  }
  return s;
}

export function touchSession(s: SessionState) {
  s.updatedAt = Date.now();
}

export function appendHistory(
  s: SessionState,
  role: "user" | "model",
  text: string
) {
  s.history.push({ role, text });
  touchSession(s);
}
