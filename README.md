# Advisor Appointment Scheduler (Voice Agent)

> A Next.js app that chats with users to help them book advisor consultation slots. It uses an AI (Groq) for conversation, optional Google Calendar and Sheets for real scheduling, and a planned path to browser voice later.

This repo is **Next Leap — Milestone 3** work. The full system design lives in [Docs/architecture.md](./Docs/architecture.md) (see §14 for phases).

## What is this?

Visitors talk (today: **type**) with an assistant that figures out what they want (new booking, reschedule, etc.), stays within guardrails (no investment advice, no collecting sensitive personal data in chat), and can offer real time slots when Google is connected. After a booking, a separate flow can collect contact details safely (Phase 3).

## Features

- **Text chat agent** at `/agent` — powered by [Groq](https://groq.com/) (OpenAI-compatible API); works in a limited **offline** mode without an API key for local smoke tests.
- **Conversation engine** — intents, topic and time preference, disclaimer on the first assistant reply, PII and advice guardrails.
- **Optional live scheduling (Phase 2)** — MCP server talks to Google Calendar and Sheets; the Next.js app only uses an MCP client (no `googleapis` in the web app for those flows).
- **Post-call PII (Phase 3)** — booking code + secure link; form and APIs under `app/booking/` and `phase-3-post-call-pii/`.

## Built with

- [Next.js 14](https://nextjs.org/) (App Router) — UI and API routes
- [Groq](https://console.groq.com/) — fast LLM inference via the [OpenAI Node SDK](https://github.com/openai/openai-node) (`baseURL` pointed at Groq)
- [Model Context Protocol](https://modelcontextprotocol.io/) — `@modelcontextprotocol/sdk` for the scheduling server
- [TypeScript](https://www.typescriptlang.org/) and [Zod](https://zod.dev/) — types and validation

## Getting started

These steps run the **web app** on your computer. You need [Node.js](https://nodejs.org/) **18 or newer** (Node 20 LTS is a good choice). Check with:

```bash
node --version
```

### 1. Get the code

Clone the repository and enter the project folder (this is the folder that contains `package.json`):

```bash
git clone https://github.com/sonal-dks/Voice-Agent.git
cd Voice-Agent
```

### 2. Install dependencies

`npm` downloads the libraries the app needs:

```bash
npm install
```

### 3. Environment variables

Copy the example env file. The Next.js config loads **`.env`** from the **repo root**:

```bash
cp .env.example .env
```

Open `.env` in an editor and add at least:

- **`GROQ_API_KEY`** — from [Groq Console → API Keys](https://console.groq.com/keys) (free tier). Without it, the server uses a small offline stub so you can still run smoke tests.
- **`GROQ_MODEL`** — optional; defaults are documented in `.env.example`.

For **live Calendar/Sheets booking** (Phase 2), you also need the `GOOGLE_*` variables — see [phase-2-scheduling-core/README.md](./phase-2-scheduling-core/README.md).

### 4. Start the dev server

```bash
npm run dev
```

### 5. Open the app

In your browser go to:

- **Home:** [http://localhost:3000](http://localhost:3000)
- **Chat agent:** [http://localhost:3000/agent](http://localhost:3000/agent)

### 6. (Optional) Smoke test the API

With the dev server running, from another terminal:

```bash
npm run test:phase1
```

### Production build

```bash
npm run build
npm start
```

## How to use

1. Open **`/agent`**, type a message, and use the same **session** across turns (the UI stores `sessionId` from the API).
2. To verify the backend quickly, call **`GET /api/health`** — you should see a healthy status JSON.

## Project structure

```
Voice-Agent/                 # Next.js app root
├── app/                     # Pages and Route Handlers
│   ├── agent/               # Chat UI
│   ├── booking/             # PII flow (Phase 3)
│   └── api/                 # e.g. POST /api/agent/message
├── lib/                     # Agent engine, MCP client, env helpers
├── Docs/                    # architecture.md, low-level-architecture.md
├── phase-1-text-agent/      # Phase 1 docs (tests, evals, outputs)
├── phase-2-scheduling-core/ # MCP server + Google integration
├── phase-3-post-call-pii/   # PII libraries and form
├── .env.example             # Copy to .env — never commit .env
└── package.json
```

## Documentation map

| Topic | Document |
|--------|-----------|
| Phases and ADRs | [Docs/architecture.md](./Docs/architecture.md) |
| Env vars, file layout, deploy | [Docs/low-level-architecture.md](./Docs/low-level-architecture.md) |
| Phase 1 “done” criteria | [phase-1-text-agent/outputs.md](./phase-1-text-agent/outputs.md) |
| Scheduling / MCP | [phase-2-scheduling-core/README.md](./phase-2-scheduling-core/README.md) |
| Post-call PII | [phase-3-post-call-pii/README.md](./phase-3-post-call-pii/README.md) |

## Contributing

1. Fork the repository on GitHub.
2. Create a branch for your change: `git checkout -b feature/your-feature`
3. Commit with a clear message: `git commit -m "Describe your change"`
4. Push the branch: `git push origin feature/your-feature`
5. Open a Pull Request against the main branch.

## License

This repository does not include a `LICENSE` file yet. Add one (for example MIT or Apache-2.0) when you decide how you want others to use the code.

## Questions?

Open an issue on [github.com/sonal-dks/Voice-Agent](https://github.com/sonal-dks/Voice-Agent/issues).
