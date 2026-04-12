# Voice Agent: Advisor Appointment Scheduler — Low-Level Architecture

> **Companion document to [architecture.md](./architecture.md).**
> This document contains the full implementation specification — code-level details, schemas, file structures, environment variables, deploy procedures, and rollback plans organized by phase. The high-level architecture (system overview, ADRs, data flow, security model, deployment topology) lives in `architecture.md`. Both documents share the same identifiers (component names, TC-IDs, EVAL-IDs, phase numbers) and must stay in sync. **Path prefix:** runnable Next.js code lives at the **repo root** (`app/`, `lib/`, `package.json`); **Phase 1** outputs/tests/evals live under **`phase-1-text-agent/`** (docs only); **Phase 2 (MCP)** code lives under **`phase-2-scheduling-core/`** — build the **MCP server with [FastMCP](https://gofastmcp.com/getting-started/welcome)** (Python) there; the repo may keep a **TypeScript stdio** reference at **`phase-2-scheduling-core/mcp/advisor-mcp-server.ts`** until FastMCP is the only server.

### Authoritative implementation sequence (must match [architecture.md § 14](./architecture.md#14-implementation-phases))

**Phase 1 → 2 → 3 → 4** — **section headings below match this order:**

1. **Phase 1 — Text ↔ text** — Web Agent UI + Agent API + Conversation Engine + Gemini (no STT/TTS, no Twilio).
2. **Phase 2 — MCP** — **[FastMCP](https://gofastmcp.com/getting-started/welcome)** in **`phase-2-scheduling-core/`**. **Two real Calendar slots**, **Calendar hold**, **Bookings** + **Advisor Pre-Bookings**, advisor **Gmail draft**, **`submit_pii_booking`** — **all only via MCP tools**. Next.js = **MCP client** only; **`googleapis` only in the MCP server process.**
3. **Phase 3 — Post-call PII** — Secondary UI + encrypted row + dual email via MCP; [`phase-3-post-call-pii/`](../phase-3-post-call-pii/).
4. **Phase 4 — Browser STT + TTS** — Same UI + engine; Deepgram + ElevenLabs; future work in `lib/voice/`, `app/api/agent/stream/`. **No Twilio.**

**Twilio** — optional PSTN ingress at the end of this file.

---

## Document Sync Protocol

These two documents are coupled. Any change to one must be reflected in the other:

| Change in `architecture.md` | Required update in `low-level-architecture.md` |
|---|---|
| New component added to Section 4 | Add implementation details for that component in the relevant phase |
| ADR changed (Section 6) — e.g., technology swap | Update all code sketches, dependencies, and env vars that reference the old technology |
| Data model changed (Section 7) — new table or column | Update the Alembic migration, SQLAlchemy model, and any code that reads/writes the changed table |
| New endpoint added to Section 8 | Add the handler implementation in the relevant phase |
| Phase added/removed/reordered (Section 14) | Add/remove/reorder the corresponding phase section below |

| Change in `low-level-architecture.md` | Required update in `architecture.md` |
|---|---|
| New file or module added | Update the Component Breakdown (Section 4) owner/repo field |
| New environment variable introduced | Verify it's covered in Security (Section 11) secrets management |
| New dependency added | Verify it doesn't conflict with Scalability (Section 10) or Deployment (Section 12) |
| Database migration added | Update the Data Model (Section 7) ERD and field classification table |
| New API route added | Update the API Surface (Section 8) key endpoints table |

**Shared identifiers (must match exactly across both documents):**
- Phase numbers and names: **Phase 1** (Text) · **Phase 2** (MCP + FastMCP) · **Phase 3** (Post-call PII) · **Phase 4** (Browser STT/TTS); **optional** Twilio appendix
- **Document & build order:** 1 → 2 → 3 → 4 (see [architecture.md §14](./architecture.md#14-implementation-phases))
- Test case IDs: `TC-{phase}-{seq}`, `TC-{phase}-F{seq}` (legacy IDs in repo may not match phase numbers until test matrix is realigned)
- Eval IDs: `EVAL-{phase}-{seq}`
- Component names: Twilio Voice Gateway (**optional**), Browser Voice Pipeline, Deepgram STT, ElevenLabs TTS, Conversation Engine, **Google Gemini** (LLM), **FastMCP MCP server** (Python) + **MCP client in Next** (`@modelcontextprotocol/sdk`), **Google Calendar + Sheets** (inside MCP server), **Post-call PII UI**
- Durable booking rows: **`Bookings` / `Advisor Pre-Bookings` / `PII_Submissions` in Google Sheets** (PostgreSQL sketches below are **legacy / alternate**)
- MCP tool names (expose from FastMCP / match TS reference): `offer_slots`, `confirm_booking`, `submit_pii_booking`, plus drafts/sends as specified in [architecture.md](./architecture.md)

**Stack note:** **Next.js on Vercel** (UI + Route Handlers + MCP **client**). **MCP server** = **FastMCP** (Python) under `phase-2-scheduling-core/` — see **§ Phase 2**. Legacy Python/FastAPI sketches below are for reference only.

**Change log convention:** When updating either document, append a row to the change log at the bottom of this file.

---

## Complete Project Structure (All Phases)

**Primary layout — single Next.js app on Vercel** (UI + API routes + agent logic). Optional Python modules may exist for experiments; production should colocate here.

```
./                                       # Repo root — Next.js app on Vercel
├── app/                             # Next.js App Router
│   ├── agent/
│   │   ├── page.tsx                 # [Phases 1–4] Main agent — text first; voice in Phase 4
│   │   └── components/
│   │       ├── ChatThread.tsx
│   │       ├── MicButton.tsx        # [Phase 4] Browser STT/TTS
│   │       └── BookingIdPanel.tsx   # [Phase 2 UI] Copyable booking code + CTA
│   ├── api/
│   │   ├── agent/
│   │   │   ├── message/route.ts     # [Phase 1] POST — text in / text out
│   │   │   └── stream/route.ts      # [Phase 4] WebSocket or chunked — browser audio
│   │   ├── booking/[code]/
│   │   │   └── submit/route.ts      # [Phase 3] POST — PII (must call MCP for Google writes)
│   │   └── health/route.ts
│   └── booking/[code]/              # [Phase 3] PII form UI + confirmed + invalid
│
├── lib/
│   ├── agent/                       # [Phase 1] Conversation Engine
│   │   ├── engine.ts
│   │   ├── llm.ts                   # Gemini + tools
│   │   ├── toolHandlers.ts          # Maps tools → MCP client (no googleapis here for booking)
│   │   └── ...
│   ├── voice/                       # [Phase 4]
│   ├── mcp/
│   │   ├── schedulingMcpClient.ts   # [Phase 2] Re-export → `phase-2-scheduling-core/mcp-client/`
│   │   └── schedulingTypes.ts
│   └── security/                    # [Phase 3] PII encryption helpers
│
├── phase-1-text-agent/              # [Phase 1] Docs only — outputs, tests, evals, implementation (Next code above)
│   └── README.md, outputs.md, tests.md, evals.md, implementation.md
│
├── phase-2-scheduling-core/
│   ├── fastmcp_server/              # [Phase 2] Optional FastMCP Python bridge (delegates to TS MCP)
│   ├── mcp-client/                  # [Phase 2] Next.js stdio MCP client (canonical source)
│   ├── mcp/
│   │   └── advisor-mcp-server.ts    # [Phase 2] Canonical TypeScript stdio MCP; googleapis only here + `src/`
│   ├── scripts/
│   │   └── mcp-one-shot-call.mts    # [Phase 2] Single tool call (Python bridge helper)
│   └── src/                         # Shared Google helpers (used by TS MCP server)
│
├── phase-3-post-call-pii/               # [Phase 3] PII libs + form component (sibling to app at repo root)
│   ├── components/PiiBookingForm.tsx
│   ├── lib/lookupBookingForPiiPage.ts, postPiiSubmit.ts, rateLimitPiiSubmit.ts
│   └── README.md, tests.md, evals.md
│
└── optional/twilio/                     # [Optional later]
    └── ...
```

**Legacy / alternate:** A FastAPI + Docker layout (`src/voice/twilio_handler.py`, etc.) is **not** the first-mile path; use it only if you split services later.

---

## Complete Environment Variable Registry

Every environment variable across all phases, in the order they are introduced.

| Variable | Phase | Required | Description | Example |
|----------|-------|----------|-------------|---------|
| `GEMINI_API_KEY` | 1 | Yes | Google AI / Gemini API key (Conversation Engine) | *(secret)* |
| `GEMINI_MODEL` | 1 | No | Model id (see `.env.example` at repo root) | `gemini-2.0-flash` |
| `LLM_TIMEOUT_MS` | 1 | No | Max wait for LLM response in ms (default: 3000) | `3000` |
| `LLM_MAX_RETRIES` | 1 | No | Retry count on LLM timeout (default: 1) | `1` |
| `LOG_LEVEL` | 1 | No | Logging level (default: INFO) | `INFO` |
| `MCP_ADVISOR_SERVER_ENTRY` | 2 | No | Path or command for MCP server: **FastMCP** entry (e.g. `uv run python -m advisor_mcp`) or TS reference `advisor-mcp-server.ts` (`npx tsx …`) | *(see `.env.example`)* |
| `DEEPGRAM_API_KEY` | 4 | Yes | Deepgram API key (browser streaming) | `dg-xxxxxxxx` |
| `ELEVENLABS_API_KEY` | 4 | Yes | ElevenLabs API key | `el-xxxxxxxx` |
| `ELEVENLABS_VOICE_ID` | 4 | Yes | ElevenLabs voice profile ID | `21m00Tcm4TlvDq8ikWAM` |
| `DATABASE_URL` | — | Optional | PostgreSQL — **only if** you adopt SQL booking store; **Sheets-first** milestone does not require it | `postgresql://...` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | 2 | Yes* | Service account JSON (or base64) — loaded by **MCP server** for Calendar + Sheets | *(secret)* |
| `GOOGLE_CALENDAR_ID` | 2 | Yes* | Shared advisor calendar ID | `primary` or `xxx@group.calendar.google.com` |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | 2 | Yes* | Workbook id for **Bookings** / **Advisor Pre-Bookings** | *(id)* |
| `SLOT_DURATION_MINUTES` | 2 | No | Duration of each slot (default: 30) | `30` |
| `ADVISOR_TIMEZONE` | 2 | No | IANA tz for display (default: Asia/Kolkata) | `Asia/Kolkata` |
| `GMAIL_SENDER` / `GMAIL_*` | 2–3 | Yes* | Gmail API for **draft** (Phase 2 MCP) and **send** (Phase 3 submit) | *per provider* |
| `ADVISOR_INBOX_EMAIL` | 2–3 | Yes | Advisor mailbox: MCP **draft** target + final **To:** on PII submit | `advisor@example.com` |
| `NEXT_PUBLIC_APP_URL` | 1+ | Yes (FE) | Deployed app URL (**Vercel** `*.vercel.app` is fine — no custom domain required) | `https://xxx.vercel.app` |
| `PII_ENCRYPTION_KEY` | 3 | Dev | 32-byte hex AES-256 key for PII at rest | `a1b2c3...` (64 hex chars) |
| `PII_ENCRYPTION_KEY_ARN` | 3 | Prod opt | AWS KMS key ARN | `arn:aws:kms:...` |
| `RATE_LIMIT_PII_PER_CODE` | 3 | No | Max PII submissions per booking code per hour | `5` |
| `RATE_LIMIT_PII_PER_IP` | 3 | No | Max PII submissions per IP per hour | `100` |
| `TWILIO_ACCOUNT_SID` | Twilio opt | If using PSTN | Twilio account SID | `AC...` |
| `TWILIO_AUTH_TOKEN` | Twilio opt | If using PSTN | Twilio auth token | `...` |
| `TWILIO_PHONE_NUMBER` | Twilio opt | If using PSTN | Inbound number | `+1234567890` |

---

## Complete Dependency Registry

### Primary — Next.js (`package.json` on Vercel)

| Package | Phase | Purpose |
|---------|-------|---------|
| `next` | 1+ | App Router, Route Handlers |
| `react` / `react-dom` | 1+ | UI |
| `@google/generative-ai` | 1 | Gemini LLM + tool schemas |
| `@modelcontextprotocol/sdk` | 2 | MCP client in Next; MCP server in scheduling package |
| `tsx` | 2 dev | Spawn MCP server via `npx tsx` |
| `zod` | 1+ | Validation |
| `@deepgram/sdk` or REST | 4 | Streaming STT |
| `tailwindcss` | 1+ | Styling |

### MCP server — Python (`phase-2-scheduling-core/fastmcp_server/`)

| Package | Version | Phase | Purpose |
|---------|---------|-------|---------|
| `fastmcp` | >=2.0 | 2 | **[FastMCP](https://gofastmcp.com/getting-started/welcome)** — MCP tool server (stdio or HTTP) |
| `google-api-python-client` or `googleapis` equivalent | *pinned* | 2 | Calendar, Sheets, Gmail from MCP tools |
| `pydantic` / `pydantic-settings` | *pinned* | 2 | Env + validation alongside FastMCP |

### Legacy — Python (`requirements.txt`) — optional split / experiments

| Package | Version | Phase introduced | Purpose |
|---------|---------|-----------------|---------|
| `fastapi` | >=0.111.0 | 1 | Web framework — async HTTP + WebSocket |
| `uvicorn[standard]` | >=0.30.0 | 1 | ASGI server |
| `websockets` | >=12.0 | 1 | WebSocket protocol for Twilio Media Streams |
| `httpx` | >=0.27.0 | 1 | Async HTTP client for ElevenLabs API |
| `twilio` | >=9.0.0 | 1 | Twilio SDK — TwiML generation, signature validation |
| `deepgram-sdk` | >=3.4.0 | 1 | Deepgram SDK — streaming STT |
| `pydantic-settings` | >=2.3.0 | 1 | Environment variable management |
| `python-dotenv` | >=1.0.0 | 1 | .env file loading for local dev |
| `openai` | >=1.30.0 | 2 | OpenAI Python SDK — Chat Completions with function calling |
| `sqlalchemy[asyncio]` | >=2.0.30 | 3 | Async ORM for PostgreSQL |
| `asyncpg` | >=0.29.0 | 3 | PostgreSQL async driver |
| `alembic` | >=1.13.0 | 3 | Database migration tool |
| `pytz` | >=2024.1 | 3 | IST timezone handling |
| `cryptography` | >=42.0.0 | 3 | AES-256-GCM encryption for PII fields (if not handled inside FastMCP tool) |

### PII forms (Phase 3)

Add `react-hook-form`, `@hookform/resolvers`, and `@sentry/nextjs` when implementing the booking form.

---

## Phase 1 — Text Agent & Conversation Engine (browser-first)

> **High-level context:** [architecture.md § 14, Backend Phase 1](./architecture.md#backend--phase-1--text-agent--conversation-engine-chat--chat)
> **Tests:** [tests.md](../phase-1-text-agent/tests.md) (text path first)
> **Evals:** [evals.md](../phase-1-text-agent/evals.md)

**Goal:** Ship **`POST /api/agent/message`** with **text in → assistant text out** using the full Conversation Engine (intents, guardrails, disclaimer on first assistant turn). **No** Deepgram, **no** ElevenLabs, **no** Twilio. Deploy to **Vercel** (`vercel deploy` / Git integration).

### 1.1 Agent API — text messages

**File:** `app/api/agent/message/route.ts` (Node runtime — not Edge — if calling OpenAI with streaming)

**Contract:** `POST` body `{ sessionId?: string, text: string }` → `{ messages: [...], assistant: string }` (shape as you standardize).

**Behavior:** Load or create session state → `conversationEngine.processMessage(sessionId, text)` → return assistant reply. Same engine instance will later receive **transcripts** from **Phase 4** (rename or alias `processTranscript`).

**Deploy:** Set **`GEMINI_API_KEY`** (and related model vars) in Vercel project settings. Use preview deployments for PRs.

### 1.2 System Prompt

**File:** `lib/agent/prompts.ts` (or `.py` if you keep a Python engine)

```python
SYSTEM_PROMPT = """
You are the Next Leap Advisor Appointment Scheduler, a voice assistant that
helps callers book tentative advisory consultation slots.

RULES — NEVER BREAK THESE:
1. DISCLAIMER FIRST: Your very first substantive response in every call must
   include: "This service is informational and does not constitute investment
   advice."
2. NO PII: Never ask for or accept phone numbers, email addresses, account
   numbers, or any personally identifiable information. If the caller
   volunteers PII, say: "For your security, I can't take personal details
   over the phone. You can complete contact details in our app after booking
   when that step is available — not here."
3. NO INVESTMENT ADVICE: Never recommend funds, stocks, strategies, or
   market actions. If asked, say: "I'm not able to provide investment advice.
   I can help you book a consultation with an advisor who can assist you.
   For educational resources, visit nextleap.com/learn."
4. TIMEZONE: Always state times in IST (Indian Standard Time). Always repeat
   the full date and time on confirmation.

INTENTS YOU HANDLE:
- book_new: Caller wants to book a new advisor consultation
- reschedule: Caller wants to change an existing booking
- cancel: Caller wants to cancel an existing booking
- what_to_prepare: Caller asks what to bring/prepare for the consultation
- check_availability: Caller wants to know available time windows

TOPICS (collect exactly one):
- KYC/Onboarding
- SIP/Mandates
- Statements/Tax Docs
- Withdrawals & Timelines
- Account Changes/Nominee

FLOW FOR book_new:
1. Greet and deliver disclaimer
2. Ask for the consultation topic (offer the 5 options)
3. Confirm the topic
4. Ask for day/time preference
5. [Slot offering handled by tools — not yet available]

For reschedule/cancel: Ask for the booking code, then proceed.
For what_to_prepare: Provide topic-specific preparation guidance.
For check_availability: Ask for preferred day and topic, then check.

Be concise. This is a voice call — keep responses under 3 sentences.
Use natural, conversational language. Avoid jargon.
"""
```

### 1.3 LLM Function Definitions

**File:** `lib/agent/prompts.ts` (same module as § 1.2)

Phase 1 introduces intent detection. **Phase 2** adds scheduling and MCP tools (legacy sketch labels below may still say “Phase 2/3/4” in comments — map them to **§14 Phase 2 MCP**).

```python
FUNCTION_DEFINITIONS = [
    # --- Phase 2: Intent detection ---
    {
        "name": "detect_intent",
        "description": "Classify the caller's intent from their utterance",
        "parameters": {
            "type": "object",
            "properties": {
                "intent": {
                    "type": "string",
                    "enum": ["book_new", "reschedule", "cancel",
                             "what_to_prepare", "check_availability", "unclear"]
                },
                "confidence": {"type": "number"},
                "topic": {
                    "type": "string",
                    "enum": ["KYC/Onboarding", "SIP/Mandates",
                             "Statements/Tax Docs", "Withdrawals & Timelines",
                             "Account Changes/Nominee", "unknown"],
                },
                "time_preference": {"type": "string"}
            },
            "required": ["intent", "confidence"]
        }
    },
    # --- Scheduling (Phase 2 MCP) ---
    {
        "name": "offer_slots",
        "description": "Retrieve available advisor slots for the given topic and time preference",
        "parameters": {
            "type": "object",
            "properties": {
                "topic": {"type": "string"},
                "day": {"type": "string", "description": "today, tomorrow, or a date"},
                "time_preference": {"type": "string", "description": "morning, afternoon, evening, or specific time"}
            },
            "required": ["topic", "day", "time_preference"]
        }
    },
    {
        "name": "confirm_booking",
        "description": "Confirm the caller's slot selection and create the booking",
        "parameters": {
            "type": "object",
            "properties": {
                "topic": {"type": "string"},
                "selected_slot_key": {"type": "string"},
                "selected_slot_display": {"type": "string"}
            },
            "required": ["topic", "selected_slot_key", "selected_slot_display"]
        }
    },
    # --- MCP tools (Phase 2) ---
    {
        "name": "create_calendar_hold",
        "description": "Create a tentative calendar hold for the confirmed booking",
        "parameters": {
            "type": "object",
            "properties": {"booking_code": {"type": "string"}},
            "required": ["booking_code"]
        }
    },
    {
        "name": "append_notes",
        "description": "Append booking details to the Advisor Pre-Bookings notes",
        "parameters": {
            "type": "object",
            "properties": {"booking_code": {"type": "string"}},
            "required": ["booking_code"]
        }
    },
    {
        "name": "draft_email",
        "description": "Draft an approval-gated email to the advisor with booking details",
        "parameters": {
            "type": "object",
            "properties": {
                "booking_code": {"type": "string"},
                "advisor_email": {"type": "string", "default": "advisor@nextleap.com"}
            },
            "required": ["booking_code"]
        }
    },
]
```

### 1.4 Dialog State Manager

**File:** `src/agent/state.py`

```python
from dataclasses import dataclass, field
from enum import Enum

class DialogPhase(Enum):
    GREETING = "greeting"
    TOPIC_COLLECTION = "topic_collection"
    TOPIC_CONFIRMATION = "topic_confirmation"
    TIME_COLLECTION = "time_collection"
    SLOT_OFFERING = "slot_offering"
    BOOKING_CONFIRMATION = "confirmation"
    COMPLETE = "complete"

@dataclass
class CallState:
    call_sid: str
    phase: DialogPhase = DialogPhase.GREETING
    intent: str | None = None
    topic: str | None = None
    time_preference: str | None = None
    disclaimer_delivered: bool = False
    messages: list = field(default_factory=list)
    turn_count: int = 0
    offered_slots: list = field(default_factory=list)   # Phase 2 MCP
    booking_code: str | None = None                      # Phase 2 MCP
```

**Lifecycle:** Created on WebSocket `start` event. Stored in `ConversationEngine.states[call_sid]`. Deleted on WebSocket `stop` event via `engine.end_call()`. Never persisted to disk — transient per-call state only.

### 1.5 Conversation Engine

**File:** `src/agent/engine.py`

```python
class ConversationEngine:
    def __init__(self, llm_client: LLMClient, calendar=None, db=None, mcp_server=None):
        self.llm = llm_client
        self.calendar = calendar          # Phase 2 MCP
        self.db = db                      # Phase 2 MCP
        self.mcp_server = mcp_server      # Phase 2 MCP
        self.states: dict[str, CallState] = {}

    async def process_transcript(self, call_sid: str, transcript: str) -> str:
        state = self.states.setdefault(call_sid, CallState(call_sid=call_sid))

        # Pre-LLM guardrail: PII detection (deterministic, runs before LLM)
        if contains_pii(transcript):
            return (
                "For your security, I can't take personal details over the "
                "phone. You can complete contact details in our app after booking "
                "those details. What topic would you like to discuss with "
                "an advisor?"
            )

        state.messages.append({"role": "user", "content": transcript})
        state.turn_count += 1

        response = await self.llm.complete(
            system_prompt=SYSTEM_PROMPT,
            messages=state.messages,
            functions=FUNCTION_DEFINITIONS
        )

        # If LLM returned a tool call, execute it
        if response.function_call:
            result_text = await self._handle_tool_call(state, response.function_call)
            state.messages.append({"role": "assistant", "content": result_text})
            return result_text

        state.messages.append({"role": "assistant", "content": response.text})
        return response.text

    def end_call(self, call_sid: str):
        self.states.pop(call_sid, None)
```

### 1.6 PII Detector (Pre-LLM Guardrail)

**File:** `src/agent/guardrails.py`

```python
import re

PII_PATTERNS = [
    r'\b\d{10}\b',                           # 10-digit phone number
    r'\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b',   # US phone format
    r'\+\d{1,3}\s?\d{6,14}\b',              # International phone
    r'\b[\w.+-]+@[\w-]+\.[\w.-]+\b',         # Email address
    r'\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b',   # Card-like number
    r'\b[A-Z]{2,5}\d{8,20}\b',              # Account number pattern
]

def contains_pii(text: str) -> bool:
    for pattern in PII_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return True
    return False
```

**Why pre-LLM:** This runs before the transcript reaches GPT-4o, so even if the LLM hallucinates, PII is never included in the LLM request payload. This is a deterministic safety net — the LLM system prompt provides the second layer.

### 1.7 LLM Client with Timeout & Retry

**File:** `src/agent/llm.py`

```python
class LLMClient:
    async def complete(self, system_prompt, messages, functions=None):
        for attempt in range(settings.LLM_MAX_RETRIES + 1):
            try:
                response = await asyncio.wait_for(
                    self._call_openai(system_prompt, messages, functions),
                    timeout=settings.LLM_TIMEOUT_MS / 1000
                )
                return response
            except asyncio.TimeoutError:
                if attempt < settings.LLM_MAX_RETRIES:
                    continue
                return LLMResponse(
                    text="I'm sorry, give me just a moment. Could you repeat that?",
                    function_call=None
                )
```

**Timeout budget:** 3000ms default. After 1 retry, returns a canned filler response so the caller doesn't hear dead air. Corresponds to the 800ms p95 LLM target in architecture.md § 10 — the 3s timeout covers worst-case tail latency.

### 1.8 Wire voice to engine (after Phase 4 STT exists)

**When Phase 4 is implemented:** the browser voice pipeline calls the **same** `processTranscript(sessionId, text)` (or equivalent) as text mode — **no duplicate** business logic.

```text
# Pseudocode — browser WebSocket or chunked audio handler:
final_transcript = await deepgram.finalUtterance(...)
response_text = await conversation_engine.process_transcript(session_id, final_transcript)
audio_chunks = await tts_client.synthesize(response_text)
# Play audio in browser via Web Audio API
```

### 1.9 Deploy & Rollback (Phase 1 — text only)

**Deploy:** `vercel` — connect repo, set env vars, production + preview. No Twilio, no audio deps required for Phase 1.

**Rollback:** Vercel Instant Rollback to prior deployment. No database for pure Phase 1 if scheduling not yet merged.

---

## Phase 2 — MCP: Scheduling & booking side-effects (merged)

> **High-level context:** [architecture.md § 14, Backend Phase 2 (MCP)](./architecture.md#backend--phase-2--mcp-scheduling--booking-side-effects-merged)
> **Tests:** [phase-2-scheduling-core/tests.md](../phase-2-scheduling-core/tests.md)
> **Evals:** [phase-2-scheduling-core/evals.md](../phase-2-scheduling-core/evals.md)

### 2.0 Target: FastMCP server (Python, Phase 2)

**Primary approach:** Add a **FastMCP** project under [`phase-2-scheduling-core/fastmcp_server/`](../phase-2-scheduling-core/) (or equivalent name), following **[FastMCP — Welcome](https://gofastmcp.com/getting-started/welcome)**. Declare tools (`@mcp.tool`) that wrap the same behaviors as today: **`offer_slots`**, **`confirm_booking`**, **`submit_pii_booking`**, Gmail draft/send as needed. Reuse Google logic by calling into **`phase-2-scheduling-core/src/`** via thin Python bindings, **or** reimplement reads/writes with **`google-api-python-client`** inside the FastMCP module — pick one boundary and document it in `phase-2-scheduling-core/README.md`.

**Transport:** Prefer **stdio** for parity with the current Next client (`StdioClientTransport`); **HTTP/SSE** is acceptable if the Next MCP client is switched to match ([Model Context Protocol](https://modelcontextprotocol.io/) transports).

**MCP client (Next):** canonical [`phase-2-scheduling-core/mcp-client/schedulingMcpClient.ts`](../phase-2-scheduling-core/mcp-client/schedulingMcpClient.ts) — re-exported from [`lib/mcp/`](../lib/mcp/). Spawns the **TS** MCP server by default, or set `MCP_ADVISOR_SERVER_ENTRY` to a **Python FastMCP** launcher (see `phase-2-scheduling-core/fastmcp_server/README.md`). Tool wiring: [`toolHandlers.ts`](../lib/agent/toolHandlers.ts).

### 2.0b Reference: TypeScript stdio MCP (interim)

**MCP server (TS):** [`phase-2-scheduling-core/mcp/advisor-mcp-server.ts`](../phase-2-scheduling-core/mcp/advisor-mcp-server.ts) — **`googleapis`** and service-account auth **only** here + `src/`; tools **`offer_slots`**, **`confirm_booking`**, **`submit_pii_booking`**. Use until FastMCP tools reach parity.

**Rule:** No Calendar/Sheets/Gmail REST clients in the **Next.js app** for booking or PII submit — **MCP only**.

### 2.1 Alternate durable store — PostgreSQL (optional sketch)

The following migration and `lib/services/google_calendar` layout apply **only** if you move off Sheets to SQL. The **current** repo uses **Google Sheets** tabs for **Bookings** / **Advisor Pre-Bookings** inside the MCP server implementation.

### 2.1a Database Schema — Migration 001

**File:** `alembic/versions/001_create_booking_tables.py`

```python
def upgrade():
    op.create_table(
        'bookings',
        sa.Column('id', sa.UUID(), primary_key=True, default=uuid.uuid4),
        sa.Column('booking_code', sa.String(7), unique=True, nullable=False),
        sa.Column('topic', sa.String(50), nullable=False),
        sa.Column('slot_time', sa.DateTime(timezone=True), nullable=True),
        sa.Column('slot_display', sa.String(100), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, default='confirmed'),
        sa.Column('side_effects_completed', sa.Boolean(), default=False),
        sa.Column('secure_link_token', sa.UUID(), unique=True, default=uuid.uuid4),
        sa.Column('pii_submitted', sa.Boolean(), default=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )
    op.create_table(
        'calendar_holds',
        sa.Column('id', sa.UUID(), primary_key=True, default=uuid.uuid4),
        sa.Column('booking_id', sa.UUID(), sa.ForeignKey('bookings.id'), nullable=False),
        sa.Column('hold_title', sa.String(200), nullable=False),
        sa.Column('start_time', sa.DateTime(timezone=True), nullable=False),
        sa.Column('end_time', sa.DateTime(timezone=True), nullable=False),
        sa.Column('status', sa.String(20), default='tentative'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_bookings_code', 'bookings', ['booking_code'])
    op.create_index('ix_bookings_token', 'bookings', ['secure_link_token'])

def downgrade():
    op.drop_table('calendar_holds')
    op.drop_table('bookings')
```

**Maps to:** architecture.md § 7 `BOOKING` and `CALENDAR_HOLD` entities.

### 2.2 Google Calendar Service (real — no mock seed)

**File:** `lib/services/google_calendar.ts` (or Python equivalent if you keep a sidecar)

**Auth:** **Service account** JSON in `GOOGLE_SERVICE_ACCOUNT_JSON`; calendar shared with the service account email; `GOOGLE_CALENDAR_ID` points at the advisor calendar.

**Reads:** Use **Calendar API** `freebusy.query` and/or `events.list` for the requested **day window** (resolved from user language: “today”, “tomorrow”, ISO date). Apply **IST** (`Asia/Kolkata`) for display strings. Return **exactly two** candidate slots that are **actually free** (exclude conflicts with existing events). Slots are **not** random and **not** from a static template — they reflect **live** availability.

**Writes:** Tentative **event insert** happens in the **same MCP server** as slot discovery (`confirm_booking`); store `google_event_id` on the **Bookings** row (Sheets or SQL, depending on implementation).

**Quotas / errors:** Handle `429` / `403` with user-visible fallback (“no slots could be retrieved — try another day”) and structured logs — no silent mock fallback.

**Local dev:** Use a **dedicated test calendar** in the same Google Cloud project so you never touch production advisor data by mistake.

### 2.3 Booking Code Generator

**File:** `src/services/booking_code.py`

```python
async def generate_booking_code(db_session) -> str:
    for _ in range(10):
        letter = random.choice(string.ascii_uppercase)
        digits = f"{random.randint(0, 999):03d}"
        code = f"NL-{letter}{digits}"
        exists = await db_session.execute(
            select(Booking).where(Booking.booking_code == code)
        )
        if not exists.scalar_one_or_none():
            return code
    raise RuntimeError("Failed to generate unique booking code after 10 attempts")
```

**Keyspace:** 26 letters x 1,000 numbers = 26,000 unique codes. At 500 bookings/day, collision probability stays low for ~50 days before needing keyspace expansion.

### 2.4 Conversation Engine — Tool Call Handlers

**File:** `src/agent/engine.py` — new method `_handle_tool_call()`

```python
async def _handle_tool_call(self, state: CallState, tool_call) -> str:
    if tool_call.name == "offer_slots":
        slots = await self.calendar.get_available_slots(
            topic=tool_call.args["topic"],
            day=tool_call.args["day"],
            time_preference=tool_call.args["time_preference"]
        )
        if not slots:
            return await self._handle_waitlist(state, tool_call.args)
        state.offered_slots = slots
        state.phase = DialogPhase.SLOT_OFFERING
        slot_text = " or ".join(s["display"] for s in slots)
        return f"I have two available slots: {slot_text}. Which works better for you?"

    elif tool_call.name == "confirm_booking":
        code = await generate_booking_code(self.db)
        booking = Booking(
            booking_code=code,
            topic=tool_call.args["topic"],
            slot_time=parse_slot_time(tool_call.args["selected_slot_key"]),
            slot_display=tool_call.args["selected_slot_display"],
            status="confirmed",
        )
        self.db.add(booking)
        await self.db.commit()
        state.booking_code = code
        state.phase = DialogPhase.COMPLETE

        # Merged Phase 2 (MCP): side-effects run inside MCP tool confirm_booking (not a separate phase)
        if self.mcp_server:
            await self._execute_mcp_side_effects(code)

        return await self._build_confirmation_response(booking)
```

### 2.5 Deploy & Rollback

**Deploy:**
1. Run DB migrations (`alembic upgrade head` or Prisma migrate) — creates `bookings` and `calendar_holds`.
2. Set `DATABASE_URL`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CALENDAR_ID`, and timezone-related vars on **Vercel**.
3. Verify Calendar API can list free/busy against the shared calendar from the deployment environment.

**Rollback:** Revert Vercel deployment; downgrade DB migration if needed. Phase 1 text remains usable without DB; Phase 4 voice is optional on the same deployment.

---

### 2.10 Legacy sketch — MCP as a separate layer (pre-merge doc)

> **Note:** **FastMCP** is the **canonical** way to implement **Phase 2** tools. The Python class sketches below illustrate tool **splitting**; prefer a **single FastMCP app** with the tool names **`offer_slots`**, **`confirm_booking`**, **`submit_pii_booking`**, etc.

### 2.11 Database Schema — Migration 002

**File:** `alembic/versions/002_add_notes_email_tables.py`

```python
def upgrade():
    op.create_table(
        'notes_entries',
        sa.Column('id', sa.UUID(), primary_key=True, default=uuid.uuid4),
        sa.Column('booking_id', sa.UUID(), sa.ForeignKey('bookings.id'), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        'email_drafts',
        sa.Column('id', sa.UUID(), primary_key=True, default=uuid.uuid4),
        sa.Column('booking_id', sa.UUID(), sa.ForeignKey('bookings.id'), nullable=False),
        sa.Column('recipient', sa.String(200), nullable=False),
        sa.Column('subject', sa.String(500), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('approval_gated', sa.Boolean(), default=True),
        sa.Column('status', sa.String(20), default='drafted'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_notes_booking', 'notes_entries', ['booking_id'])
    op.create_index('ix_email_booking', 'email_drafts', ['booking_id'])

def downgrade():
    op.drop_table('email_drafts')
    op.drop_table('notes_entries')
```

**Maps to:** architecture.md § 7 `NOTES_ENTRY` and `EMAIL_DRAFT` entities.

### 2.12 MCP Tool Server

**File:** `src/mcp/server.py`

```python
@dataclass
class ToolResult:
    success: bool
    data: dict
    error: str | None = None

class MCPToolServer:
    def __init__(self, db_session, calendar_service):
        self.db = db_session
        self.calendar = calendar_service
        self.tools = {
            "create_calendar_hold": self._create_calendar_hold,
            "append_notes": self._append_notes,
            "draft_email": self._draft_email,
        }

    async def execute(self, tool_name: str, args: dict, idempotency_key: str) -> ToolResult:
        if tool_name not in self.tools:
            return ToolResult(success=False, data={}, error=f"Unknown tool: {tool_name}")
        existing = await self._check_idempotency(tool_name, idempotency_key)
        if existing:
            return ToolResult(success=True, data=existing)
        return await self.tools[tool_name](args, idempotency_key)
```

**Idempotency:** Every tool checks for an existing record keyed on `booking_code` before writing. Duplicate calls (from LLM retries or reconciliation) return the existing record without creating duplicates.

### 2.13 MCP Tool: Calendar Hold

**File:** `lib/mcp/tools/calendar_hold.ts` (or `src/mcp/tools/calendar_hold.py`)

**Implementation note:** Persist the local `CalendarHold` row **and** call **Google Calendar API** `events.insert` (or update) using the same slot times so the advisor calendar shows the tentative block. Store returned **`google_event_id`** on the booking or hold row for idempotent updates.

```python
async def _create_calendar_hold(self, args: dict, booking_code: str) -> ToolResult:
    booking = await self._get_booking(booking_code)
    hold_title = f"Advisor Q&A — {booking.topic} — {booking_code}"
    # ... insert via Google Calendar API, then mirror in DB ...
    hold = CalendarHold(
        booking_id=booking.id,
        hold_title=hold_title,
        start_time=booking.slot_time,
        end_time=booking.slot_time + timedelta(minutes=30),
        status="tentative",
    )
    self.db.add(hold)
    await self.db.commit()
    return ToolResult(success=True, data={
        "hold_id": str(hold.id), "title": hold_title,
        "start": hold.start_time.isoformat(), "end": hold.end_time.isoformat(),
    })
```

### 2.14 MCP Tool: Notes Append

**File:** `src/mcp/tools/notes_append.py`

```python
async def _append_notes(self, args: dict, booking_code: str) -> ToolResult:
    booking = await self._get_booking(booking_code)
    payload = {
        "document": "Advisor Pre-Bookings",
        "date": booking.created_at.isoformat(),
        "topic": booking.topic,
        "slot": booking.slot_display,
        "code": booking_code,
    }
    entry = NotesEntry(booking_id=booking.id, payload=payload)
    self.db.add(entry)
    await self.db.commit()
    return ToolResult(success=True, data={"notes_id": str(entry.id), "payload": payload})
```

### 2.15 MCP Tool: Email Draft

**File:** `src/mcp/tools/email_draft.py`

```python
async def _draft_email(self, args: dict, booking_code: str) -> ToolResult:
    booking = await self._get_booking(booking_code)
    subject = f"New Advisor Consultation — {booking.topic} — {booking_code}"
    body = (
        f"A new advisor consultation has been pre-booked.\n\n"
        f"Booking Code: {booking_code}\n"
        f"Topic: {booking.topic}\n"
        f"Scheduled Slot: {booking.slot_display}\n"
        f"Status: Tentative — pending optional contact submission in app.\n\n"
        f"This email requires approval before sending. "
        f"The caller has not yet submitted contact details."
    )
    draft = EmailDraft(
        booking_id=booking.id,
        recipient=args.get("advisor_email", "advisor@nextleap.com"),
        subject=subject, body=body,
        approval_gated=True, status="drafted",
    )
    self.db.add(draft)
    await self.db.commit()
    return ToolResult(success=True, data={
        "draft_id": str(draft.id), "subject": subject, "approval_gated": True,
    })
```

### 2.16 MCP Orchestration in Conversation Engine

**File:** `src/agent/engine.py`

```python
async def _execute_mcp_side_effects(self, booking_code: str):
    results = {}
    for tool_name in ["create_calendar_hold", "append_notes", "draft_email"]:
        result = await self.mcp_server.execute(
            tool_name=tool_name, args={}, idempotency_key=booking_code,
        )
        results[tool_name] = result
        if not result.success:
            await self._flag_for_reconciliation(booking_code, tool_name, result.error)

    if all(r.success for r in results.values()):
        await self._mark_side_effects_completed(booking_code)
```

**Failure handling:** If any MCP tool fails, the call still completes (the caller hears the booking code). The booking is flagged with `side_effects_completed=False` and the reconciliation job retries within 60 seconds.

### 2.17 Reconciliation Background Job

**File:** `src/jobs/reconcile_side_effects.py`

```python
async def reconcile_pending_side_effects():
    """Runs every 60s. Retries failed MCP writes. Max 3 retries per booking."""
    pending = await db.execute(
        select(Booking).where(
            Booking.side_effects_completed == False,
            Booking.status == "confirmed",
            Booking.created_at > datetime.utcnow() - timedelta(hours=24),
        )
    )
    for booking in pending.scalars():
        missing_tools = await identify_missing_side_effects(booking)
        for tool_name in missing_tools:
            await mcp_server.execute(tool_name=tool_name, args={}, idempotency_key=booking.booking_code)
        if not missing_tools:
            booking.side_effects_completed = True
            await db.commit()
```

### 2.18 Deploy & Rollback

**Deploy:** `alembic upgrade head` (adds `notes_entries`, `email_drafts`). Build + push + update ECS. Start reconciliation job.

**Rollback:** Revert ECS to Phase 2 MCP. `alembic downgrade -1` drops both tables. Stop reconciliation job.

---

## Phase 3 — Post-call PII & user + advisor email

> **High-level context:** [architecture.md § 14, Backend Phase 3 (PII)](./architecture.md#backend--phase-3--post-call-pii--user--advisor-email)
> **Tests:** [phase-3-post-call-pii/tests.md](../phase-3-post-call-pii/tests.md)
> **Evals:** [phase-3-post-call-pii/evals.md](../phase-3-post-call-pii/evals.md)

### 3.1 Database Schema — Migration 003 (PII)

**File:** `alembic/versions/003_add_pii_submissions.py`

```python
def upgrade():
    op.create_table(
        'pii_submissions',
        sa.Column('id', sa.UUID(), primary_key=True, default=uuid.uuid4),
        sa.Column('booking_id', sa.UUID(), sa.ForeignKey('bookings.id'), nullable=False, unique=True),
        sa.Column('encrypted_name', sa.LargeBinary(), nullable=False),
        sa.Column('encrypted_email', sa.LargeBinary(), nullable=False),
        sa.Column('encrypted_phone', sa.LargeBinary(), nullable=False),
        sa.Column('encrypted_account', sa.LargeBinary(), nullable=True),
        sa.Column('encryption_key_id', sa.String(100), nullable=False),
        sa.Column('nonce', sa.LargeBinary(), nullable=False),
        sa.Column('submitted_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

def downgrade():
    op.drop_table('pii_submissions')
```

**Maps to:** architecture.md § 7 `PII_SUBMISSION` entity.

### 3.2 PII Field-Level Encryption

**File:** `src/security/encryption.py`

```python
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import os

class PIIEncryptor:
    def __init__(self, key_bytes: bytes):
        self.aead = AESGCM(key_bytes)

    def encrypt_field(self, plaintext: str, aad: bytes) -> tuple[bytes, bytes]:
        nonce = os.urandom(12)  # 96-bit nonce, unique per field
        ciphertext = self.aead.encrypt(nonce, plaintext.encode('utf-8'), aad)
        return ciphertext, nonce

    def decrypt_field(self, ciphertext: bytes, nonce: bytes, aad: bytes) -> str:
        plaintext = self.aead.decrypt(nonce, ciphertext, aad)
        return plaintext.decode('utf-8')
```

**AAD (Associated Authenticated Data):** The `booking_id` (UUID bytes) is used as AAD, cryptographically binding each encrypted field to its booking record. Prevents ciphertext from being moved between bookings.

### 3.3 Booking Code Spelling for Voice

**File:** `src/agent/engine.py`

```python
def _spell_code(self, code: str) -> str:
    """NL-A742 → N L dash A 7 4 2"""
    return " ".join("dash" if c == "-" else c for c in code)

async def _build_confirmation_response(self, booking: Booking) -> str:
    return (
        f"Your appointment is confirmed! Your booking code is "
        f"{self._spell_code(booking.booking_code)}. "
        f"That's {booking.slot_display}. "
        f"Save this code — you'll use it on our site to complete contact details when prompted. "
        f"Is there anything else I can help you with?"
    )
```

### 3.4 Waitlist Flow

**File:** `src/agent/engine.py`

```python
async def _handle_waitlist(self, state: CallState, args: dict) -> str:
    code = await generate_booking_code(self.db)
    booking = Booking(
        booking_code=code, topic=args["topic"], slot_time=None,
        slot_display=f"Waitlisted — preferred: {args['day']} {args['time_preference']}",
        status="waitlisted",
    )
    self.db.add(booking)
    await self.db.commit()

    await self.mcp_server.execute("create_calendar_hold", {}, code)
    await self.mcp_server.execute("append_notes", {}, code)
    await self.mcp_server.execute("draft_email", {"waitlist": True}, code)

    return (
        f"I don't have any slots available for that time window. "
        f"I've added you to our waitlist with code {self._spell_code(code)}. "
        f"We'll reach out when a slot opens up. "
        f"When contact collection is available on our app, use code "
        f"{self._spell_code(code)} so we can notify you."
    )
```

### 3.5 PII UI — page (same Vercel app)

**Canonical components:** [`phase-3-post-call-pii/`](../phase-3-post-call-pii/) — **`PiiBookingForm`**, lookup + submit libs. **Route:** `app/booking/[code]/page.tsx` imports from Phase 3.

**File:** `app/booking/[code]/page.tsx` (thin route — re-exports / composes Phase 3 UI)

```tsx
export default async function BookingPage({ params, searchParams }: Props) {
  const booking = await validateBookingCode(params.code, searchParams.token);
  if (!booking) redirect(`/${params.code}/expired`);
  if (booking.pii_submitted) redirect(`/${params.code}/confirmed`);

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Complete Your Booking</h1>
        <p className="text-gray-600 mb-6">
          Booking <span className="font-mono font-bold">{params.code}</span>
          {' — '}{booking.topic}, {booking.slot_display}
        </p>
        <BookingForm code={params.code} token={searchParams.token} />
      </div>
    </main>
  );
}
```

### 3.6 PII form component

**File:** [`phase-3-post-call-pii/components/PiiBookingForm.tsx`](../phase-3-post-call-pii/components/PiiBookingForm.tsx) (see also sketch below)

```tsx
const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email address'),
  phone: z.string().regex(/^\+?[\d\s-]{10,15}$/, 'Please enter a valid phone number'),
  account: z.string().optional(),
});

export function BookingForm({ code, token }: { code: string; token?: string }) {
  const router = useRouter();
  const { register, handleSubmit, formState: { errors, isSubmitting } } =
    useForm<FormData>({ resolver: zodResolver(schema) });

  async function onSubmit(data: FormData) {
    const res = await fetch(`/api/booking/${code}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, token }),
    });
    if (res.ok) {
      // Also show in-app toast / banner: "Confirmation email sent"
      router.push(`/${code}/confirmed`);
    }
    else if (res.status === 429) alert('Too many attempts. Please try again later.');
    else alert('Something went wrong. Please try again in a few minutes.');
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <FormField label="Full Name" error={errors.name?.message}
        {...register('name')} placeholder="Your full name" />
      <FormField label="Email Address" error={errors.email?.message}
        {...register('email')} type="email" placeholder="you@example.com" />
      <FormField label="Phone Number" error={errors.phone?.message}
        {...register('phone')} type="tel" placeholder="+91 98765 43210" />
      <FormField label="Account Number (optional)" error={errors.account?.message}
        {...register('account')} placeholder="Optional" />
      <SubmitButton loading={isSubmitting}>Submit Details</SubmitButton>
    </form>
  );
}
```

### 3.7 PII submission API — encrypt, send user email, notify UI

**Logic:** [`phase-3-post-call-pii/lib/postPiiSubmit.ts`](../phase-3-post-call-pii/lib/postPiiSubmit.ts) (`submitPiiViaMcp`) + [`rateLimitPiiSubmit.ts`](../phase-3-post-call-pii/lib/rateLimitPiiSubmit.ts) — **Route:** `app/api/booking/[code]/submit/route.ts`.

```typescript
export async function POST(request: NextRequest, { params }: { params: { code: string } }) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  const limited = await checkRateLimit(params.code, ip);
  if (limited) return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });

  const body = await request.json();
  const booking = await validateBookingCode(params.code, body.token);
  if (!booking) return NextResponse.json({ error: 'Invalid or expired booking code' }, { status: 404 });
  if (booking.pii_submitted) return NextResponse.json({ error: 'Details already submitted' }, { status: 409 });

  await submitPII(booking.id, {
    name: body.name, email: body.email, phone: body.phone, account: body.account,
  });
  await sendUserConfirmationEmail(booking, body.email);
  return NextResponse.json({ success: true, notification: 'Confirmation email sent.' }, { status: 201 });
}
```

**Rate limits:** 5 per booking code per hour + 100 per IP per hour. Maps to architecture.md § 8 rate limiting spec.

### 3.8 Deploy & Rollback (PII)

**Deploy (Phase 3 PII):**
1. `alembic upgrade head` or Prisma migrate (adds `pii_submissions`).
2. Vercel env: `DATABASE_URL`, `PII_ENCRYPTION_KEY` / `PII_ENCRYPTION_KEY_ARN`, `NEXT_PUBLIC_APP_URL` (your `*.vercel.app` URL is fine).
3. Gmail / send API credentials for **user** confirmation emails.

**Rollback:** Revert Vercel deployment; `alembic downgrade -1` only if you must drop the table. Encrypted PII at rest remains protected.

---

## Phase 4 — Browser Voice (no Twilio)

> **High-level context:** [architecture.md § 14, Backend Phase 4 (voice)](./architecture.md#backend--phase-4--browser-voice-pipeline-stt--tts-no-twilio)
> **Tests:** Phase 4 (future)
> **Evals:** Phase 4 (future)

**Goal:** Add **microphone → Deepgram → transcript → same Conversation Engine as Phase 1 → ElevenLabs → speaker**. Audio format is **browser-native** (e.g., linear16 / opus depending on Deepgram config) — **not** Twilio mulaw until the optional Twilio appendix.

### 4.1 Deepgram STT (browser streaming)

**File:** `lib/voice/stt.ts`

**Protocol:** WebSocket to Deepgram live streaming. Parameters must match **browser-captured** encoding (often `linear16` at 16kHz or `opus` — choose one and document).

**Behavior:** Stream audio chunks from `MediaRecorder` or `AudioWorklet`; push partials/finals to the Agent API or process in-route; call `process_transcript` only on **final** segments (or your end-of-utterance policy).

### 4.2 ElevenLabs TTS (playback in browser)

**File:** `lib/voice/tts.ts`

**Protocol:** REST streaming `POST /v1/text-to-speech/{voice_id}/stream` with an output format browsers can decode (e.g., **mp3** or **pcm** — not ulaw unless you standardize on it).

**Behavior:** Assistant text from the engine is synthesized and played via Web Audio or `<audio>`; ensure **disclaimer** plays within first voice response window (G5).

### 4.3 Agent route for audio (optional shapes)

**File:** `app/api/agent/stream/route.ts` — WebSocket or chunked `POST` — forwards to STT, then engine, then TTS. **Twilio is not in this path.**

### 4.4 Deploy & Rollback (Phase 4)

**Deploy:** Add `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` to Vercel. Keep **Node runtime** for streaming routes.

**Rollback:** Revert deployment; Phase 1 text route remains usable.

---

## Cumulative Database Migration Order

**Sheets-first milestone:** booking rows live in **Google Sheets**, not necessarily PostgreSQL — treat the table below as **optional** if you adopt SQL.

| Migration | Phase | Tables created | Depends on |
|-----------|-------|---------------|------------|
| `001_create_booking_tables.py` | 2 alt | `bookings`, `calendar_holds` | — |
| `002_add_notes_email_tables.py` | 2 legacy sketch | `notes_entries`, `email_drafts` | 001 |
| `003_add_pii_submissions.py` | 3 | `pii_submissions` | 001 |

**Full upgrade:** `alembic upgrade head`
**Full rollback:** `alembic downgrade base` (drops all tables — use only in dev)

---

## Optional — Twilio telephony (later)

**When:** After **Phase 4** browser voice is stable. **Do not** provision Twilio for Phases 1–4 core work.

**Pattern:** Twilio **Media Streams** → same **Deepgram / ElevenLabs** clients as the browser, but with **mulaw 8 kHz** wire format (see earlier FastAPI sketches in git history or below).

**Endpoints:** `POST /voice/incoming` (TwiML), `WebSocket /voice/stream` (bidirectional audio).

**Env:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, public hostname for webhooks (can be your `*.vercel.app` if Twilio can reach it, or a small relay).

**Sketch — TwiML (Python FastAPI style):**

```python
# optional/twilio/twilio_handler.py — illustrative
@router.post("/voice/incoming")
async def incoming_call(request: Request):
    response = VoiceResponse()
    connect = Connect()
    stream = Stream(url=f"wss://{settings.PUBLIC_HOST}/voice/stream")
    connect.append(stream)
    response.append(connect)
    return Response(content=str(response), media_type="application/xml")
```

---

## Open Questions (low-level)

| Question | Owner | Notes |
|----------|-------|--------|
| On PII submit, should the advisor receive an **automatic** send (in addition to the user confirmation email), or is the **Gmail draft** from Phase 2 MCP enough until manual send? | Product | Affects MCP `send_*` tool split |
| ElevenLabs voice ID — brand fit? | Design | Before Phase 4 polish |
| Twilio number / region for IST (when enabled)? | Platform | Only when optional Twilio phase starts |
| PII key management — KMS vs env-only for small scale? | Security | Phase 3 PII |

Aligned with [architecture.md § 15](./architecture.md#15-open-questions).

---

## Change Log

| Date | Document | Change | Author |
|------|----------|--------|--------|
| 2026-04-12 | Both | Initial creation — architecture.md (high-level) + low-level-architecture.md (implementation) | — |
| 2026-04-12 | Both | Browser-first text → voice; real Google Calendar; optional PII + user email; Twilio deferred; Vercel hosting | — |
| 2026-04-12 | Both | §14 merge: Phase 3 = MCP (scheduling + side-effects); Phase 4 = PII; Next uses MCP client only for booking path; low-level synced | — |
| 2026-04-12 | Both | Delivery order 1→3→4→2; folder↔phase mapping table; FastMCP as target MCP implementation; TS server = reference | — |
| 2026-04-12 | Both | §14 + low-level: phases renumbered to implementation order (1 text, 2 MCP, 3 PII, 4 voice); §14 subsection order matches | — |
