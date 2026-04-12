/**
 * MCP stdio server — **only** place in-repo that calls Google Calendar / Sheets / Gmail REST for booking + PII submit.
 * Tools: `offer_slots`, `confirm_booking`, `lookup_pii_booking`, `submit_pii_booking`.
 * Run: `npx tsx phase-2-scheduling-core/mcp/advisor-mcp-server.ts`
 * The Next.js app must use the MCP client only (no `googleapis` in the Vercel bundle for these paths).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { schedulingEnvConfigured } from "../src/env";
import { generateUniqueBookingCode } from "../src/booking_code";
import { getAvailableSlots, createCalendarHold } from "../src/google_calendar";
import { patchCalendarEventForPiiSubmit } from "../src/google_calendar";
import {
  createPlainTextDraft,
  getConfiguredGmailSenderEmail,
  sendPlainTextEmail,
} from "../src/gmail_send";
import { encryptPiiPayload, requirePiiEncryptionKeyHex } from "../src/pii_crypto";
import {
  appendAdvisorPreBookingsLine,
  appendBookingRow,
  appendPiiSubmissionRow,
  bookingCodeExists,
  getBookingByCode,
  newSecureLinkToken,
  updateBookingRowRange,
} from "../src/google_sheets";

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
  async ({ topic, day, time_preference }) => {
    if (!schedulingEnvConfigured()) {
      return jsonResult({
        ok: false,
        error: "scheduling_not_configured",
        message: "Set GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_CALENDAR_ID, GOOGLE_SHEETS_SPREADSHEET_ID",
      });
    }
    try {
      const result = await getAvailableSlots({ topic, day, time_preference });
      if (result.waitlist || result.slots.length === 0) {
        const code = await generateUniqueBookingCode(bookingCodeExists);
        const now = new Date().toISOString();
        const token = newSecureLinkToken();
        await appendBookingRow({
          booking_code: code,
          topic,
          slot_time: "",
          slot_display:
            result.detail || `Waitlist (${day}, ${time_preference})`,
          status: "waitlisted",
          google_event_id: "",
          side_effects_completed: "false",
          secure_link_token: token,
          pii_submitted: "false",
          created_at: now,
          updated_at: now,
        });
        return jsonResult({
          ok: true,
          waitlist: true,
          booking_code: code,
          secure_link_token: token,
          slots: [],
          message: "No slots; user is waitlisted with the booking code.",
        });
      }
      return jsonResult({
        ok: true,
        waitlist: false,
        slots: result.slots.map((s) => ({
          key: s.key,
          display: s.display,
          startIso: s.startIso,
          endIso: s.endIso,
        })),
        message:
          "Present both slots (IST). When user picks, call confirm_booking with startIso/endIso from the chosen slot.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonResult({ ok: false, error: msg });
    }
  }
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
  async ({ topic, slot_display, startIso, endIso }) => {
    if (!schedulingEnvConfigured()) {
      return jsonResult({
        ok: false,
        error: "scheduling_not_configured",
      });
    }
    try {
      const code = await generateUniqueBookingCode(bookingCodeExists);
      const token = newSecureLinkToken();
      const now = new Date().toISOString();

      let google_event_id = "";
      try {
        google_event_id = await createCalendarHold({
          topic,
          bookingCode: code,
          startIso,
          endIso,
        });
      } catch (calErr) {
        console.error("[confirm_booking calendar]", calErr);
      }

      await appendBookingRow({
        booking_code: code,
        topic,
        slot_time: startIso,
        slot_display,
        status: "confirmed",
        google_event_id,
        side_effects_completed: "false",
        secure_link_token: token,
        pii_submitted: "false",
        created_at: now,
        updated_at: now,
      });

      const dateSummary = slot_display.split(",")[0]?.trim() || startIso;
      let advisor_prebookings_logged = false;
      try {
        await appendAdvisorPreBookingsLine({
          dateSummary,
          topic,
          slotDisplay: slot_display,
          booking_code: code,
        });
        advisor_prebookings_logged = true;
      } catch (lineErr) {
        console.error("[advisor pre-bookings]", lineErr);
      }

      const advisorInbox = process.env.ADVISOR_INBOX_EMAIL?.trim() ?? "";
      let advisor_gmail_draft: string | "skipped" | "failed" = "skipped";
      if (advisorInbox) {
        try {
          advisor_gmail_draft = await createPlainTextDraft({
            to: advisorInbox,
            subject: `New Advisor Consultation — ${topic} — ${code}`,
            body: [
              "A new advisor consultation has been pre-booked.",
              "",
              `Booking Code: ${code}`,
              `Topic: ${topic}`,
              `Scheduled Slot: ${slot_display}`,
              "Status: Tentative — user may complete contact details via the app link.",
              "",
              "This message was saved as a draft for review (not sent).",
            ].join("\n"),
          });
        } catch (draftErr) {
          console.error("[confirm_booking gmail draft]", draftErr);
          advisor_gmail_draft = "failed";
        }
      }

      const sideEffectsDone =
        Boolean(google_event_id) &&
        advisor_prebookings_logged &&
        (advisor_gmail_draft === "skipped" || typeof advisor_gmail_draft === "string");

      const bookingRow = await getBookingByCode(code);
      if (bookingRow) {
        const nextCells = [...bookingRow.cells];
        nextCells[6] = sideEffectsDone ? "true" : "false";
        nextCells[10] = new Date().toISOString();
        await updateBookingRowRange(bookingRow.rowIndex1Based, nextCells);
      }

      return jsonResult({
        ok: true,
        booking_code: code,
        secure_link_token: token,
        slot_display,
        google_event_id,
        advisor_prebookings_logged,
        advisor_gmail_draft,
        side_effects_completed: sideEffectsDone,
        message: sideEffectsDone
          ? `Booking ${code} confirmed: calendar hold, Bookings row, Advisor Pre-Bookings${advisorInbox ? ", Gmail draft" : ""}.`
          : `Booking ${code} recorded; some side-effects failed — check logs (calendar, pre-bookings sheet, or Gmail draft).`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonResult({ ok: false, error: msg });
    }
  }
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
  async ({ booking_code, secure_link_token }) => {
    if (!schedulingEnvConfigured()) {
      return jsonResult({
        ok: false,
        error: "scheduling_not_configured",
        message: "Set GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_CALENDAR_ID, GOOGLE_SHEETS_SPREADSHEET_ID",
      });
    }
    const code = booking_code.trim();
    const row = await getBookingByCode(code);
    if (!row) {
      return jsonResult({
        ok: false,
        error: "booking_not_found",
        message: "Unknown booking code",
      });
    }
    const { cells } = row;
    const tokenCell = cells[7]?.trim();
    if (!tokenCell || tokenCell !== secure_link_token.trim()) {
      return jsonResult({
        ok: false,
        error: "invalid_token",
        message: "Secure link token does not match",
      });
    }
    return jsonResult({
      ok: true,
      topic: cells[1] || "",
      slot_display: cells[3] || "",
      pii_submitted: String(cells[8]).toLowerCase() === "true",
    });
  }
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
  async ({
    booking_code,
    secure_link_token,
    name,
    email,
    phone,
    account,
  }) => {
    if (!schedulingEnvConfigured()) {
      return jsonResult({
        ok: false,
        error: "scheduling_not_configured",
        message: "Set GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_CALENDAR_ID, GOOGLE_SHEETS_SPREADSHEET_ID",
      });
    }
    let key: Buffer;
    try {
      key = requirePiiEncryptionKeyHex();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonResult({ ok: false, error: "pii_encryption_misconfigured", message: msg });
    }

    const code = booking_code.trim();
    const row = await getBookingByCode(code);
    if (!row) {
      return jsonResult({
        ok: false,
        error: "booking_not_found",
        message: "Unknown booking code",
      });
    }
    const { cells, rowIndex1Based } = row;
    const tokenCell = cells[7]?.trim();
    if (!tokenCell || tokenCell !== secure_link_token.trim()) {
      return jsonResult({
        ok: false,
        error: "invalid_token",
        message: "Secure link token does not match",
      });
    }
    if (String(cells[8]).toLowerCase() === "true") {
      return jsonResult({
        ok: false,
        error: "already_submitted",
        message: "PII already recorded for this booking",
      });
    }

    const topic = cells[1] || "";
    const slotDisplay = cells[3] || "";
    const googleEventId = cells[5]?.trim();

    const payloadJson = JSON.stringify({
      name,
      email,
      phone,
      account: account ?? "",
    });
    const ciphertextB64 = encryptPiiPayload(payloadJson, key);
    const now = new Date().toISOString();

    await appendPiiSubmissionRow({
      booking_code: code,
      submitted_at_iso: now,
      ciphertext_b64: ciphertextB64,
    });

    const nextRow = [...cells];
    nextRow[8] = "true";
    nextRow[10] = now;
    await updateBookingRowRange(rowIndex1Based, nextRow);

    let calendar_patched = false;
    if (googleEventId) {
      try {
        await patchCalendarEventForPiiSubmit({
          eventId: googleEventId,
          userEmail: email,
          note: `Booking ${code}. Primary contact email added as attendee.`,
        });
        calendar_patched = true;
      } catch (e) {
        console.error("[submit_pii_booking calendar]", e);
      }
    }

    const advisorInbox = process.env.ADVISOR_INBOX_EMAIL?.trim() || "";
    const publicDetails =
      process.env.ADVISOR_PUBLIC_DETAILS?.trim() || "Your advisor team";
    const fromAddr =
      getConfiguredGmailSenderEmail() || advisorInbox || "noreply@example.com";

    let user_email_sent = false;
    let advisor_email_sent = false;
    let email_errors: string[] = [];

    try {
      await sendPlainTextEmail({
        from: fromAddr,
        to: email,
        subject: `Booking confirmed — ${code}`,
        body: `Thank you. Your details are on file.\n\nBooking code: ${code}\nTopic: ${topic}\nSlot: ${slotDisplay}\n\nAdvisor / next steps:\n${publicDetails}\n`,
      });
      user_email_sent = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      email_errors.push(`user_email: ${msg}`);
    }

    if (advisorInbox) {
      try {
        await sendPlainTextEmail({
          from: fromAddr,
          to: advisorInbox,
          subject: `PII received — ${code} (${topic})`,
          body: `Booking code: ${code}\nTopic: ${topic}\nSlot: ${slotDisplay}\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nAccount (optional): ${account ?? "(none)"}\n`,
        });
        advisor_email_sent = true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        email_errors.push(`advisor_email: ${msg}`);
      }
    }

    return jsonResult({
      ok: true,
      booking_code: code,
      calendar_patched,
      user_email_sent,
      advisor_email_sent,
      email_errors,
      message:
        user_email_sent && advisor_email_sent
          ? "PII stored; calendar updated if applicable; both emails sent."
          : "PII stored; check email_errors if Gmail delegation is not configured.",
    });
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
