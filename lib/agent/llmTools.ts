import type { ChatCompletionTool } from "openai/resources/chat/completions";

/**
 * OpenAI-format tools for Groq (`baseURL: https://api.groq.com/openai/v1`).
 * @see https://console.groq.com/docs/tool-use/local-tool-calling
 */
export const groqAgentTools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "detect_intent",
      description:
        "Classify the user's intent. Call when starting a new task or when unclear.",
      parameters: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            description:
              "One of: book_new, reschedule, cancel, what_to_prepare, check_availability, unclear",
          },
          confidence: {
            type: "number",
            description: "Confidence 0 to 1",
          },
          topic: {
            type: "string",
            description:
              "If known: KYC/Onboarding, SIP/Mandates, Statements/Tax Docs, Withdrawals & Timelines, Account Changes/Nominee, or unknown",
          },
          time_preference: {
            type: "string",
            description: "User's time preference if stated",
          },
        },
        required: ["intent", "confidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "offer_slots",
      description:
        "Retrieve up to two real free slots from Google Calendar for the topic/day/time window (IST). Call after topic is known and user gave day + time preference.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string" },
          day: { type: "string" },
          time_preference: { type: "string" },
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
        "After user chooses a slot from the last offer_slots result, confirm booking: creates calendar hold + Bookings row. Pass exact selected_slot_key from the offered slot.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string" },
          selected_slot_key: { type: "string" },
          selected_slot_display: { type: "string" },
        },
        required: ["topic", "selected_slot_key", "selected_slot_display"],
      },
    },
  },
];
