import { DateTime } from "luxon";

import {
  callAdvisorMcpTool,
  schedulingCredentialsPresent,
  schedulingMcpServerAvailable,
} from "@/lib/mcp/schedulingMcpClient";
import type { OfferedSlot } from "@/lib/mcp/schedulingTypes";
import type { IntentKind, SessionState } from "./state";

function getAdvisorTz(): string {
  return process.env.ADVISOR_TIMEZONE?.trim() || "Asia/Kolkata";
}

function slotDurationMinutes(): number {
  const n = parseInt(process.env.SLOT_DURATION_MINUTES || "30", 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

/**
 * Parse a wall-clock time from natural text (used to match offered slots or book a custom window).
 */
function parseWallClockFromUserText(
  text: string,
  slots: OfferedSlot[]
): { hour: number; minute: number } | null {
  const t = text.trim();
  const m12 = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const minute = m12[2] ? parseInt(m12[2], 10) : 0;
    const ap = m12[3].toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return { hour: h, minute };
  }
  const mHm = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (mHm) {
    let h = parseInt(mHm[1], 10);
    const minute = parseInt(mHm[2], 10);
    const afternoonCue = /afternoon|evening|\bpm\b|after\s+noon/i.test(t);
    const minHour =
      slots.length > 0
        ? Math.min(
            ...slots.map((x) =>
              DateTime.fromISO(x.startIso, { setZone: true })
                .setZone(getAdvisorTz())
                .hour
            )
          )
        : 12;
    const biasAfternoon = afternoonCue || minHour >= 12;
    if (biasAfternoon && h >= 1 && h <= 11) h += 12;
    return { hour: h, minute };
  }
  return null;
}

/** Never pass secure_link_token back to the LLM (logs / model context). */
function redactSecureLinkTokenForLlm(
  raw: Record<string, unknown>
): Record<string, unknown> {
  let out = raw;
  if ("secure_link_token" in out) {
    const { secure_link_token: _t, ...rest } = out;
    out = rest;
  }
  if ("calendar_error" in out) {
    const { calendar_error: _c, ...rest } = out;
    out = rest;
  }
  if (typeof out.advisor_gmail_draft === "string" && out.advisor_gmail_draft === "failed") {
    console.warn("[toolHandlers] Gmail draft failed for this booking — check GMAIL_OAUTH_* or GMAIL_DELEGATED_USER env vars");
  }
  if (Array.isArray(out.email_errors) && (out.email_errors as string[]).length > 0) {
    console.warn("[toolHandlers] Email errors:", out.email_errors);
  }
  return out;
}

export function handleDetectIntent(args: Record<string, unknown>): {
  ok: boolean;
  note: string;
  intent: IntentKind | "unclear";
} {
  const intent = String(args.intent ?? "unclear") as IntentKind | "unclear";
  return {
    ok: true,
    intent,
    note: "Intent recorded for dialog routing.",
  };
}

function slotsFromMcp(raw: unknown): OfferedSlot[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((s) => {
    const o = s as Record<string, unknown>;
    return {
      key: String(o.key ?? ""),
      display: String(o.display ?? ""),
      startIso: String(o.startIso ?? o.key ?? ""),
      endIso: String(o.endIso ?? ""),
    };
  });
}

/** e.g. "5:30pm" from "5:30 PM IST" or "Apr 13, 5:30 PM" */
function timeFingerprint(s: string): string | null {
  const m = s.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = m[2];
  const ap = m[3].toLowerCase();
  return `${h}:${min}${ap}`;
}

/** Strip trailing ack words so "…9:00 AM IST WORKS" matches slot display */
function normalizeUserSlotChoice(text: string): string {
  return text
    .trim()
    .replace(/\s*(works|work|great|perfect|sounds good|ok|yes|please|thanks|thank you)\s*!*$/gi, "")
    .trim();
}

/**
 * LLMs often pass the friendly time as key or wrong shape; avoid confirm loops.
 */
function resolveOfferedSlot(
  slots: OfferedSlot[],
  selected_slot_key: string,
  selected_slot_display: string
): OfferedSlot | undefined {
  if (slots.length === 0) return undefined;

  const keyTrim = selected_slot_key.trim();
  const dispTrim = selected_slot_display.trim();
  const kd = normalizeUserSlotChoice(keyTrim);
  const dd = normalizeUserSlotChoice(dispTrim);

  let s = slots.find((x) => x.key === keyTrim || x.startIso === keyTrim);
  if (s) return s;

  const norm = (t: string) =>
    t.toLowerCase().replace(/\s+/g, " ").trim();

  const combined = norm(`${kd} ${dd}`);
  if (combined.length >= 10) {
    const byFullDisplay = slots.filter((x) => combined.includes(norm(x.display)));
    if (byFullDisplay.length === 1) return byFullDisplay[0];
  }

  function pickByIndex(label: string): number | undefined {
    const lower = label.toLowerCase();
    if (
      /^(1|first|one|option\s*1|the\s*first)$/i.test(lower) ||
      lower === "1."
    )
      return 0;
    if (
      /^(2|second|two|option\s*2|the\s*second)$/i.test(lower) ||
      lower === "2."
    )
      return 1;
    return undefined;
  }

  const ki = pickByIndex(keyTrim) ?? pickByIndex(kd);
  if (ki !== undefined && ki < slots.length) return slots[ki];
  const di = pickByIndex(dispTrim) ?? pickByIndex(dd);
  if (di !== undefined && di < slots.length) return slots[di];

  const userFp =
    timeFingerprint(dd) ||
    timeFingerprint(kd) ||
    timeFingerprint(dispTrim) ||
    timeFingerprint(keyTrim) ||
    timeFingerprint(`${dispTrim} ${keyTrim}`);
  if (userFp) {
    const matches = slots.filter((x) => {
      const fp = timeFingerprint(x.display);
      return fp === userFp;
    });
    if (matches.length === 1) return matches[0];
  }

  const wcSource = `${kd} ${dd} ${dispTrim} ${keyTrim}`;
  const wc = parseWallClockFromUserText(wcSource, slots);
  if (wc) {
    const matches = slots.filter((x) => {
      const dt = DateTime.fromISO(x.startIso, { setZone: true }).setZone(
        getAdvisorTz()
      );
      return dt.hour === wc.hour && dt.minute === wc.minute;
    });
    if (matches.length === 1) return matches[0];
  }

  const nd = norm(dd) || norm(kd) || norm(dispTrim) || norm(keyTrim);
  if (nd.length >= 4) {
    s = slots.find(
      (x) =>
        norm(x.display).includes(nd) ||
        nd.includes(norm(x.display)) ||
        norm(x.key).includes(nd)
    );
    if (s) return s;
  }

  if (slots.length === 1 && (!keyTrim || !dispTrim)) return slots[0];

  return undefined;
}

const ABORT_SLOT_CHOICE =
  /abort|cancel|never\s*mind|don'?t book|different\s*topic|change\s*(the\s*)?(day|time|date)|another\s*day|not those|none of these|end\s*(the\s*)?chat|bye|goodbye|exit|done|no\s*thanks|nothing\s*else|that'?s\s*all|submit|contact\s*details|form|pii|ready\s*to\s*submit|already\s*been\s*booked|it'?s\s*already|already\s*booked|reschedule|look\s*up/i;

export function formatConfirmUserMessage(raw: Record<string, unknown>): string {
  if (raw.ok === true) {
    const m = String(raw.message ?? "Your booking is confirmed.");
    const code = raw.booking_code != null ? String(raw.booking_code) : "";
    if (code.length > 0 && !m.includes(code)) {
      return `${m}\n\nBooking code: ${code}`;
    }
    return m;
  }
  return String(
    raw.message ?? raw.error ?? "Could not complete the booking. Please try again."
  );
}

/** User-facing text after a real offer_slots tool result (not the LLM-only hint string). */
export function formatOfferSlotsReplyForUser(raw: Record<string, unknown>): string {
  if (raw.ok === false) {
    return String(raw.message ?? raw.error ?? "Couldn't load calendar slots.");
  }
  if (raw.waitlist === true && raw.booking_code) {
    const code = String(raw.booking_code);
    const extra = String(raw.message ?? "").trim();
    return `No openings in that window right now — you're on the waitlist. Booking code: ${code}.${extra ? ` ${extra}` : ""}`;
  }
  const slots = raw.slots;
  if (Array.isArray(slots) && slots.length > 0) {
    const lines = slots.map((s: unknown, i: number) => {
      const o = s as Record<string, unknown>;
      return `${i + 1}. ${String(o.display ?? o.key ?? "")}`;
    });
    return `Here are two free slots that day (IST):\n${lines.join("\n")}\n\nIf one of these works, say which. If you wanted a different time on that day, say the time — we can book it if the calendar is free (not limited to only these two).`;
  }
  return String(raw.message ?? "No slots returned.");
}

/**
 * When slots are already offered, detect a concrete choice in the user message
 * and confirm without calling the LLM (avoids offer_slots / confirm loops).
 */
export async function tryConfirmOfferedSlotIfResolved(
  session: SessionState,
  userText: string
): Promise<string | null> {
  const offered = session.offeredSlots;
  if (!offered || offered.length === 0) return null;
  if (ABORT_SLOT_CHOICE.test(userText)) return null;

  const cleaned = normalizeUserSlotChoice(userText.trim());
  const slot =
    resolveOfferedSlot(offered, "", cleaned) ??
    resolveOfferedSlot(offered, cleaned, cleaned);

  if (!slot) return null;

  const raw = await handleConfirmBooking(
    {
      topic: String(session.bookingTopic ?? ""),
      selected_slot_key: slot.key,
      selected_slot_display: slot.display,
    },
    session
  );

  return formatConfirmUserMessage(raw);
}

/**
 * Book a time on the same calendar day as the last offered slots when the user names a time
 * that is not one of the two samples (e.g.1:00 PM while offers were 12:00 / 12:30).
 * Runs after tryConfirmOfferedSlotIfResolved so the LLM is not required for this path.
 */
export async function tryConfirmCustomTimeOnOfferedDay(
  session: SessionState,
  userText: string
): Promise<string | null> {
  const offered = session.offeredSlots;
  if (!offered?.length || session.lastBookingCode) return null;
  if (ABORT_SLOT_CHOICE.test(userText)) return null;

  const cleaned = normalizeUserSlotChoice(userText.trim());
  const wc = parseWallClockFromUserText(
    `${cleaned} ${userText}`,
    offered
  );
  if (!wc) return null;

  const sameClock = offered.filter((x) => {
    const dt = DateTime.fromISO(x.startIso, { setZone: true }).setZone(
      getAdvisorTz()
    );
    return dt.hour === wc.hour && dt.minute === wc.minute;
  });
  if (sameClock.length === 1) {
    const slot = sameClock[0];
    const raw = await handleConfirmBooking(
      {
        topic: String(session.bookingTopic ?? ""),
        selected_slot_key: slot.key,
        selected_slot_display: slot.display,
      },
      session
    );
    return formatConfirmUserMessage(raw);
  }
  if (sameClock.length > 1) return null;

  const anchor = DateTime.fromISO(offered[0].startIso, { setZone: true }).setZone(
    getAdvisorTz()
  );
  if (!anchor.isValid) return null;

  const localDay = anchor.startOf("day");
  const start = localDay.set({
    hour: wc.hour,
    minute: wc.minute,
    second: 0,
    millisecond: 0,
  });
  const end = start.plus({ minutes: slotDurationMinutes() });

  const raw = await handleConfirmBooking(
    {
      topic: String(session.bookingTopic ?? ""),
      selected_slot_display: `${start.toFormat("ccc d LLL yyyy")}, ${start.toFormat("h:mm a")} IST`,
      start_iso: start.toUTC().toISO()!,
      end_iso: end.toUTC().toISO()!,
    },
    session
  );
  return formatConfirmUserMessage(raw);
}

/**
 * Plain-language hint for the model to relay when scheduling fails (no secrets).
 */
function schedulingErrorUserMessage(errorText: string): string {
  const e = errorText.toLowerCase();
  if (e.includes("mcp advisor server not found") || e.includes("enoent")) {
    return "The scheduling helper could not start. Run the app from the repository root (so phase-2-scheduling-core/mcp/advisor-mcp-server.ts exists), or set MCP_ADVISOR_SERVER_ENTRY to that file.";
  }
  if (
    e.includes("403") ||
    e.includes("forbidden") ||
    e.includes("insufficient authentication") ||
    e.includes("access not configured")
  ) {
    return "Google Calendar access was denied. In Google Calendar, share the advisor calendar with the service account email from GOOGLE_SERVICE_ACCOUNT_JSON (permission to see events / free-busy), and confirm GOOGLE_CALENDAR_ID is correct.";
  }
  if (e.includes("404") && e.includes("calendar")) {
    return "That calendar was not found. Check GOOGLE_CALENDAR_ID.";
  }
  if (e.includes("429") || e.includes("rate limit") || e.includes("quota")) {
    return "Google Calendar is rate-limiting requests. Wait about a minute and try again.";
  }
  if (
    e.includes("invalid_grant") ||
    e.includes("unauthorized client") ||
    (e.includes("401") && e.includes("google"))
  ) {
    return "Google sign-in for the service account failed. Verify GOOGLE_SERVICE_ACCOUNT_JSON and that Calendar API is enabled for the GCP project.";
  }
  if (e.includes("scheduling_not_configured")) {
    return "Scheduling env is incomplete: set GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_CALENDAR_ID, and GOOGLE_SHEETS_SPREADSHEET_ID.";
  }
  if (
    e.includes("unexpected end of json") ||
    e.includes("google_service_account_json parse failed") ||
    (e.includes("json parse failed") && e.includes("service_account"))
  ) {
    return "The service account JSON in GOOGLE_SERVICE_ACCOUNT_JSON could not be read. Minify the key file to a single line in .env, or store base64 of the full JSON (see .env.example). Multiline JSON in .env often truncates when passed to the scheduling subprocess.";
  }
  if (process.env.NODE_ENV !== "production") {
    return `Calendar check failed (dev detail: ${errorText.slice(0, 280)}). Say this briefly to the user and suggest retrying.`;
  }
  return "The calendar could not be checked. Please try again in a minute.";
}

export async function handleOfferSlots(
  args: Record<string, unknown>,
  session: SessionState
): Promise<Record<string, unknown>> {
  // When offer_slots is called for a new booking, clear the previous booking guard
  if (session.lastBookingCode) {
    session.lastBookingCode = null;
    session.lastSecureLinkToken = null;
    session.lastSlotDisplay = null;
  }

  const topic = String(args.topic ?? "");
  const day = String(args.day ?? "tomorrow");
  const time_preference = String(args.time_preference ?? "any");

  if (!schedulingMcpServerAvailable() || !schedulingCredentialsPresent()) {
    return {
      ok: false,
      error: "mcp_or_env_missing",
      message:
        "Scheduling MCP server or Google credentials are not available. Ensure advisor-mcp-server.ts is reachable, GOOGLE_* env vars are set, and the MCP process can start (npx tsx).",
    };
  }

  try {
    const raw = await callAdvisorMcpTool("offer_slots", {
      topic,
      day,
      time_preference,
    });
    session.bookingTopic = topic;

    if (raw.waitlist === true || (raw.ok === true && Array.isArray(raw.slots) && raw.slots.length === 0)) {
      session.offeredSlots = undefined;
      if (raw.booking_code) session.lastBookingCode = String(raw.booking_code);
      if (raw.secure_link_token) session.lastSecureLinkToken = String(raw.secure_link_token);
      if (typeof raw.slot_display === "string" && raw.slot_display.trim()) {
        session.lastSlotDisplay = raw.slot_display.trim();
      }
      return redactSecureLinkTokenForLlm(raw);
    }

    if (raw.ok === true) {
      const slots = slotsFromMcp(raw.slots);
      if (slots?.length) {
        session.offeredSlots = slots;
        const slotChoices = slots.map((x, i) => ({
          list_number: i + 1,
          key: x.key,
          display: x.display,
        }));
        return {
          ...raw,
          slot_choices_for_confirm: slotChoices,
          message:
            "List BOTH slot lines (IST). If they choose one of these, call confirm_booking with selected_slot_key/display from slot_choices_for_confirm. If they ask for a different time on the same day that was NOT one of the two (e.g. a specific hour), call confirm_booking with start_iso and end_iso for that window (duration = typical slot length, e.g. 30 min) — do not force them to pick only from the two. If they say 'second' or '5:30 PM' matching an offer, use selected_slot_key/display as before.",
        };
      }
    }

    const err = String(raw.error ?? raw.message ?? "unknown_scheduling_error");
    const hint =
      typeof raw.message === "string" && raw.message.length > 0 && raw.ok === false
        ? String(raw.message)
        : schedulingErrorUserMessage(err);
    console.error("[offer_slots]", err);
    return {
      ok: false,
      error: err,
      message: `${hint} Do not invent specific times; they can try another day or time window after this is fixed.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[offer_slots mcp]", msg, e);
    return {
      ok: false,
      error: msg,
      message: `${schedulingErrorUserMessage(msg)} Do not invent slot times.`,
    };
  }
}

export async function handleConfirmBooking(
  args: Record<string, unknown>,
  session: SessionState
): Promise<Record<string, unknown>> {
  if (session.lastBookingCode) {
    return {
      ok: false,
      error: "already_booked",
      message: `A booking (${session.lastBookingCode}) is already confirmed in this session. Tell the user their booking code and that the contact details form is on the page. If they want another booking, they should say so explicitly. Do not create a second booking.`,
    };
  }

  const topic = String(args.topic ?? session.bookingTopic ?? "");
  const selected_slot_key = String(args.selected_slot_key ?? "");
  const selected_slot_display = String(args.selected_slot_display ?? "");
  const start_iso = String(args.start_iso ?? "").trim();
  const end_iso = String(args.end_iso ?? "").trim();

  if (!schedulingMcpServerAvailable() || !schedulingCredentialsPresent()) {
    return {
      ok: false,
      error: "mcp_or_env_missing",
      message: "Scheduling MCP is not available.",
    };
  }

  const linkHint =
    " A contact-details form is available on this page whenever the user is ready — do not collect email, phone, or account numbers in this conversation. Ask if they need anything else.";

  const runConfirm = async (payload: {
    slot_display: string;
    startIso: string;
    endIso: string;
  }) => {
    const raw = await callAdvisorMcpTool("confirm_booking", {
      topic,
      slot_display: payload.slot_display,
      startIso: payload.startIso,
      endIso: payload.endIso,
    });

    if (raw.ok === true && raw.booking_code) {
      session.lastBookingCode = String(raw.booking_code);
      session.lastSlotDisplay = String(
        raw.slot_display ?? payload.slot_display
      );
      session.offeredSlots = undefined;
    }
    if (raw.ok === true && raw.secure_link_token) {
      session.lastSecureLinkToken = String(raw.secure_link_token);
    }

    if (raw.ok === true) {
      const safe = redactSecureLinkTokenForLlm(raw);
      return {
        ...safe,
        message: `${String(safe.message ?? "Booking confirmed.")}${linkHint}`,
      };
    }
    return redactSecureLinkTokenForLlm(raw);
  };

  let startEff = start_iso;
  let endEff = end_iso;
  if (startEff && !endEff) {
    const s = DateTime.fromISO(startEff, { setZone: true });
    if (s.isValid) {
      endEff = s.plus({ minutes: slotDurationMinutes() }).toUTC().toISO()!;
    }
  }

  if (startEff && endEff) {
    const tz = getAdvisorTz();
    const slotDisp =
      selected_slot_display ||
      DateTime.fromISO(startEff, { setZone: true })
        .setZone(tz)
        .toFormat("ccc d LLL yyyy, h:mm a") + " IST";
    try {
      return await runConfirm({
        slot_display: slotDisp,
        startIso: startEff,
        endIso: endEff,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[confirm_booking mcp]", msg);
      return { ok: false, error: msg };
    }
  }

  const offered = session.offeredSlots ?? [];
  const slot = resolveOfferedSlot(
    offered,
    selected_slot_key,
    selected_slot_display
  );
  if (!slot) {
    const compact =
      offered.length > 0
        ? offered.map((x, i) => `${i + 1}. ${x.display}`).join("; ")
        : "";
    const hint =
      offered.length > 0
        ? `No match for that time. Offered: ${compact}. For another time the same day, call confirm_booking with start_iso, end_iso (UTC, ${slotDurationMinutes()} min), and selected_slot_display.`
        : "No slots in session. Call offer_slots first, or confirm_booking with start_iso and end_iso.";
    return {
      ok: false,
      error: "invalid_slot",
      message: hint,
    };
  }

  try {
    return await runConfirm({
      slot_display: selected_slot_display || slot.display,
      startIso: slot.startIso,
      endIso: slot.endIso,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[confirm_booking mcp]", msg);
    return { ok: false, error: msg };
  }
}

export async function handleCancelBooking(
  args: Record<string, unknown>,
  session: SessionState
): Promise<Record<string, unknown>> {
  const booking_code = String(args.booking_code ?? "").trim();
  if (!booking_code) {
    return { ok: false, error: "missing_code", message: "Ask the user for their booking code." };
  }
  if (!schedulingMcpServerAvailable() || !schedulingCredentialsPresent()) {
    return { ok: false, error: "mcp_or_env_missing", message: "Scheduling MCP is not available." };
  }
  try {
    const raw = await callAdvisorMcpTool("cancel_booking", { booking_code });
    if (raw.ok === true) {
      session.lastBookingCode = null;
      session.lastSecureLinkToken = null;
      session.lastSlotDisplay = null;
      session.offeredSlots = undefined;
    }
    return raw;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function handleRescheduleBooking(
  args: Record<string, unknown>,
  session: SessionState
): Promise<Record<string, unknown>> {
  const booking_code = String(args.booking_code ?? "").trim();
  const new_start_iso = String(args.new_start_iso ?? "").trim();
  const new_end_iso = String(args.new_end_iso ?? "").trim();
  const new_slot_display = String(args.new_slot_display ?? "").trim();

  if (!booking_code) {
    return { ok: false, error: "missing_code", message: "Ask the user for their booking code." };
  }
  if (!new_start_iso || !new_end_iso) {
    return {
      ok: false,
      error: "missing_slot",
      message: "Call offer_slots first to find a new time, then call reschedule_booking with the new slot details.",
    };
  }
  if (!schedulingMcpServerAvailable() || !schedulingCredentialsPresent()) {
    return { ok: false, error: "mcp_or_env_missing", message: "Scheduling MCP is not available." };
  }
  try {
    const raw = await callAdvisorMcpTool("reschedule_booking", {
      booking_code,
      new_startIso: new_start_iso,
      new_endIso: new_end_iso,
      new_slot_display: new_slot_display || new_start_iso,
    });
    if (raw.ok === true) {
      session.lastSlotDisplay = new_slot_display || null;
    }
    return raw;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function handleLookupBooking(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const booking_code = String(args.booking_code ?? "").trim();
  if (!booking_code) {
    return { ok: false, error: "missing_code", message: "Ask for the booking code." };
  }
  if (!schedulingMcpServerAvailable() || !schedulingCredentialsPresent()) {
    return { ok: false, error: "mcp_or_env_missing", message: "Scheduling MCP is not available." };
  }
  try {
    return await callAdvisorMcpTool("lookup_booking", { booking_code });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  session: SessionState
): Promise<Record<string, unknown>> {
  switch (name) {
    case "detect_intent":
      return handleDetectIntent(args);
    case "offer_slots":
      return handleOfferSlots(args, session);
    case "confirm_booking":
      return handleConfirmBooking(args, session);
    case "cancel_booking":
      return handleCancelBooking(args, session);
    case "reschedule_booking":
      return handleRescheduleBooking(args, session);
    case "lookup_booking":
      return handleLookupBooking(args);
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}
