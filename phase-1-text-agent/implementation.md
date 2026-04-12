# Phase 1 — Implementation

> **Scope:** Conversation Engine + **Groq LLM** + guardrails + dialog state. **Production target:** Next.js Route Handlers on **Vercel** (not Docker/ECS). The Python layout below is illustrative; prefer `lib/agent/*.ts` as in [Docs/low-level-architecture.md](../Docs/low-level-architecture.md). **Environment:** copy [`.env.example`](../.env.example) to **repository root** `.env` only — `next.config.mjs` loads that file.

**This repo:** from the **repo root**: `npm install`, `npm run dev`, open `/agent`. Set **`GROQ_API_KEY`** (and optional **`GROQ_MODEL`**) in **root** `.env` for live Groq. If the key is absent, the server uses a small **offline** reply helper so local smoke tests still run (`npm run test:phase1` with the dev server up). Use **`npm run build`** before deploy.

## Downstream data & email (read this — owned by later phases, but fixed contract)

These rules are **not** implemented entirely in Phase 2, but the **Conversation Engine prompts and tools** must stay consistent with them:

| Concern | Where it lives | Behavior |
|--------|----------------|----------|
| **Booking + PII storage** | **Google Sheets** — workbook id **`GOOGLE_SHEETS_SPREADSHEET_ID`**; tabs e.g. **`Bookings`**, **`PII_Submissions`**; rows linked by **`booking_code`** | See low-level **§ System of record: Google Sheets** |
| **Gmail during agent session** | **Drafts only** to **`ADVISOR_INBOX_EMAIL`** | No `messages.send` until user submits the post-call form |
| **After PII form Submit** | Same request | (1) Append **PII** row; (2) **Patch Google Calendar** event — add **user email** as **attendee** + details in description; (3) **Send user** email (booking + static **`ADVISOR_PUBLIC_DETAILS`**); (4) **Send advisor** at **`ADVISOR_INBOX_EMAIL`** (booking + user fields) |

Phase 2 code does **not** call Sheets or Calendar yet unless you are integrating early; Phase 3+ wires **`lib/services/google_sheets.ts`** and **`google_calendar.ts`**.

---

## Backend

### New Files

```
lib/agent/   (preferred — Next.js)
├── engine.ts           # Conversation Engine — main orchestrator
├── llm.ts              # Groq via OpenAI SDK (chat completions + tool_calls)
├── llmTools.ts         # OpenAI-format tool definitions
├── prompts.ts          # System prompt, function definitions
├── state.ts            # Per-session dialog state
└── guardrails.ts       # PII detection, advice refusal pre-check

# Illustrative Python (optional / experiments):
src/agent/
├── __init__.py
├── engine.py
├── llm.py
├── prompts.py
├── state.py
└── guardrails.py
```

### Environment Variables (new in this phase)

| Variable | Description | Example |
|----------|-------------|---------|
| `GROQ_API_KEY` | Groq API key | *(from [Groq Console](https://console.groq.com/keys))* |
| `GROQ_MODEL` | Model id | e.g. `llama-3.3-70b-versatile` (see [Groq models](https://console.groq.com/docs/models)) |
| `LLM_TIMEOUT_MS` | Max wait for LLM response (ms) | `60000` |
| `LLM_MAX_RETRIES` | Retries after HTTP 429 | `3` |

Sheets/Calendar/Gmail env vars are introduced in **Phase 3–5** — see [low-level environment registry](../Docs/low-level-architecture.md#complete-environment-variable-registry).

### System Prompt (`lib/agent/prompts.ts` or `src/agent/prompts.py`)

Keep the **disclaimer**, **no PII in session**, **no investment advice**, **IST**, and **intents** as in the shared template in [low-level-architecture.md §1.2](../Docs/low-level-architecture.md). Do not ask for email/phone in chat; post-call form collects them after **`booking_code`** is issued.

### Dialog State Manager (`lib/agent/state.ts`)

Track `DialogPhase`, `topic`, `booking_code` (once Phase 3 confirms), `messages[]`, `disclaimer_delivered`, etc. State is **in-memory per `sessionId`** — not persisted to Sheets (that is booking rows, not chat transcripts).

### Conversation Engine (`lib/agent/engine.ts`)

- Route **text** (`processMessage`) and later **transcripts** (`processTranscript`) through the same path.
- Run **guardrails before** the LLM call.
- Phase 3+: inject **`sheets`** + **`calendar`** + MCP for tools (`confirm_booking`, etc.).

### PII Detector (`lib/agent/guardrails.ts`)

Deterministic regex / pattern checks before transcripts hit the LLM — same patterns as low-level §1.6.

### LLM Client (`lib/agent/llm.ts`)

Use the official **`openai`** package with **`baseURL: "https://api.groq.com/openai/v1"`**, **`GROQ_API_KEY`**, chat completions, and **`tool_calls`** / **`role: "tool"`** follow-up turns. Apply **`LLM_TIMEOUT_MS`** and retry with backoff on **429** per **`LLM_MAX_RETRIES`**.

```typescript
// Sketch
async function complete(systemPrompt, messages, tools) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await withTimeout(callGroqChat(systemPrompt, messages, tools), LLM_TIMEOUT_MS);
    } catch {
      if (attempt === MAX_RETRIES)
        return { text: "I'm sorry — could you repeat that?", toolCalls: null };
    }
  }
}
```

### Voice Pipeline hook (`lib/voice` + `app/api/agent/stream`)

After **Phases 2–4** (scheduling, MCP, post-call PII) are validated on **text**, add **Phase 5 (browser voice):** STT transcript → **`conversationEngine.processTranscript(sessionId, text)`** → TTS. See low-level architecture **Phase 4** (browser voice).

---

## Frontend

Not required for **engine-only** milestones; browser agent UI lives under `app/agent/` when you ship text + voice together.

---

## Backend Deploy Steps (Vercel)

1. Connect the repo to **Vercel**; ensure API routes use **Node runtime** for Groq.
2. Set **`GROQ_API_KEY`**, **`GROQ_MODEL`**, **`LLM_TIMEOUT_MS`**, **`LLM_MAX_RETRIES`** in the project **Environment Variables** (Preview + Production).
3. Deploy; run evals (`EVAL-2-*`) against the Preview URL.

---

## Rollback Plan

1. Revert the Vercel deployment to the prior production deployment.
2. Phase 1 **text-only** route (`POST /api/agent/message`) should remain working if Phase 2 stream route is faulty — isolate by feature flag or route revert.

---

## Related docs

- [Docs/low-level-architecture.md](../Docs/low-level-architecture.md) — authoritative Sheets layout, Calendar patch on PII submit, dual email rules.
- [Docs/architecture.md](../Docs/architecture.md) — ADRs and phase map.
