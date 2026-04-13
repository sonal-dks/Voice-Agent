/**
 * MCP stdio server — **only** place in-repo that calls Google Calendar / Sheets / Gmail REST for booking + PII submit.
 * Tools: `offer_slots`, `confirm_booking`, `lookup_pii_booking`, `submit_pii_booking`.
 * Run: `npx tsx phase-2-scheduling-core/mcp/advisor-mcp-server.ts`
 * The Next.js app must use the MCP client only (no `googleapis` in the Vercel bundle for these paths).
 */
import "../src/loadRootEnv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { schedulingEnvConfigured } from "../src/env";
import { generateUniqueBookingCode } from "../src/booking_code";
import {
  createCalendarHold,
  deleteCalendarEvent,
  getAvailableSlots,
  isSlotFree,
} from "../src/google_calendar";
import { patchCalendarEventForPiiSubmit } from "../src/google_calendar";
import {
  createPlainTextDraft,
  formatGmailAuthFailure,
  getConfiguredGmailSenderEmail,
  sendPlainTextEmail,
} from "../src/gmail_send";
import { decryptPiiPayload, encryptPiiPayload, requirePiiEncryptionKeyHex } from "../src/pii_crypto";
import {
  appendAdvisorPreBookingsLine,
  appendBookingRow,
  appendPiiSubmissionRow,
  bookingCodeExists,
  getBookingByCode,
  newSecureLinkToken,
  updateBookingRowRange,
  validateSchedulingSpreadsheetTabs,
} from "../src/google_sheets";

async function getPiiEmailForBooking(bookingCode: string): Promise<string | null> {
  try {
    const key = requirePiiEncryptionKeyHex();
    const { google: g } = await import("googleapis");
    const { getOAuthClient } = await import("../src/google_auth");
    const { getPiiSubmissionsTabName } = await import("../src/env");
    const { buildA1Range } = await import("../src/sheetsA1");
    const auth = await getOAuthClient();
    const sheets = g.sheets({ version: "v4", auth });
    const ssId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
    if (!ssId) return null;
    const range = buildA1Range(getPiiSubmissionsTabName(), "A:C");
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: ssId,
      range,
    });
    const rows = res.data.values ?? [];
    for (let i = rows.length - 1; i >= 1; i--) {
      if (String(rows[i]?.[0] ?? "").trim() === bookingCode) {
        const cipher = String(rows[i]?.[2] ?? "");
        if (!cipher) return null;
        const json = decryptPiiPayload(cipher, key);
        const parsed = JSON.parse(json) as { email?: string };
        return parsed.email?.trim() || null;
      }
    }
  } catch (e) {
    console.error("[getPiiEmailForBooking]", e);
  }
  return null;
}

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
        const slot_display =
          result.detail || `Waitlist (${day}, ${time_preference})`;
        return jsonResult({
          ok: true,
          waitlist: true,
          booking_code: code,
          secure_link_token: token,
          slot_display,
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
          "Present both slots (IST). If the user already asked for a specific time (not necessarily one of these two), call confirm_booking with start_iso/end_iso from that request after checking the slot is free. Otherwise when they pick from the list, use the chosen slot's startIso/endIso.",
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
      const slotFree = await isSlotFree(startIso, endIso);
      if (!slotFree) {
        return jsonResult({
          ok: false,
          error: "slot_not_free",
          message:
            "That time overlaps another event or is unavailable. Offer different times with offer_slots or ask for another slot.",
        });
      }

      const code = await generateUniqueBookingCode(bookingCodeExists);
      const token = newSecureLinkToken();
      const now = new Date().toISOString();

      let google_event_id = "";
      let calendar_error: string | undefined;
      try {
        google_event_id = await createCalendarHold({
          topic,
          bookingCode: code,
          startIso,
          endIso,
        });
      } catch (calErr) {
        calendar_error =
          calErr instanceof Error ? calErr.message : String(calErr);
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
          console.error(
            "[confirm_booking gmail draft]",
            formatGmailAuthFailure(draftErr)
          );
          advisor_gmail_draft = "failed";
        }
      }

      const gmailOk =
        advisor_gmail_draft === "skipped" ||
        (typeof advisor_gmail_draft === "string" &&
          advisor_gmail_draft !== "failed");
      const sideEffectsDone =
        Boolean(google_event_id) && advisor_prebookings_logged && gmailOk;

      const bookingRow = await getBookingByCode(code);
      if (bookingRow) {
        const nextCells = [...bookingRow.cells];
        nextCells[6] = sideEffectsDone ? "true" : "false";
        nextCells[10] = new Date().toISOString();
        await updateBookingRowRange(bookingRow.rowIndex1Based, nextCells);
      }

      const failedParts: string[] = [];
      if (!google_event_id) failedParts.push("calendar hold");
      if (!advisor_prebookings_logged) failedParts.push("advisor pre-bookings sheet");
      if (advisorInbox && !gmailOk) failedParts.push("Gmail draft");

      const detailNote =
        failedParts.length > 0
          ? ` Could not complete: ${failedParts.join(", ")}.${
              calendar_error
                ? ` Calendar error (dev): ${calendar_error.slice(0, 200)}`
                : ""
            } Check GOOGLE_CALENDAR_ID, service-account calendar access, sheet tab names, and Gmail delegation.`
          : "";

      return jsonResult({
        ok: true,
        booking_code: code,
        secure_link_token: token,
        slot_display,
        google_event_id,
        advisor_prebookings_logged,
        advisor_gmail_draft,
        side_effects_completed: sideEffectsDone,
        calendar_error: calendar_error?.slice(0, 400),
        message: sideEffectsDone
          ? `Booking ${code} confirmed: calendar hold, Bookings row, Advisor Pre-Bookings${advisorInbox ? ", Gmail draft" : ""}.`
          : `Booking ${code} recorded in Sheets.${detailNote}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonResult({ ok: false, error: msg });
    }
  }
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
  async ({ booking_code }) => {
    if (!schedulingEnvConfigured()) {
      return jsonResult({ ok: false, error: "scheduling_not_configured" });
    }
    try {
      const code = booking_code.trim();
      const row = await getBookingByCode(code);
      if (!row) {
        return jsonResult({
          ok: false,
          error: "booking_not_found",
          message: "No booking found with that code.",
        });
      }
      const { cells, rowIndex1Based } = row;
      if (cells[4] === "cancelled") {
        return jsonResult({
          ok: false,
          error: "already_cancelled",
          message: `Booking ${code} is already cancelled.`,
        });
      }

      const googleEventId = cells[5]?.trim();
      let calendar_deleted = false;
      if (googleEventId) {
        try {
          calendar_deleted = await deleteCalendarEvent(googleEventId);
        } catch (e) {
          console.error("[cancel_booking calendar]", e);
        }
      }

      const nextCells = [...cells];
      nextCells[4] = "cancelled";
      nextCells[10] = new Date().toISOString();
      await updateBookingRowRange(rowIndex1Based, nextCells);

      const topic = cells[1] || "";
      const slotDisplay = cells[3] || "";
      const advisorInbox = process.env.ADVISOR_INBOX_EMAIL?.trim() ?? "";
      let advisor_gmail_draft: string | "skipped" | "failed" = "skipped";
      if (advisorInbox) {
        try {
          advisor_gmail_draft = await createPlainTextDraft({
            to: advisorInbox,
            subject: `Booking Cancelled — ${topic} — ${code}`,
            body: [
              `Booking ${code} has been cancelled by the user.`,
              "",
              `Booking Code: ${code}`,
              `Topic: ${topic}`,
              `Was Scheduled: ${slotDisplay}`,
              `Calendar event deleted: ${calendar_deleted ? "yes" : "no (not found or failed)"}`,
            ].join("\n"),
          });
        } catch (e) {
          console.error("[cancel_booking gmail draft]", formatGmailAuthFailure(e));
          advisor_gmail_draft = "failed";
        }
      }

      let user_email_sent = false;
      const fromAddr =
        getConfiguredGmailSenderEmail() || advisorInbox || "noreply@example.com";

      if (cells[8]?.toLowerCase() === "true") {
        try {
          const piiRow = await getPiiEmailForBooking(code);
          if (piiRow) {
            await sendPlainTextEmail({
              from: fromAddr,
              to: piiRow,
              subject: `Booking cancelled — ${code}`,
              body: `Your booking ${code} (${topic}, ${slotDisplay}) has been cancelled.\n\nIf this was a mistake, you can start a new booking at any time.`,
            });
            user_email_sent = true;
          }
        } catch (e) {
          console.error("[cancel_booking user email]", e);
        }
      }

      return jsonResult({
        ok: true,
        booking_code: code,
        status: "cancelled",
        calendar_deleted,
        advisor_gmail_draft,
        user_email_sent,
        topic,
        slot_display: slotDisplay,
        message: `Booking ${code} cancelled.${calendar_deleted ? " Calendar event removed." : ""}${user_email_sent ? " Cancellation email sent." : ""}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonResult({ ok: false, error: msg });
    }
  }
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
  async ({ booking_code, new_startIso, new_endIso, new_slot_display }) => {
    if (!schedulingEnvConfigured()) {
      return jsonResult({ ok: false, error: "scheduling_not_configured" });
    }
    try {
      const code = booking_code.trim();
      const row = await getBookingByCode(code);
      if (!row) {
        return jsonResult({
          ok: false,
          error: "booking_not_found",
          message: "No booking found with that code.",
        });
      }
      const { cells, rowIndex1Based } = row;
      if (cells[4] === "cancelled") {
        return jsonResult({
          ok: false,
          error: "booking_cancelled",
          message: `Booking ${code} is cancelled and cannot be rescheduled. Start a new booking instead.`,
        });
      }

      const slotFree = await isSlotFree(new_startIso, new_endIso);
      if (!slotFree) {
        return jsonResult({
          ok: false,
          error: "slot_not_free",
          message: "The new time slot is not free. Ask for a different time or call offer_slots.",
        });
      }

      const oldEventId = cells[5]?.trim();
      if (oldEventId) {
        try {
          await deleteCalendarEvent(oldEventId);
        } catch (e) {
          console.error("[reschedule old event delete]", e);
        }
      }

      const topic = cells[1] || "";
      let new_event_id = "";
      try {
        new_event_id = await createCalendarHold({
          topic,
          bookingCode: code,
          startIso: new_startIso,
          endIso: new_endIso,
        });
      } catch (e) {
        console.error("[reschedule new calendar hold]", e);
      }

      const nextCells = [...cells];
      nextCells[2] = new_startIso;
      nextCells[3] = new_slot_display;
      nextCells[4] = "rescheduled";
      nextCells[5] = new_event_id;
      nextCells[10] = new Date().toISOString();
      await updateBookingRowRange(rowIndex1Based, nextCells);

      const oldSlot = cells[3] || "";
      const advisorInbox = process.env.ADVISOR_INBOX_EMAIL?.trim() ?? "";
      let advisor_gmail_draft: string | "skipped" | "failed" = "skipped";
      if (advisorInbox) {
        try {
          advisor_gmail_draft = await createPlainTextDraft({
            to: advisorInbox,
            subject: `Booking Rescheduled — ${topic} — ${code}`,
            body: [
              `Booking ${code} has been rescheduled.`,
              "",
              `Topic: ${topic}`,
              `Previous Slot: ${oldSlot}`,
              `New Slot: ${new_slot_display}`,
              `New Calendar Event: ${new_event_id || "(not created)"}`,
            ].join("\n"),
          });
        } catch (e) {
          console.error("[reschedule gmail draft]", formatGmailAuthFailure(e));
          advisor_gmail_draft = "failed";
        }
      }

      let user_email_sent = false;
      const fromAddr =
        getConfiguredGmailSenderEmail() || advisorInbox || "noreply@example.com";
      if (cells[8]?.toLowerCase() === "true") {
        try {
          const piiEmail = await getPiiEmailForBooking(code);
          if (piiEmail) {
            await sendPlainTextEmail({
              from: fromAddr,
              to: piiEmail,
              subject: `Booking rescheduled — ${code}`,
              body: `Your booking ${code} (${topic}) has been rescheduled.\n\nPrevious: ${oldSlot}\nNew: ${new_slot_display}\n\nNo further action needed.`,
            });
            user_email_sent = true;
          }
        } catch (e) {
          console.error("[reschedule user email]", e);
        }
      }

      return jsonResult({
        ok: true,
        booking_code: code,
        status: "rescheduled",
        new_slot_display,
        new_event_id,
        advisor_gmail_draft,
        user_email_sent,
        message: `Booking ${code} rescheduled to ${new_slot_display}.${user_email_sent ? " Notification email sent." : ""}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonResult({ ok: false, error: msg });
    }
  }
);

server.registerTool(
  "lookup_booking",
  {
    description: "Look up a booking by code (no token required). Returns status, topic, slot, whether PII was submitted.",
    inputSchema: {
      booking_code: z.string(),
    },
  },
  async ({ booking_code }) => {
    if (!schedulingEnvConfigured()) {
      return jsonResult({ ok: false, error: "scheduling_not_configured" });
    }
    const code = booking_code.trim();
    const row = await getBookingByCode(code);
    if (!row) {
      return jsonResult({ ok: false, error: "booking_not_found", message: "No booking found." });
    }
    const { cells } = row;
    return jsonResult({
      ok: true,
      booking_code: code,
      topic: cells[1] || "",
      slot_time: cells[2] || "",
      slot_display: cells[3] || "",
      status: cells[4] || "",
      pii_submitted: cells[8]?.toLowerCase() === "true",
    });
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
      email_errors.push(`user_email: ${formatGmailAuthFailure(e)}`);
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
        email_errors.push(`advisor_email: ${formatGmailAuthFailure(e)}`);
      }
    }

    const parts: string[] = ["Your contact details were saved securely."];
    if (calendar_patched) {
      parts.push("Your calendar booking was updated with your contact information.");
    } else if (googleEventId) {
      parts.push(
        "We could not update the calendar event (e.g. permissions). Your booking and details are still stored."
      );
    }
    if (user_email_sent) parts.push("A confirmation email was sent to the address you provided.");
    if (advisor_email_sent) parts.push("The advisor team was notified by email.");
    if (email_errors.length > 0) {
      const hint = email_errors[0] ?? "unknown";
      parts.push(
        `Email could not be sent: ${hint.slice(0, 400)}${hint.length > 400 ? "…" : ""}`
      );
    }

    return jsonResult({
      ok: true,
      booking_code: code,
      calendar_patched,
      user_email_sent,
      advisor_email_sent,
      email_errors,
      message: parts.join(" "),
    });
  }
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
          "[advisor-mcp] Google error \"Unable to parse range: Bookings!A:A\" usually means the Bookings tab does not exist in this spreadsheet."
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
