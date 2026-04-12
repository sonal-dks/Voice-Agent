# Phase 2 — MCP scheduling & booking (single folder)

> **Maps to** [Docs/architecture.md](../Docs/architecture.md) §14 — Backend Phase 2 (MCP) and [Docs/low-level-architecture.md](../Docs/low-level-architecture.md) § Phase 2.

All **Phase 2** implementation artifacts for scheduling live under **`phase-2-scheduling-core/`**:

| Path | Role |
|------|------|
| **`mcp/advisor-mcp-server.ts`** | **Canonical** stdio MCP server — `offer_slots`, `confirm_booking`, `submit_pii_booking`; **only** place that uses `googleapis` for Calendar / Sheets / Gmail on these paths. |
| **`src/`** | Google Calendar, Sheets, booking codes, Gmail send/draft, PII crypto — imported by the MCP server. |
| **`mcp-client/`** | Next.js MCP **client** (`schedulingMcpClient.ts`, `schedulingTypes.ts`) — re-exported from `lib/mcp/*` at the repo root so the app stays on `@/lib/mcp/...` imports. |
| **`fastmcp_server/`** | Optional **FastMCP (Python)** bridge that delegates each tool to the TS server (same behavior, higher latency). |
| **`scripts/mcp-one-shot-call.mts`** | One tool invocation (used by the Python bridge). |

The **Next.js app** (repo root) owns the conversation engine and calls Phase 2 **only** through the MCP client — **no** `googleapis` in the Next bundle for booking or PII submit.

## Tools (MCP)

- **`offer_slots`** — Two real free slots from Google Calendar (**IST**), or waitlist + `Bookings` row.
- **`confirm_booking`** — Tentative Calendar hold, `Bookings` row, **Advisor Pre-Bookings** line, **Gmail draft** to `ADVISOR_INBOX_EMAIL` when delegation is configured; updates `side_effects_completed` when calendar + pre-bookings + (draft or skipped) succeed.
- **`submit_pii_booking`** — Post-call PII (encrypted row, calendar patch, emails); same MCP-only rule as architecture §14.

## Google Sheets — `Bookings` row 1 headers

`booking_code` | `topic` | `slot_time` | `slot_display` | `status` | `google_event_id` | `side_effects_completed` | `secure_link_token` | `pii_submitted` | `created_at` | `updated_at`

Share the spreadsheet with the **service account** email (Editor).

## Environment variables

See repository root **[`.env.example`](../.env.example)**. Phase 2 needs at minimum:

- `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CALENDAR_ID`, `GOOGLE_SHEETS_SPREADSHEET_ID`
- Optional tabs / timezone: `GOOGLE_SHEETS_TAB_BOOKINGS`, `GOOGLE_SHEETS_TAB_ADVISOR_PREBOOKINGS`, `ADVISOR_TIMEZONE`, `SLOT_DURATION_MINUTES`
- Gmail (draft at booking + send on PII): `GMAIL_DELEGATED_USER`, `ADVISOR_INBOX_EMAIL` — Workspace **domain-wide delegation** must include **`gmail.send`** and **`gmail.compose`**.

## Run MCP server locally

```bash
cd phase-2-scheduling-core
npm install
npm run mcp:server
```

(Stdio server — typically started by the Next client, not used standalone in a terminal unless you are debugging.)

## Optional Python FastMCP

See **[fastmcp_server/README.md](./fastmcp_server/README.md)**.

## Exit criteria

- [tests.md](./tests.md)
- [evals.md](./evals.md)

## Related docs

- [implementation.md](./implementation.md) — build notes
- Next.js app (repo root): [../](../)
