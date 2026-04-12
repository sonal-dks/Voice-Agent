import { DISCLAIMER_PHRASE } from "./prompts";
import { touchSession, type SessionState } from "./state";

const TOPICS = `Here are the topic options:
• KYC/Onboarding
• SIP/Mandates
• Statements/Tax Docs
• Withdrawals & Timelines
• Account Changes/Nominee`;

function priorText(
  history: { role: "user" | "model"; text: string }[]
): string {
  return history.map((h) => h.text).join(" ");
}

/** Latest assistant turn only — full-history `prior` still contains old "Which topic…" and breaks state. */
function lastModelText(
  history: { role: "user" | "model"; text: string }[]
): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "model") return history[i].text;
  }
  return "";
}

/** Assistant already listed the five topics and asked which fits. */
function awaitingTopicChoice(lastModel: string): boolean {
  return (
    /Which topic fits best\?/i.test(lastModel) ||
    /Here are the topic options:/i.test(lastModel)
  );
}

/** Assistant already asked for day + time preference. */
function awaitingDayTime(lastModel: string): boolean {
  return /What day and time work best for you/i.test(lastModel);
}

function tryMapTopic(lower: string): string | null {
  if (/\bkyc\b|onboarding/.test(lower)) return "KYC/Onboarding";
  if (/\bsip\b|mandates?/.test(lower)) return "SIP/Mandates";
  if (/statements?|tax\s*docs?/.test(lower)) return "Statements/Tax Docs";
  if (/withdrawals?|timelines?/.test(lower)) return "Withdrawals & Timelines";
  if (/nominee|account\s*changes?/.test(lower)) return "Account Changes/Nominee";
  return null;
}

/**
 * Deterministic replies when `GEMINI_API_KEY` is not set (local dev / CI).
 * Does not replace Gemini in production — set the API key for real behavior.
 */
export function offlineAssistantReply(
  session: SessionState,
  history: { role: "user" | "model"; text: string }[],
  userText: string
): string {
  const t = userText.trim();
  const lower = t.toLowerCase();
  const prior = priorText(history);
  const lastModel = lastModelText(history);

  const needsDisclaimer = !prior.includes(
    "informational and does not constitute investment advice"
  );

  const prefix = needsDisclaimer ? `${DISCLAIMER_PHRASE}\n\n` : "";

  // --- After topic list: interpret topic or nudge (must run before generic /book/) ---
  if (awaitingTopicChoice(lastModel)) {
    const topic = tryMapTopic(lower);
    if (topic) {
      session.bookingTopic = topic;
      touchSession(session);
      return `${prefix}Got it — we'll use topic **${topic}**. What day and time work best for you (for example tomorrow afternoon)?`;
    }
    const repeatedBookOnly =
      /^(booking|book|i\s+want\s+to\s+book|i'?d\s+like\s+to\s+book)\s*\.?$/i.test(
        t.trim()
      );
    if (repeatedBookOnly) {
      return `${prefix}Please pick one of the five topics from the list (KYC/Onboarding, SIP/Mandates, Statements/Tax Docs, Withdrawals & Timelines, or Account Changes/Nominee). Which fits best?`;
    }
    return `${prefix}I didn't catch which topic you meant. Please choose one: KYC/Onboarding, SIP/Mandates, Statements/Tax Docs, Withdrawals & Timelines, or Account Changes/Nominee.`;
  }

  // --- After day/time question: slot stub or gentle reprompt ---
  if (awaitingDayTime(lastModel)) {
    if (
      /tomorrow|afternoon|morning|evening|today|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\s*(am|pm)|ist/i.test(
        lower
      )
    ) {
      return `${prefix}Thanks — I've noted your preference. With Gemini + Google Calendar configured, I would call **offer_slots** here to fetch two real IST slots. Set **GEMINI_API_KEY** and Google MCP env vars to use live scheduling.`;
    }
    return `${prefix}Could you share a day and rough time (for example "tomorrow afternoon" or "Monday morning")?`;
  }

  if (/reschedule/.test(lower)) {
    return `${prefix}I can help reschedule. What is your booking code (for example NL-A123)?`;
  }
  if (/cancel/.test(lower) && !/book/.test(lower)) {
    return `${prefix}I can help cancel. Please share your booking code.`;
  }
  if (
    /what (should|to) (i )?prepare|prepare for/.test(lower) ||
    /what to prepare/.test(lower)
  ) {
    return `${prefix}Happy to help you prepare. Which topic is your consultation about? If you share the topic, I can give a short checklist.`;
  }
  if (/available|availability|slots|this week/.test(lower) && !/book/.test(lower)) {
    return `${prefix}I can check availability once I know your preferred topic and day. What topic and which day work best for you?`;
  }
  if (/should i invest|mutual fund|fixed deposit|which fund|best sip/.test(lower)) {
    return `${prefix}I'm not able to provide investment advice. I can help you book a consultation with an advisor who can discuss your situation. Would you like to book an appointment?`;
  }
  if (/sip|mandate/.test(lower) && prior.length > 0) {
    const topic = "SIP/Mandates";
    session.bookingTopic = topic;
    touchSession(session);
    return `${prefix}Got it — we'll use topic **${topic}**. What day and time work best for you (for example tomorrow afternoon)?`;
  }
  if (
    /tomorrow|afternoon|morning|evening|today|next week/.test(lower) &&
    prior.length > 0 &&
    session.bookingTopic
  ) {
    return `${prefix}Thanks — I've noted your preference. With Gemini + Google Calendar configured, I would call **offer_slots** here to fetch two real IST slots. Set **GEMINI_API_KEY** and Google MCP env vars to use live scheduling.`;
  }
  if (/book|appointment|consultation|advisor/.test(lower)) {
    return `${prefix}I'd be glad to help you book a consultation. ${TOPICS}\n\nWhich topic fits best?`;
  }

  return `${prefix}I'm here to help with booking, rescheduling, or cancelling an advisor consultation, or to answer what to prepare. What would you like to do?`;
}
