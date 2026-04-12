# Phase 2 — Implementation

> **Source of truth:** [Docs/architecture.md](../Docs/architecture.md) §14 Phase 2, [Docs/low-level-architecture.md](../Docs/low-level-architecture.md) § Phase 2. **Env:** repository root `.env` (loaded by `next.config.mjs` at repo root).

## What you build

### MCP server + Google adapters (`phase-2-scheduling-core/`)

1. **`src/google_calendar.ts`** — `freebusy.query`; contiguous free windows of `SLOT_DURATION_MINUTES`; **exactly two** slots when possible; **Luxon** + `ADVISOR_TIMEZONE`. **No mock lists.**
2. **`src/google_sheets.ts`** — `Bookings`, Advisor Pre-Bookings, PII submissions tab; row updates by booking code.
3. **`src/booking_code.ts`** — `NL-[A-Z][0-9]{3}` with collision retries.
4. **`src/google_auth.ts`** — Service account OAuth for Calendar + Sheets scopes.
5. **`src/gmail_send.ts`** — `gmail.send` + **`gmail.compose`** (drafts at booking via `users.drafts.create`).
6. **`mcp/advisor-mcp-server.ts`** — Registers MCP tools; orchestrates side-effects and `side_effects_completed` on the sheet.

### Next.js integration (repo root)

- **`lib/mcp/*`** — Thin re-exports of **`phase-2-scheduling-core/mcp-client/`** (MCP stays “in the Phase 2 folder” per repo layout).
- **`lib/agent/toolHandlers.ts`** — `offer_slots` / `confirm_booking` → `callAdvisorMcpTool`.
- **`app/api/booking/[code]/submit/route.ts`** — `submit_pii_booking` via MCP only.

### Optional FastMCP (Python)

- **`fastmcp_server/`** — Delegates to the TS server; see `fastmcp_server/README.md`.

## Rollback

- Revert the Vercel deployment; Sheets rows already written remain.
