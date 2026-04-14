/**
 * MCP stdio server — delegates to advisorToolRuntime (same code path as Vercel in-process).
 * Run: `npx tsx phase-2-scheduling-core/mcp/advisor-mcp-server.ts`
 */
import "../src/loadRootEnv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { schedulingEnvConfigured } from "../src/env";
import {
  advisorCancelBooking,
  advisorConfirmBooking,
  advisorLookupBooking,
  advisorLookupPiiBooking,
  advisorOfferSlots,
  advisorRescheduleBooking,
  advisorSubmitPiiBooking,
} from "./advisorToolRuntime";
import { validateSchedulingSpreadsheetTabs } from "../src/google_sheets";

function jsonResult(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

const server = new McpServer({
  name: "advisor-scheduling",
  version: "0.3.0",
});

server.registerTool(
  "offer_slots",
  {
    description:
      "Return up to two real free slots from Google Calendar (IST) or waitlist with a booking code.",
    inputSchema: {
      topic: z.string(),
      day: z.string(),
      time_preference: z.string(),
    },
  },
  async (args) => jsonResult(await advisorOfferSlots(args))
);

server.registerTool(
  "confirm_booking",
  {
    description:
      "Confirm booking: Calendar hold, Bookings row, Advisor Pre-Bookings append, advisor Gmail draft (when inbox + delegation configured).",
    inputSchema: {
      topic: z.string(),
      slot_display: z.string(),
      startIso: z.string(),
      endIso: z.string(),
    },
  },
  async (args) => jsonResult(await advisorConfirmBooking(args))
);

server.registerTool(
  "cancel_booking",
  {
    description:
      "Cancel a booking by code: delete Calendar event, update Sheets status to cancelled, send cancellation email if PII email on file.",
    inputSchema: {
      booking_code: z.string(),
    },
  },
  async (args) => jsonResult(await advisorCancelBooking(args))
);

server.registerTool(
  "reschedule_booking",
  {
    description:
      "Reschedule a booking: cancel old Calendar event, create new hold, update Sheets row, draft advisor email, send user email if PII on file.",
    inputSchema: {
      booking_code: z.string(),
      new_startIso: z.string(),
      new_endIso: z.string(),
      new_slot_display: z.string(),
    },
  },
  async (args) => jsonResult(await advisorRescheduleBooking(args))
);

server.registerTool(
  "lookup_booking",
  {
    description:
      "Look up a booking by code (no token required). Returns status, topic, slot, whether PII was submitted.",
    inputSchema: {
      booking_code: z.string(),
    },
  },
  async (args) => jsonResult(await advisorLookupBooking(args))
);

server.registerTool(
  "lookup_pii_booking",
  {
    description:
      "Read-only: validate booking code + secure_link_token for the post-call PII page (topic + slot display, pii_submitted flag).",
    inputSchema: {
      booking_code: z.string(),
      secure_link_token: z.string().uuid(),
    },
  },
  async (args) => jsonResult(await advisorLookupPiiBooking(args))
);

server.registerTool(
  "submit_pii_booking",
  {
    description:
      "Post-call PII: validate booking code + secure token, encrypt PII to PII_Submissions sheet, mark Bookings.pii_submitted, patch Calendar event with user email, send user + advisor emails when Gmail delegation is configured.",
    inputSchema: {
      booking_code: z.string(),
      secure_link_token: z.string().uuid(),
      name: z.string().min(1).max(200),
      email: z.string().email(),
      phone: z.string().min(5).max(40),
      account: z.string().max(80).optional(),
    },
  },
  async (args) => jsonResult(await advisorSubmitPiiBooking(args))
);

async function main() {
  if (schedulingEnvConfigured()) {
    try {
      const v = await validateSchedulingSpreadsheetTabs();
      if (!v.ok) {
        console.error(
          "[advisor-mcp] Missing spreadsheet tab(s):",
          JSON.stringify(v.missing)
        );
        console.error("[advisor-mcp] Existing tab titles:", JSON.stringify(v.found));
        console.error(
          "[advisor-mcp] Create tabs with these exact names (case-sensitive) or set GOOGLE_SHEETS_TAB_BOOKINGS, GOOGLE_SHEETS_TAB_ADVISOR_PREBOOKINGS, GOOGLE_SHEETS_TAB_PII in .env."
        );
        console.error(
          '[advisor-mcp] Google error "Unable to parse range: Bookings!A:A" usually means the Bookings tab does not exist in this spreadsheet.'
        );
      } else {
        console.error("[advisor-mcp] Spreadsheet tab check passed:", v.found.join(" | "));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[advisor-mcp] Could not validate spreadsheet tabs:", msg);
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
