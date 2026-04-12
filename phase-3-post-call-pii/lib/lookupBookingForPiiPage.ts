import { loadRepoRootEnv } from "@/lib/env/loadRepoRootEnv";
import { callAdvisorMcpTool } from "@/lib/mcp/schedulingMcpClient";

export type PiiBookingLookupResult =
  | { ok: true; topic: string; slot_display: string; pii_submitted: boolean }
  | { ok: false; error: string };

/**
 * Server-only: validates secure link for `/booking/[code]` (MCP-only; no Sheets in Next).
 */
export async function lookupBookingForPiiPage(
  bookingCode: string,
  secureLinkToken: string
): Promise<PiiBookingLookupResult> {
  loadRepoRootEnv();
  try {
    const raw = await callAdvisorMcpTool("lookup_pii_booking", {
      booking_code: bookingCode.trim(),
      secure_link_token: secureLinkToken.trim(),
    });
    if (raw.ok === true) {
      return {
        ok: true,
        topic: String(raw.topic ?? ""),
        slot_display: String(raw.slot_display ?? ""),
        pii_submitted: raw.pii_submitted === true,
      };
    }
    return { ok: false, error: String(raw.error ?? "unknown") };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
