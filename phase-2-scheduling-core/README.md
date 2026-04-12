# Phase 2 — Scheduling & booking (MCP)

> Real **Google Calendar** slots, **Sheets** rows, **booking codes**, and **Gmail** drafts — exposed to the Next.js app only through an **MCP** (Model Context Protocol) server. Maps to [Docs/architecture.md](../Docs/architecture.md) §14 Phase 2 and [Docs/low-level-architecture.md](../Docs/low-level-architecture.md) Phase 2.

## What is this folder?

This package holds the **scheduling backend**: the MCP server that owns `googleapis` for Calendar, Sheets, and Gmail on the booking paths. The **Next.js app at the repo root** never imports `googleapis` for those flows — it calls tools through `@/lib/mcp/*`, which talks to this server.

## What it does (features)

- **`offer_slots`** — Returns two free slots from Google Calendar (timezone-aware), or a waitlist path with a `Bookings` row when nothing fits.
- **`confirm_booking`** — Calendar hold, `Bookings` sheet row, advisor pre-booking line, and optional **Gmail draft** when Workspace delegation is set up.
- **`submit_pii_booking`** — Post-call PII: encrypted storage, calendar update, user and advisor email (used from Phase 3 UI as well).

## Project layout (this directory)

| Path | Role |
|------|------|
| **`mcp/advisor-mcp-server.ts`** | Main **stdio MCP server** — register tools here; imports Google helpers from `src/`. |
| **`src/`** | Calendar, Sheets, booking codes, Gmail, PII crypto — **server-side only**. |
| **`mcp-client/`** | TypeScript MCP **client** used by the root app via `lib/mcp/` re-exports. |
| **`fastmcp_server/`** | Optional **Python FastMCP** bridge — same tool names, delegates to TS. See [fastmcp_server/README.md](./fastmcp_server/README.md). |
| **`scripts/mcp-one-shot-call.mts`** | Single tool invocation helper (e.g. for the Python bridge). |

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ and `npm`
- Google **service account** JSON and a shared **Calendar** + **Spreadsheet** (see root `.env.example`)
- For Gmail drafts/sends: Workspace **domain-wide delegation** with the right Gmail scopes (documented in `.env.example`)

## Environment variables

All variables are documented in the repository root **[`.env.example`](../.env.example)**. Phase 2 typically needs:

- `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CALENDAR_ID`, `GOOGLE_SHEETS_SPREADSHEET_ID`
- Optional: `GOOGLE_SHEETS_TAB_BOOKINGS`, `GOOGLE_SHEETS_TAB_ADVISOR_PREBOOKINGS`, `ADVISOR_TIMEZONE`, `SLOT_DURATION_MINUTES`
- Gmail: `GMAIL_DELEGATED_USER`, `ADVISOR_INBOX_EMAIL` (plus delegation setup)

## Google Sheets — `Bookings` header row

Share the spreadsheet with the **service account email** (Editor). Row 1 columns:

`booking_code` | `topic` | `slot_time` | `slot_display` | `status` | `google_event_id` | `side_effects_completed` | `secure_link_token` | `pii_submitted` | `created_at` | `updated_at`

## Install dependencies (this folder)

From **`phase-2-scheduling-core/`**:

```bash
npm install
```

## Run the MCP server locally

```bash
cd phase-2-scheduling-core
npm run mcp:server
```

This is a **stdio** server — in normal development the **Next.js app** starts it as a child process. You usually run this command only when **debugging** the server on its own.

## Optional Python bridge

If you need a Python MCP host, read [fastmcp_server/README.md](./fastmcp_server/README.md) and set `MCP_ADVISOR_SERVER_ENTRY` to your launcher.

## Quality and design notes

- [tests.md](./tests.md) — test cases
- [evals.md](./evals.md) — evaluation notes
- [implementation.md](./implementation.md) — deeper build notes

## Related

- Main app setup: [../README.md](../README.md)
- Architecture: [../Docs/architecture.md](../Docs/architecture.md)
