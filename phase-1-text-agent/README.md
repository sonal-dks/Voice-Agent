# Phase 1 — Text agent (documentation)

> This folder is **documentation only** for Phase 1. The runnable Next.js code lives at the **repository root** (`app/`, `lib/`, `package.json`).

## What is Phase 1?

Phase 1 delivers **text in, text out**: a browser chat that talks to **`POST /api/agent/message`**, uses the conversation engine (Groq + guardrails), and shows the compliance **disclaimer** on the first assistant turn. There is no phone audio, no Twilio, and no browser microphone in this phase.

## What’s in this folder?

| File | What it’s for |
|------|----------------|
| [outputs.md](./outputs.md) | What “done” looks like — deliverables and quality gates |
| [tests.md](./tests.md) | Manual test cases (TC-1-xx) |
| [evals.md](./evals.md) | AI evaluation notes (EVAL-1-xx) |
| [implementation.md](./implementation.md) | How the engine is wired (files, env vars, deploy hints) |

## Run the app (from repo root)

Phase 1 is exercised through the main app, not from inside this folder.

1. Go to the **parent directory** (where `package.json` is).
2. Install and run:

   ```bash
   npm install
   cp .env.example .env
   # Add GROQ_API_KEY in .env for live AI
   npm run dev
   ```

3. Open [http://localhost:3000/agent](http://localhost:3000/agent).

## Where to read next

- High-level phase map: [Docs/architecture.md](../Docs/architecture.md) §14 — Phase 1
- Full env and API details: [Docs/low-level-architecture.md](../Docs/low-level-architecture.md)
- Root project overview: [../README.md](../README.md)
