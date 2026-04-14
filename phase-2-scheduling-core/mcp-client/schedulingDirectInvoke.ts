/**
 * In-process scheduling (no stdio MCP). Required on Vercel: child MCP processes
 * often exit immediately ("Connection closed"). Local dev can force this with
 * ADVISOR_SCHEDULING_DIRECT=1 for testing.
 */
import "../src/loadRootEnv";
import {
  advisorCancelBooking,
  advisorConfirmBooking,
  advisorLookupBooking,
  advisorLookupPiiBooking,
  advisorOfferSlots,
  advisorRescheduleBooking,
  advisorSubmitPiiBooking,
} from "../mcp/advisorToolRuntime";

export function useDirectAdvisorScheduling(): boolean {
  return (
    process.env.VERCEL === "1" ||
    process.env.ADVISOR_SCHEDULING_DIRECT === "1"
  );
}

export async function callAdvisorToolDirect(
  name:
    | "offer_slots"
    | "confirm_booking"
    | "cancel_booking"
    | "reschedule_booking"
    | "lookup_booking"
    | "submit_pii_booking"
    | "lookup_pii_booking",
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  switch (name) {
    case "offer_slots":
      return advisorOfferSlots({
        topic: String(args.topic ?? ""),
        day: String(args.day ?? ""),
        time_preference: String(args.time_preference ?? "any"),
      });
    case "confirm_booking":
      return advisorConfirmBooking({
        topic: String(args.topic ?? ""),
        slot_display: String(args.slot_display ?? args.selected_slot_display ?? ""),
        startIso: String(args.startIso ?? args.start_iso ?? ""),
        endIso: String(args.endIso ?? args.end_iso ?? ""),
      });
    case "cancel_booking":
      return advisorCancelBooking({
        booking_code: String(args.booking_code ?? ""),
      });
    case "reschedule_booking":
      return advisorRescheduleBooking({
        booking_code: String(args.booking_code ?? ""),
        new_startIso: String(args.new_startIso ?? args.new_start_iso ?? ""),
        new_endIso: String(args.new_endIso ?? args.new_end_iso ?? ""),
        new_slot_display: String(args.new_slot_display ?? ""),
      });
    case "lookup_booking":
      return advisorLookupBooking({
        booking_code: String(args.booking_code ?? ""),
      });
    case "lookup_pii_booking":
      return advisorLookupPiiBooking({
        booking_code: String(args.booking_code ?? ""),
        secure_link_token: String(args.secure_link_token ?? ""),
      });
    case "submit_pii_booking":
      return advisorSubmitPiiBooking({
        booking_code: String(args.booking_code ?? ""),
        secure_link_token: String(args.secure_link_token ?? ""),
        name: String(args.name ?? ""),
        email: String(args.email ?? ""),
        phone: String(args.phone ?? ""),
        account: args.account != null ? String(args.account) : undefined,
      });
    default:
      return { ok: false, error: `unknown_tool:${name}` };
  }
}
