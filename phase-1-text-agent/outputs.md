# Phase 1 — Expected outputs & deliverables

> **Aligned with [Docs/architecture.md](../Docs/architecture.md) §14 — Backend — Phase 1** and **UI-1** (§14 / §9). Phase 1 is **text chat only**: no Twilio, no Deepgram, no ElevenLabs.

Use this file to know **what “done” looks like** for Phase 1 before you move to scheduling (Phase 2).

---

## Product outcome

| Outcome | Detail |
|--------|--------|
| **User experience** | A user opens the **Web Agent** page, types messages, and gets assistant replies over **`POST /api/agent/message`** — same engine path later used for voice transcripts. |
| **Conversation** | Full **intent** handling (book new, reschedule, cancel, what-to-prepare, check availability), **topic** selection from the fixed list, **time preference** collection; **slot offering may stub** until Phase 2 (architecture allows stubbed tools until real Calendar exists). |
| **Compliance** | **Disclaimer** on the **first assistant turn** (text); **PII** volunteered in chat is **rejected** with redirect copy; **no investment advice** — refusal + offer to book an advisor. |

---

## Backend artefacts (must exist)

| Artefact | Purpose |
|----------|---------|
| **`POST /api/agent/message`** | Accepts `{ "sessionId"?: UUID, "text": string }`; returns `{ sessionId, assistant, messages }`. |
| **`GET /api/health`** | Liveness for deploy checks (e.g. `{"status":"healthy"}`). |
| **`lib/agent/engine.ts`** | Orchestrates turns, guardrails → LLM → reply. |
| **`lib/agent/prompts.ts`** | System prompt, intents, tool declarations (stubs OK for scheduling tools in Phase 1). |
| **`lib/agent/state.ts`** | Per-`sessionId` in-memory dialog state. |
| **`lib/agent/llm.ts`** | Groq via OpenAI SDK (`GROQ_API_KEY` / `GROQ_MODEL`). |
| **`lib/agent/guardrails.ts`** | Pre-LLM PII / policy checks. |

**Not in Phase 1:** Google Calendar/Sheets/Gmail side-effects (Phases 2–3), post-call PII form (Phase 4), browser STT/TTS routes (Phase 5), Twilio.

---

## Frontend artefacts (UI-1)

Per architecture, **UI-1** ships with Phase 1:

| UI outcome | Notes |
|------------|--------|
| **Agent page** | e.g. `/agent` — chat thread, input, send. |
| **Disclaimer** | Shown per **G5** / first assistant turn in **text** (not a phone greeting). |
| **Loading / error** | Visible states for API failures or slow LLM. |
| **Session id** | Client shows or tracks **`sessionId`** returned by the API so multi-turn works. |

---

## Quality gates (before Phase 2)

| Gate | Where |
|------|--------|
| **Manual cases** | [tests.md](./tests.md) — TC-1-01 … TC-1-05 on **text** (browser and/or `curl`). |
| **Eval harness** | [evals.md](./evals.md) — e.g. EVAL-1-01 / EVAL-1-02 on **text** transcripts. |
| **Deploy** | Preview URL on Vercel; env: at least **`GROQ_API_KEY`** (and **`GROQ_MODEL`** as per [`.env.example`](../.env.example)). |

---

## What you do **not** get at the end of Phase 1

- Real **two-slot** pick from **Google Calendar** (Phase 2).
- **MCP** Calendar / Sheets / Gmail **draft** side-effects (Phase 3).
- **Post-call PII** page + dual email (Phase 4).
- **Mic + STT + TTS** on the same page (Phase 5).
- **Twilio PSTN** (optional later; see architecture **Optional — Twilio telephony**).

---

## Cross-phase “output” docs

| Phase | Folder | Expected outputs doc |
|-------|--------|-------------------------|
| 1 | `phase-1-text-agent/` (docs) + repo root (`app/`, `lib/`) | **This file** — `outputs.md` |
| 2–3 | `phase-2-scheduling-core/` / `phase-3-post-call-pii/` | Add `outputs.md` per phase when you implement them (same idea: exit criteria + artefacts + explicit non-goals). |

Architecture §14 remains the **source of truth** for phase names and dependencies; each phase folder’s `outputs.md` should stay consistent with it.
