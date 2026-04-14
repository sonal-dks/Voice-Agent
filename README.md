# White Money Advisor Voice Agent

An AI assistant that helps users book, reschedule, or cancel advisor
appointments through a simple chat/voice experience.

This README starts with plain-language product flow, then covers setup and
technical details.

## What This Project Does (Simple Version)

Think of it like a smart scheduling receptionist:

- A user opens the app and talks/types to the assistant.
- The assistant asks what they need (new booking, reschedule, cancel, or availability).
- It offers available slots and confirms one.
- It gives a booking code.
- Contact details are collected in a separate form after booking
  (safer than asking in chat).

## User Flow (End-to-End)

1. User opens `/agent` and sees/hears a greeting.
2. User says what they want (for example, "book an appointment").
3. Assistant asks for:
   - topic
   - date
   - time preference
4. Assistant offers slots from the connected calendar.
5. User picks a slot (or asks for another time on that day).
6. Assistant confirms the booking and returns a booking code.
7. User clicks **Submit contact details** (separate flow).
8. System stores details securely and sends email updates (when configured).

## Why It Is Built This Way

- Keeps conversation natural and fast.
- Keeps personal details out of free-form chat.
- Keeps scheduling side-effects (calendar/sheets/email) behind structured tools.
- Works in phases: first stable text flow, then voice, then more integrations.

## Quick Start (Beginner Friendly)

### 1) Install

```bash
git clone https://github.com/sonal-dks/Voice-Agent.git
cd Voice-Agent
npm install
cp .env.example .env
```

### 2) Add minimum env

At minimum, add in `.env`:

- `GROQ_API_KEY`
- `DEEPGRAM_API_KEY`

Optional but common:

- `GROQ_MODEL`
- `DEEPGRAM_TTS_MODEL`

For real scheduling and email, also add `GOOGLE_*` and `GMAIL_*` variables
(see technical docs below).

### 3) Run

```bash
npm run dev
```

Open:

- `http://localhost:3000/agent`

### 4) Build check

```bash
npm run build
```

## What You Can Test Immediately

- Voice/chat greeting and first-turn disclaimer
- Topic/date/time collection
- Slot offer and confirm flow
- Booking code generation
- Post-booking contact details modal

## Tech Stack (Technical Section)

- **Frontend + API:** Next.js 14 (App Router)
- **LLM:** Groq via OpenAI-compatible SDK
- **Voice STT + TTS:** Deepgram (single provider)
- **Scheduling tools:** MCP (`@modelcontextprotocol/sdk`)
- **Data/validation:** TypeScript + Zod
- **Optional integrations:** Google Calendar, Google Sheets, Gmail

## Main Routes

- `GET /agent` - main assistant UI
- `POST /api/agent/message` - text conversation turn
- `POST /api/agent/stream` - voice turn (STT -> agent -> TTS)
- `POST /api/agent/tts` - greeting TTS helper
- `POST /api/booking/[code]/submit` - post-booking contact details submit
- `GET /api/health` - health endpoint

## Project Structure

```text
Voice-Agent/
|- app/
|  |- agent/                  # Chat + voice UI
|  |- booking/                # Post-booking details flow
|  `- api/                    # Route handlers
|- lib/                       # Agent engine, voice, MCP client, helpers
|- phase-1-text-agent/        # Phase docs and eval artifacts
|- phase-2-scheduling-core/   # MCP scheduling + Google integrations
|- phase-3-post-call-pii/     # PII form + submit libraries
|- Docs/                      # Architecture docs
|- .env.example
`- package.json
```

## Documentation Map

- Product + architecture: `Docs/architecture.md`
- Low-level design + env registry: `Docs/low-level-architecture.md`
- Scheduling/MCP details: `phase-2-scheduling-core/README.md`
- Post-call details flow: `phase-3-post-call-pii/README.md`

## Contributing

1. Fork the repo
2. Create a branch
3. Make changes
4. Open a pull request to `main`

## License

No license file is included yet. Add one (MIT/Apache-2.0/etc.) before broader reuse.

## Questions

Open an issue: <https://github.com/sonal-dks/Voice-Agent/issues>
