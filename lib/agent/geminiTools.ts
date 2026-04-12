import { SchemaType, type FunctionDeclaration } from "@google/generative-ai";

/**
 * Tool surface for Phase 1 + stubs for later phases.
 * (Avoid `enum` arrays in Schema — some SDK versions infer incompatible unions.)
 */
export const functionDeclarations: FunctionDeclaration[] = [
  {
    name: "detect_intent",
    description:
      "Classify the user's intent. Call when starting a new task or when unclear.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        intent: {
          type: SchemaType.STRING,
          description:
            "One of: book_new, reschedule, cancel, what_to_prepare, check_availability, unclear",
        },
        confidence: {
          type: SchemaType.NUMBER,
          description: "Confidence 0 to 1",
        },
        topic: {
          type: SchemaType.STRING,
          description:
            "If known: KYC/Onboarding, SIP/Mandates, Statements/Tax Docs, Withdrawals & Timelines, Account Changes/Nominee, or unknown",
        },
        time_preference: {
          type: SchemaType.STRING,
          description: "User's time preference if stated",
        },
      },
      required: ["intent", "confidence"],
    },
  },
  {
    name: "offer_slots",
    description:
      "Retrieve up to two real free slots from Google Calendar for the topic/day/time window (IST). Call after topic is known and user gave day + time preference.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        topic: { type: SchemaType.STRING },
        day: { type: SchemaType.STRING },
        time_preference: { type: SchemaType.STRING },
      },
      required: ["topic", "day", "time_preference"],
    },
  },
  {
    name: "confirm_booking",
    description:
      "After user chooses a slot from the last offer_slots result, confirm booking: creates calendar hold + Bookings row. Pass exact selected_slot_key from the offered slot.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        topic: { type: SchemaType.STRING },
        selected_slot_key: { type: SchemaType.STRING },
        selected_slot_display: { type: SchemaType.STRING },
      },
      required: ["topic", "selected_slot_key", "selected_slot_display"],
    },
  },
];
