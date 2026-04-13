import type { ChatCompletionTool } from "openai/resources/chat/completions";

/**
 * OpenAI-format tools for Groq (`baseURL: https://api.groq.com/openai/v1`).
 * Tools: offer_slots, confirm_booking, cancel_booking, reschedule_booking, lookup_booking.
 */
export const groqAgentTools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "offer_slots",
      description:
        'Retrieve up to two real free slots from Google Calendar (IST). Use time_preference "any" (or "unspecified") when the user has not said morning/afternoon/evening — that scans roughly 9:00–22:00 IST that day.',
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string" },
          day: { type: "string" },
          time_preference: {
            type: "string",
            description:
              'e.g. "any", "morning", "afternoon", "evening", "9pm", or a phrase describing the window',
          },
        },
        required: ["topic", "day", "time_preference"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_booking",
      description:
        "Confirm one booking: either (A) user picked from the last offer_slots — use selected_slot_key + selected_slot_display, or (B) user asked for a specific time — use start_iso + end_iso (ISO 8601, duration usually 30 minutes) plus selected_slot_display. Server checks free/busy before writing.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string" },
          selected_slot_key: {
            type: "string",
            description:
              "ISO start from slot_choices_for_confirm when using path A; can be empty if using start_iso/end_iso",
          },
          selected_slot_display: {
            type: "string",
            description: "Human-readable slot line (IST) shown to the user",
          },
          start_iso: {
            type: "string",
            description: "Path B only: event start ISO 8601",
          },
          end_iso: {
            type: "string",
            description: "Path B only: event end ISO 8601",
          },
        },
        required: ["topic", "selected_slot_display"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_booking",
      description:
        "Cancel an existing booking by booking code. Deletes calendar event, updates Sheets, sends cancellation email if user email is on file.",
      parameters: {
        type: "object",
        properties: {
          booking_code: {
            type: "string",
            description: "The booking code (e.g. NL-A123) to cancel",
          },
        },
        required: ["booking_code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_booking",
      description:
        "Reschedule an existing booking: provide booking_code and the new slot (start_iso + end_iso + display). Cancels old calendar event, creates new hold, updates Sheets, sends emails.",
      parameters: {
        type: "object",
        properties: {
          booking_code: {
            type: "string",
            description: "The booking code to reschedule",
          },
          new_start_iso: {
            type: "string",
            description: "New slot start ISO 8601",
          },
          new_end_iso: {
            type: "string",
            description: "New slot end ISO 8601",
          },
          new_slot_display: {
            type: "string",
            description: "Human-readable new slot (IST)",
          },
        },
        required: ["booking_code", "new_start_iso", "new_end_iso", "new_slot_display"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_booking",
      description:
        "Look up a booking by code. Returns status, topic, slot, whether PII was submitted. Use before cancel/reschedule to verify the booking exists.",
      parameters: {
        type: "object",
        properties: {
          booking_code: {
            type: "string",
            description: "The booking code to look up",
          },
        },
        required: ["booking_code"],
      },
    },
  },
];
