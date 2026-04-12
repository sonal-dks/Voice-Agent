import { GoogleGenerativeAI, type Content } from "@google/generative-ai";
import { loadRepoRootEnv } from "@/lib/env/loadRepoRootEnv";
import { offlineAssistantReply } from "./offlinePhase1";
import { SYSTEM_INSTRUCTION } from "./prompts";
import { functionDeclarations } from "./geminiTools";
import type { SessionState } from "./state";
import { executeToolCall } from "./toolHandlers";

function getGenAI() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenerativeAI(key);
}

/** Gemini + function calling often needs 15–60s; sub-10s values almost always time out in dev. */
function getTimeoutMs() {
  const parsed = Number(process.env.LLM_TIMEOUT_MS || 30000);
  const n = Number.isFinite(parsed) ? parsed : 30000;
  return Math.min(Math.max(n, 15000), 120000);
}

function getModelName() {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
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

/** Retries after 429 / quota — uses LLM_MAX_RETRIES (default 3). */
function getLlm429MaxRetries(): number {
  const n = Number(process.env.LLM_MAX_RETRIES ?? "3");
  if (!Number.isFinite(n)) return 3;
  return Math.min(Math.max(0, Math.floor(n)), 8);
}

function isLikelyGeminiRateLimit(e: unknown): boolean {
  const s = llmErrorText(e).toLowerCase();
  return (
    s.includes("429") ||
    s.includes("too many requests") ||
    s.includes("resource exhausted") ||
    s.includes("quota") ||
    s.includes("ratelimit") ||
    s.includes("quotafailure")
  );
}

/** Parse retryDelay like `36s` from Google RPC error text. */
function parseRetryDelayMs(e: unknown): number | null {
  const s = llmErrorText(e);
  const m = s.match(/retryDelay['":\s]+['"]?(\d+(?:\.\d+)?)\s*s/i);
  if (m) return Math.ceil(Number(m[1]) * 1000);
  return null;
}

function waitMsAfter429(e: unknown, attemptIndex: number): number {
  const fromApi = parseRetryDelayMs(e);
  if (fromApi != null && fromApi > 0) {
    return Math.min(120_000, Math.max(5_000, fromApi + 2_000));
  }
  // backoff: 10s, 20s, 40s…
  return Math.min(90_000, 10_000 * 2 ** attemptIndex);
}

type GenModel = ReturnType<GoogleGenerativeAI["getGenerativeModel"]>;

async function generateContentWith429Retries(
  model: GenModel,
  request: { contents: Content[] },
  timeoutMs: number
): Promise<Awaited<ReturnType<GenModel["generateContent"]>>> {
  const maxRetries = getLlm429MaxRetries();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(model.generateContent(request), timeoutMs);
    } catch (e) {
      lastErr = e;
      if (!isLikelyGeminiRateLimit(e) || attempt >= maxRetries) {
        throw e;
      }
      const wait = waitMsAfter429(e, attempt);
      console.warn(
        `[llm] Gemini rate limit (429), retry ${attempt + 1}/${maxRetries} after ${wait}ms`
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

/** Safer user copy — no secrets; hints at common .env / model fixes. */
function userFacingLlmFailure(e: unknown): string {
  if (e instanceof Error && e.message === "LLM_TIMEOUT") {
    return "The assistant took too long to respond. Please try again — you can raise LLM_TIMEOUT_MS in .env (e.g. 60000) if this keeps happening.";
  }
  const m = llmErrorText(e).toLowerCase();
  if (
    m.includes("fetch failed") ||
    m.includes("econnrefused") ||
    m.includes("enotfound") ||
    m.includes("network") ||
    m.includes("socket")
  ) {
    return "Can't reach Google's AI service from this machine (network). Check your connection, proxy, or firewall, then try again.";
  }
  if (
    m.includes("401") ||
    m.includes("403") ||
    m.includes("permission denied") ||
    m.includes("api key not valid") ||
    m.includes("invalid api key")
  ) {
    return "The AI request was rejected (often an invalid or expired API key). Set a valid GEMINI_API_KEY in the repo root .env and restart npm run dev.";
  }
  if (m.includes("404") || m.includes("not found") || m.includes("is not found")) {
    return "The configured Gemini model was not found. Set GEMINI_MODEL=gemini-2.5-flash in .env (see .env.example), save, and restart the dev server.";
  }
  if (
    m.includes("429") ||
    m.includes("quota") ||
    m.includes("resource exhausted") ||
    m.includes("rate limit")
  ) {
    return "Google’s AI hit a rate limit (too many requests in a short time). Wait about one minute and try again, or reduce how often you send messages. Paid API tiers have higher limits.";
  }
  return "I'm having trouble reaching the assistant right now. Please try again in a moment.";
}

function historyToContents(
  history: { role: "user" | "model"; text: string }[]
): Content[] {
  return history.map((h) => ({
    role: h.role === "user" ? ("user" as const) : ("model" as const),
    parts: [{ text: h.text }],
  }));
}

/**
 * Runs one user turn: may include multiple internal round-trips for function calls.
 */
export async function generateAssistantReply(
  session: SessionState,
  history: { role: "user" | "model"; text: string }[],
  userText: string
): Promise<string> {
  loadRepoRootEnv();
  if (!process.env.GEMINI_API_KEY?.trim()) {
    return offlineAssistantReply(session, history, userText);
  }

  try {
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({
    model: getModelName(),
    systemInstruction: SYSTEM_INSTRUCTION,
    tools: [{ functionDeclarations }],
  });

  const contents: Content[] = [
    ...historyToContents(history),
    { role: "user", parts: [{ text: userText }] },
  ];

  const maxIters = 8;
  const timeoutMs = getTimeoutMs();

  for (let i = 0; i < maxIters; i++) {
    const result = await generateContentWith429Retries(
      model,
      { contents },
      timeoutMs
    );
    const response = result.response;
    const candidate = response.candidates?.[0];
    if (!candidate?.content) {
      return "I couldn't generate a reply. Please try again.";
    }
    const finishReason = candidate?.finishReason;
    if (finishReason === "SAFETY") {
      return "I'm not able to respond to that. I can help you book or reschedule an advisor consultation — what would you like to do?";
    }

    const parts = candidate?.content?.parts ?? [];
    const functionCalls: {
      functionCall: { name: string; args?: Record<string, unknown> };
    }[] = [];
    for (const p of parts) {
      if ("functionCall" in p && (p as { functionCall?: { name: string; args?: Record<string, unknown> } }).functionCall) {
        functionCalls.push(
          p as { functionCall: { name: string; args?: Record<string, unknown> } }
        );
      }
    }

    const textParts = parts
      .filter((p) => "text" in p && typeof (p as { text?: string }).text === "string")
      .map((p) => (p as { text: string }).text)
      .join("");

    if (functionCalls.length === 0) {
      return textParts.trim() || "I'm here to help you book an advisor consultation. What would you like to do?";
    }

    // Model issued tool calls — append model turn then function responses, then continue.
    contents.push({
      role: "model",
      parts: parts as never[],
    });

    for (const fc of functionCalls) {
      const name = fc.functionCall.name;
      const args = (fc.functionCall.args ?? {}) as Record<string, unknown>;
      const toolResult = await executeToolCall(name, args, session);
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name,
              response: toolResult,
            },
          },
        ],
      });
    }
  }

  return "I'm having trouble completing that request. Could you rephrase what you'd like to do?";
  } catch (e) {
    const detail = llmErrorText(e);
    console.error("[llm]", detail, e);
    return userFacingLlmFailure(e);
  }
}
