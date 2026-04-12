# Next Leap — Advisor Appointment Scheduler (Voice Agent)

> **Maps to [Docs/architecture.md](./Docs/architecture.md) §14.**

## What this project delivers

An LLM-powered conversation engine driving intelligent dialog. **Google Gemini 3 Flash** classifies intents, manages multi-turn state, collects topic + time preference, and enforces guardrails. **Phase 2 (scheduling)** is in [`phase-2-scheduling-core/`](./phase-2-scheduling-core/) and wired via `@/lib/mcp/*`: **live Google Calendar slots**, **Bookings** sheet rows, and **booking codes** when `GOOGLE_*` env vars are set.

## Run (Next.js)

```bash
cp .env.example .env   # add GEMINI_API_KEY + Google credentials
npm install
npm run dev
```

Open `http://localhost:3000/agent`.

Smoke tests (dev server running): `npm run test:phase1`.

## Dependencies

- Environment: **`.env`** at repo root (create from [`.env.example`](./.env.example)); `next.config.mjs` loads it.
- **Google GenAI API** key and **`GEMINI_MODEL`** — **Gemini 3 Flash** (see [low-level-architecture.md](./Docs/low-level-architecture.md) env registry)
- **Phase 2 scheduling:** `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CALENDAR_ID`, `GOOGLE_SHEETS_SPREADSHEET_ID` — see [phase-2-scheduling-core/README.md](./phase-2-scheduling-core/README.md)
- No STT/TTS yet (text-only `POST /api/agent/message`; voice is Phase 4)

## Project structure

```
.                               # Next.js App Router (repo root)
├── app/                        # Pages + API routes
│   ├── agent/page.tsx          # Chat UI
│   ├── booking/[code]/         # PII form (Phase 3)
│   └── api/                    # Route handlers
├── lib/                        # Engine, MCP client, env
├── phase-1-text-agent/         # Phase 1 docs (outputs, tests, evals, implementation)
├── phase-2-scheduling-core/    # MCP server + Google integrations
├── phase-3-post-call-pii/      # PII components + lib
├── Docs/                       # Architecture docs
├── .env                        # Secrets (gitignored)
└── package.json
```

## Exit criteria (Phase 1)

- [phase-1-text-agent/outputs.md](./phase-1-text-agent/outputs.md) — expected deliverables
- [phase-1-text-agent/tests.md](./phase-1-text-agent/tests.md) — manual cases
- [phase-1-text-agent/evals.md](./phase-1-text-agent/evals.md) — eval harness
- [phase-1-text-agent/implementation.md](./phase-1-text-agent/implementation.md) — implementation notes

## What comes next

- **Phase 2 — Scheduling (real GCal):** [phase-2-scheduling-core/](./phase-2-scheduling-core/)
- **Phase 3 — Post-call PII:** [phase-3-post-call-pii/](./phase-3-post-call-pii/)
