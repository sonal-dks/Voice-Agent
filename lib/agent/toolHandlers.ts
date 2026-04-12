import {
  callAdvisorMcpTool,
  schedulingCredentialsPresent,
  schedulingMcpServerAvailable,
} from "@/lib/mcp/schedulingMcpClient";
import type { OfferedSlot } from "@/lib/mcp/schedulingTypes";
import type { IntentKind, SessionState } from "./state";

/** Never pass secure_link_token back to Gemini (logs / model context). */
function redactSecureLinkTokenForLlm(
  raw: Record<string, unknown>
): Record<string, unknown> {
  if (!("secure_link_token" in raw)) return raw;
  const { secure_link_token: _t, ...rest } = raw;
  return rest;
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
  const topic = String(args.topic ?? "");
  const day = String(args.day ?? "tomorrow");
  const time_preference = String(args.time_preference ?? "afternoon");

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
      return redactSecureLinkTokenForLlm(raw);
    }

    if (raw.ok === true) {
      const slots = slotsFromMcp(raw.slots);
      if (slots?.length) {
        session.offeredSlots = slots;
        return {
          ...raw,
          message:
            "List BOTH slot displays to the user (IST). Ask which they prefer. When they choose, call confirm_booking with the matching selected_slot_key and selected_slot_display.",
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
  const topic = String(args.topic ?? session.bookingTopic ?? "");
  const selected_slot_key = String(args.selected_slot_key ?? "");
  const selected_slot_display = String(args.selected_slot_display ?? "");

  if (!schedulingMcpServerAvailable() || !schedulingCredentialsPresent()) {
    return {
      ok: false,
      error: "mcp_or_env_missing",
      message: "Scheduling MCP is not available.",
    };
  }

  const slot = session.offeredSlots?.find((s) => s.key === selected_slot_key);
  if (!slot) {
    return {
      ok: false,
      error: "invalid_slot",
      message:
        "No matching offered slot. Call offer_slots again, then confirm using the tool-returned slot keys.",
    };
  }

  try {
    const raw = await callAdvisorMcpTool("confirm_booking", {
      topic,
      slot_display: selected_slot_display || slot.display,
      startIso: slot.startIso,
      endIso: slot.endIso,
    });

    if (raw.ok === true && raw.booking_code) {
      session.lastBookingCode = String(raw.booking_code);
      session.offeredSlots = undefined;
    }
    if (raw.ok === true && raw.secure_link_token) {
      session.lastSecureLinkToken = String(raw.secure_link_token);
    }

    const linkHint =
      " A secure link to enter contact details appears on this page below the chat — do not collect email, phone, or account numbers in this conversation.";

    if (raw.ok === true) {
      const safe = redactSecureLinkTokenForLlm(raw);
      return {
        ...safe,
        message: `${String(safe.message ?? "Booking confirmed.")}${linkHint}`,
      };
    }
    return redactSecureLinkTokenForLlm(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[confirm_booking mcp]", msg);
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
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}
