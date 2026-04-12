# Advisor Appointment Scheduler (Voice Agent)

> A Next.js app that chats with users to help them book advisor consultation slots. It uses an AI ([Groq](https://groq.com/)) for conversation, optional Google Calendar and Sheets for real scheduling, and a planned path to browser voice later.

**Who it’s for:** Developers and learners following the **Next Leap** voice-agent milestone; anyone who wants a working example of a guarded LLM chat plus optional MCP-backed scheduling.

Design details, phases, and ADRs: [Docs/architecture.md](./Docs/architecture.md) (see §14).

## What is this?

Imagine a friend opens a website and types to an assistant instead of calling a call center. The assistant figures out whether they want a new booking, a reschedule, or something else, stays within rules (no investment advice, no collecting sensitive personal details in the chat), and can offer real calendar slots when Google is connected. After a booking, a **separate** page collects contact information safely so private data is not mixed into the open-ended AI conversation.

This repository is **Next Leap — Milestone 3** coursework; the architecture doc above is the source of truth for how pieces fit together.

## Features

- Text chat agent at `/agent` — powered by Groq (OpenAI-compatible API); a small **offline** mode works without an API key for local smoke tests.
- Conversation engine — intents, topic and time preference, disclaimer on the first assistant reply, PII and advice guardrails.
- Optional live scheduling (Phase 2) — an MCP server talks to Google Calendar and Sheets; the Next.js app uses an MCP client only (no `googleapis` in the web app for those flows).
- Post-call PII (Phase 3) — booking code plus secure link; form and APIs live under `app/booking/` and `phase-3-post-call-pii/`.

## Built With

- [Next.js 14](https://nextjs.org/) — UI and API routes (App Router)
- [Groq](https://console.groq.com/) — LLM inference via the [OpenAI Node SDK](https://github.com/openai/openai-node) with `baseURL` set to Groq’s API
- [Model Context Protocol](https://modelcontextprotocol.io/) — `@modelcontextprotocol/sdk` for the scheduling server
- [TypeScript](https://www.typescriptlang.org/) and [Zod](https://zod.dev/) — types and validation

## Getting Started

These instructions help you run a copy of this project on your own computer.

### Prerequisites

You need **[Node.js](https://nodejs.org/) version 18 or higher** (version 20 LTS is a good default). Node includes `npm`, which installs JavaScript dependencies.

Check that Node is installed and see the version number:

```bash
node --version
```

You also need a **[Groq API key](https://console.groq.com/keys)** for full AI responses. The app can still start without it using a limited offline stub.

### Installation

Follow these steps in order. Each step uses the terminal: the **repository root** is the folder that contains `package.json` (after you clone, that folder is named `Voice-Agent`).

1. **Clone the repository** — downloads the project from GitHub and creates a local folder.

   ```bash
   git clone https://github.com/sonal-dks/Voice-Agent.git
   cd Voice-Agent
   ```

2. **Install dependencies** — `npm` reads `package.json` and downloads packages into `node_modules/`.

   ```bash
   npm install
   ```

3. **Set up environment variables** — copy the example file to `.env`. Next.js loads `.env` from the repo root (see `next.config.mjs`).

   ```bash
   cp .env.example .env
   ```

   Open `.env` in a text editor. Add at least:

   - **`GROQ_API_KEY`** — create a key in the [Groq Console](https://console.groq.com/keys). Without it, the chat uses an offline stub.
   - **`GROQ_MODEL`** — optional; defaults are documented in `.env.example`.

   For **live Calendar and Sheets** (Phase 2), add the `GOOGLE_*` variables described in [phase-2-scheduling-core/README.md](./phase-2-scheduling-core/README.md).

4. **Run the development server** — starts the Next.js dev server with hot reload.

   ```bash
   npm run dev
   ```

5. **Open the app in your browser** — the dev server listens on port 3000 by default.

   - Home: [http://localhost:3000](http://localhost:3000)
   - Chat agent: [http://localhost:3000/agent](http://localhost:3000/agent)

6. **(Optional) Run the Phase 1 smoke test** — with `npm run dev` still running, open a second terminal in the same repo root. This script checks that the health and message endpoints respond.

   ```bash
   npm run test:phase1
   ```

### Production build

To build and run like production (after `npm run build`, `next start` serves the optimized app):

```bash
npm run build
npm start
```

## How to Use

1. Go to **`/agent`**, type messages, and keep using the same chat **session** so follow-up turns make sense — the UI stores `sessionId` returned by the API.
2. Check that the server is up: open or request **`GET /api/health`** — you should get JSON with a healthy status.

Example health check from a terminal (with the dev server running):

```bash
curl -s http://localhost:3000/api/health
```

## Project Structure

```
Voice-Agent/
├── app/                     # Pages and Route Handlers
│   ├── agent/               # Chat UI
│   ├── booking/             # PII flow (Phase 3)
│   └── api/                 # e.g. POST /api/agent/message
├── lib/                     # Agent engine, MCP client, env helpers
├── Docs/                    # architecture.md, low-level-architecture.md
├── phase-1-text-agent/      # Phase 1 docs (tests, evals, outputs)
├── phase-2-scheduling-core/ # MCP server + Google integration
├── phase-3-post-call-pii/   # PII libraries and form
├── .env.example             # Copy to .env — do not commit real secrets
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

Contributions are welcome.

1. Fork the repository on GitHub.
2. Create a branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m "Describe your change"`
4. Push the branch: `git push origin feature/your-feature`
5. Open a Pull Request against the `main` branch.

## License

This repository does not include a `LICENSE` file yet. When you publish how others may use the code, add a license file (for example MIT or Apache-2.0) at the repo root and update this section to link to it.

## Questions?

Have a question? [Open an issue](https://github.com/sonal-dks/Voice-Agent/issues).
