import { loadRepoRootEnv } from "@/lib/env/loadRepoRootEnv";
import { DISCLAIMER_PHRASE } from "./prompts";
import { containsPii } from "./guardrails";
import {
  appendHistory,
  createSession,
  getSession,
  touchSession,
  type SessionState,
} from "./state";
import { generateAssistantReply } from "./llm";
import { tryConfirmOfferedSlotIfResolved } from "./toolHandlers";

const PII_RESPONSE = `${DISCLAIMER_PHRASE}

For your security, I can't take personal details here. You'll complete contact details in our app after booking using your booking code — not in this chat. What topic would you like to discuss with an advisor?`;

export interface MessageDTO {
  role: "user" | "assistant";
  content: string;
}

export interface ProcessResult {
  sessionId: string;
  assistant: string;
  messages: MessageDTO[];
  /** Phase 2 — last booking code from tool flow (for UI copy) */
  bookingCode?: string | null;
  /** Phase 3 — UUID for `/booking/[code]?token=` (omit from LLM tool payloads) */
  secureLinkToken?: string | null;
  /** Confirmed slot line for PII modal */
  slotDisplay?: string | null;
  /** Topic for PII modal */
  bookingTopic?: string | null;
  /** True when a new booking was just confirmed this turn (show PII button, not auto-open) */
  bookingJustConfirmed?: boolean;
}

function toDto(s: SessionState): MessageDTO[] {
  return s.history.map((h) => ({
    role: h.role === "user" ? "user" : "assistant",
    content: h.text,
  }));
}

/**
 * Client holds the visible transcript; server memory is in-process only (lost on
 * serverless cold starts). Rebuild `session.history` from the client so the LLM
 * still sees prior turns.
 */
function applyClientTranscript(
  session: SessionState,
  clientMessages: MessageDTO[],
  currentUserText: string
): void {
  if (clientMessages.length < 1) return;
  const last = clientMessages[clientMessages.length - 1];
  if (last.role !== "user" || last.content !== currentUserText) return;

  session.history = clientMessages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    text: m.content,
  }));
  session.disclaimerDelivered = session.history.some((h) =>
    h.text.includes(DISCLAIMER_PHRASE)
  );
  touchSession(session);
}

export async function processMessage(
  sessionId: string | undefined,
  text: string,
  clientMessages?: MessageDTO[]
): Promise<ProcessResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Message text is required");
  }

  loadRepoRootEnv();

  let session = sessionId ? getSession(sessionId) : undefined;
  if (!session) {
    session = createSession();
  }

  if (clientMessages && clientMessages.length > 0) {
    applyClientTranscript(session, clientMessages, trimmed);
  }

  if (containsPii(trimmed)) {
    appendHistory(session, "user", "[message withheld: possible personal information]");
    appendHistory(session, "model", PII_RESPONSE);
    session.disclaimerDelivered = true;
    return {
      sessionId: session.sessionId,
      assistant: PII_RESPONSE,
      messages: toDto(session),
      bookingCode: session.lastBookingCode ?? undefined,
      secureLinkToken: session.lastSecureLinkToken ?? undefined,
      slotDisplay: session.lastSlotDisplay ?? undefined,
      bookingTopic: session.bookingTopic ?? undefined,
    };
  }

  const codeBefore = session.lastBookingCode ?? null;
  const historyBefore = [...session.history];
  appendHistory(session, "user", trimmed);

  let assistant =
    (await tryConfirmOfferedSlotIfResolved(session, trimmed)) ??
    (await generateAssistantReply(session, historyBefore, trimmed));

  if (!session.disclaimerDelivered) {
    if (!assistant.includes(DISCLAIMER_PHRASE)) {
      assistant = `${DISCLAIMER_PHRASE}\n\n${assistant}`;
    }
    session.disclaimerDelivered = true;
  }

  appendHistory(session, "model", assistant);

  const bookingJustConfirmed =
    session.lastBookingCode != null && session.lastBookingCode !== codeBefore;

  return {
    sessionId: session.sessionId,
    assistant,
    messages: toDto(session),
    bookingCode: session.lastBookingCode ?? undefined,
    secureLinkToken: session.lastSecureLinkToken ?? undefined,
    slotDisplay: session.lastSlotDisplay ?? undefined,
    bookingTopic: session.bookingTopic ?? undefined,
    bookingJustConfirmed,
  };
}

/** Alias for Phase 5 voice — same pipeline as typed text. */
export const processTranscript = processMessage;
