import OpenAI from "openai";
import { loadRepoRootEnv } from "@/lib/env/loadRepoRootEnv";
import { offlineAssistantReply } from "./offlinePhase1";
import { groqAgentTools } from "./llmTools";
import { SYSTEM_INSTRUCTION } from "./prompts";
import type { SessionState } from "./state";
import {
  executeToolCall,
  formatConfirmUserMessage,
  formatOfferSlotsReplyForUser,
} from "./toolHandlers";

function getGroqClient() {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error("GROQ_API_KEY is not set");
  return new OpenAI({
    apiKey: key,
    baseURL: "https://api.groq.com/openai/v1",
  });
}

function getTimeoutMs() {
  const parsed = Number(process.env.LLM_TIMEOUT_MS || 30000);
  const n = Number.isFinite(parsed) ? parsed : 30000;
  return Math.min(Math.max(n, 5000), 120000);
}

function getModelName() {
  return process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile";
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("LLM_TIMEOUT")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function getLlm429MaxRetries(): number {
  const n = Number(process.env.LLM_MAX_RETRIES ?? "3");
  if (!Number.isFinite(n)) return 3;
  return Math.min(Math.max(0, Math.floor(n)), 8);
}

function isLikelyRateLimit(e: unknown): boolean {
  const s = llmErrorText(e).toLowerCase();
  return (
    s.includes("429") ||
    s.includes("too many requests") ||
    s.includes("rate limit") ||
    s.includes("quota")
  );
}

function waitMsAfter429(e: unknown, attemptIndex: number): number {
  return Math.min(90_000, 5_000 * 2 ** attemptIndex);
}

async function chatCompletionWith429Retries(
  client: OpenAI,
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  timeoutMs: number
): Promise<OpenAI.Chat.ChatCompletion> {
  const maxRetries = getLlm429MaxRetries();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(client.chat.completions.create(params), timeoutMs);
    } catch (e) {
      lastErr = e;
      if (!isLikelyRateLimit(e) || attempt >= maxRetries) {
        throw e;
      }
      const wait = waitMsAfter429(e, attempt);
      console.warn(
        `[llm] Groq rate limit (429), retry ${attempt + 1}/${maxRetries} after ${wait}ms`
      );
      await sleep(wait);
    }
  }
  throw lastErr;
}

function llmErrorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    try {
      return JSON.stringify(e);
    } catch {
      /* fall through */
    }
  }
  return String(e);
}

function isGroqToolUseFailed(e: unknown): boolean {
  const t = llmErrorText(e);
  return (
    t.includes("tool_use_failed") ||
    t.includes("tool call validation failed")
  );
}

function userFacingLlmFailure(e: unknown): string {
  if (e instanceof Error && e.message === "LLM_TIMEOUT") {
    return "The assistant took too long to respond. Please try again — you can raise LLM_TIMEOUT_MS in .env if this keeps happening.";
  }
  const m = llmErrorText(e).toLowerCase();
  if (
    m.includes("fetch failed") ||
    m.includes("econnrefused") ||
    m.includes("enotfound") ||
    m.includes("network") ||
    m.includes("socket")
  ) {
    return "Can't reach Groq from this machine (network). Check your connection, proxy, or firewall, then try again.";
  }
  if (
    m.includes("401") ||
    m.includes("403") ||
    m.includes("invalid api key") ||
    m.includes("incorrect api key")
  ) {
    return "The AI request was rejected (invalid or missing API key). Set a valid GROQ_API_KEY from https://console.groq.com/keys in the repo root .env and restart npm run dev.";
  }
  if (m.includes("model") && (m.includes("not found") || m.includes("does not exist"))) {
    return "The configured Groq model id was not found. Set GROQ_MODEL in .env (see .env.example and Groq docs), then restart.";
  }
  if (
    m.includes("429") ||
    m.includes("quota") ||
    m.includes("rate limit")
  ) {
    return "Groq rate-limited this request. Wait a short time and try again, or switch to a lighter GROQ_MODEL.";
  }
  if (m.includes("tool_use_failed") || m.includes("tool call validation failed")) {
    return "The assistant hit a temporary formatting issue with the AI provider. Please send your message again. If it repeats, try another GROQ_MODEL in .env (e.g. llama-3.1-8b-instant).";
  }
  return "I'm having trouble reaching the assistant right now. Please try again in a moment.";
}

function historyToMessages(
  history: { role: "user" | "model"; text: string }[]
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return history.map((h) => ({
    role: h.role === "user" ? ("user" as const) : ("assistant" as const),
    content: h.text,
  }));
}

/** Models sometimes emit fake `<function=name>{json}</function>` in content; that does not invoke tools. Strip for display. */
function stripLeakedFunctionMarkup(text: string): string {
  return text
    .replace(/<function=offer_slots>\s*\{[\s\S]*?\}\s*<\/function>/gi, "")
    .replace(/<function=offer_slots=\{[\s\S]*?\}\s*><\/function>/gi, "")
    .replace(/<function=confirm_booking>\s*\{[\s\S]*?\}\s*<\/function>/gi, "")
    .replace(/<function=confirm_booking=\{[\s\S]*?\}\s*><\/function>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function tryParseLeakedToolJson(
  content: string,
  name: "offer_slots" | "confirm_booking"
): Record<string, unknown> | null {
  const patterns = [
    new RegExp(`<function=${name}>\\s*(\\{[\\s\\S]*?\\})\\s*</function>`, "i"),
    new RegExp(`<function=${name}=(\\{[\\s\\S]*?\\})\\s*></function>`, "i"),
  ];
  for (const re of patterns) {
    const m = content.match(re);
    if (m?.[1]) {
      try {
        return JSON.parse(m[1]) as Record<string, unknown>;
      } catch {
        /* try next pattern */
      }
    }
  }
  return null;
}

/**
 * Runs one user turn: may include multiple internal round-trips for tool calls.
 */
export async function generateAssistantReply(
  session: SessionState,
  history: { role: "user" | "model"; text: string }[],
  userText: string
): Promise<string> {
  loadRepoRootEnv();
  if (!process.env.GROQ_API_KEY?.trim()) {
    return offlineAssistantReply(session, history, userText);
  }

  try {
    const client = getGroqClient();
    const model = getModelName();
    const timeoutMs = getTimeoutMs();

    const thread: OpenAI.Chat.ChatCompletionMessageParam[] = [
      ...historyToMessages(history),
      { role: "user", content: userText },
    ];

    const maxIters = 8;
    let didGroqToolSyntaxRetry = false;

    const TOOL_SYNTAX_RETRY_SUFFIX =
      "\n\n[System — retry after provider error] Your previous assistant completion was rejected: you must not put tool calls, XML, <function=...>, or JSON tools inside the visible message text. Write only normal user-facing sentences. Use offer_slots / confirm_booking only through the API tool channel, not in the text body.";

    for (let i = 0; i < maxIters; i++) {
      const baseMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: SYSTEM_INSTRUCTION },
        ...thread,
      ];

      let completion: OpenAI.Chat.ChatCompletion;
      try {
        completion = await chatCompletionWith429Retries(
          client,
          {
            model,
            messages: baseMessages,
            tools: groqAgentTools,
            tool_choice: "auto",
            parallel_tool_calls: false,
          },
          timeoutMs
        );
      } catch (e) {
        if (isGroqToolUseFailed(e) && !didGroqToolSyntaxRetry) {
          didGroqToolSyntaxRetry = true;
          completion = await chatCompletionWith429Retries(
            client,
            {
              model,
              messages: [
                {
                  role: "system",
                  content: SYSTEM_INSTRUCTION + TOOL_SYNTAX_RETRY_SUFFIX,
                },
                ...thread,
              ],
              tools: groqAgentTools,
              tool_choice: "auto",
              parallel_tool_calls: false,
            },
            timeoutMs
          );
        } else {
          throw e;
        }
      }

      const choice = completion.choices[0];
      const msg = choice?.message;
      if (!msg) {
        return "I couldn't generate a reply. Please try again.";
      }

      if (choice.finish_reason === "content_filter") {
        return "I'm not able to respond to that. I can help you book or reschedule an advisor consultation — what would you like to do?";
      }

      const toolCalls = msg.tool_calls;
      if (toolCalls?.length) {
        thread.push({
          role: "assistant",
          content: msg.content ?? null,
          tool_calls: toolCalls,
        });

        for (const tc of toolCalls) {
          if (tc.type !== "function") continue;
          const name = tc.function.name;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments || "{}") as Record<
              string,
              unknown
            >;
          } catch {
            args = {};
          }
          const toolResult = await executeToolCall(name, args, session);
          thread.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(toolResult),
          });
        }
        continue;
      }

      const contentFull = msg.content ?? "";

      // Groq/Llama may put `<function=offer_slots>{...}</function>` in prose instead of native tool_calls — execute here.
      const leakedConfirm = tryParseLeakedToolJson(contentFull, "confirm_booking");
      if (leakedConfirm && session.offeredSlots?.length) {
        console.warn("[llm] Repaired leaked confirm_booking markup in model text");
        const toolResult = await executeToolCall(
          "confirm_booking",
          leakedConfirm,
          session
        );
        const cleaned = stripLeakedFunctionMarkup(contentFull);
        const confirmPart = formatConfirmUserMessage(toolResult);
        const parts = [cleaned, confirmPart].filter((x) => x.length > 0);
        return parts.join("\n\n") || confirmPart;
      }

      const leakedOffer = tryParseLeakedToolJson(contentFull, "offer_slots");
      if (leakedOffer) {
        console.warn("[llm] Repaired leaked offer_slots markup in model text");
        const toolResult = await executeToolCall(
          "offer_slots",
          leakedOffer,
          session
        );
        const cleaned = stripLeakedFunctionMarkup(contentFull);
        const offerPart = formatOfferSlotsReplyForUser(toolResult);
        const parts = [cleaned, offerPart].filter((x) => x.length > 0);
        return parts.join("\n\n") || offerPart;
      }

      const text = stripLeakedFunctionMarkup(contentFull).trim();
      return (
        text ||
        "I'm here to help you book an advisor consultation. What would you like to do?"
      );
    }

    return "I'm having trouble completing that request. Could you rephrase what you'd like to do?";
  } catch (e) {
    const detail = llmErrorText(e);
    console.error("[llm]", detail, e);
    return userFacingLlmFailure(e);
  }
}
