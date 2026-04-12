# Phase 3 — Post-call PII and dual email

> After the chat agent issues a **booking code**, the user completes **contact details** on a separate page. This folder holds the libraries and UI pieces; routes live under **`app/booking/`** and **`app/api/booking/`** at the repo root. Maps to [Docs/architecture.md](../Docs/architecture.md) §14 — Backend Phase 3.

## What problem does this solve?

Sensitive personal information should not be collected inside the open-ended LLM chat. Instead, the agent gives a **booking code** and a **secure link**. The user opens `/booking/[code]?token=...`, submits a form, and the backend calls MCP’s **`submit_pii_booking`** to update Sheets, the calendar event, and send emails — **without** putting `googleapis` in the Next.js bundle for those writes.

## What’s in `phase-3-post-call-pii/`?

| Path | Role |
|------|------|
| **`lib/postPiiSubmit.ts`** | `submitPiiViaMcp` — calls `submit_pii_booking` on the MCP server. |
| **`lib/rateLimitPiiSubmit.ts`** | Rate limits per booking code and per IP before processing the body. |
| **`lib/lookupBookingForPiiPage.ts`** | Server-side validation via `lookup_pii_booking` MCP tool. |
| **`components/PiiBookingForm.tsx`** | Client form posting to `POST /api/booking/[code]/submit`. |

## MCP tools (implemented in Phase 2 server)

- **`lookup_pii_booking`** — Read-only check that the code + token are valid for showing the form.
- **`submit_pii_booking`** — Encrypt PII row, update `Bookings`, patch Calendar, send user and advisor email.

## User flow (step by step)

1. User finishes booking in the agent; the API returns **`bookingCode`** and **`secureLinkToken`**. The token is **not** sent back to the LLM in tool payloads (it stays server-side / in the API response to the client).
2. User opens **`/booking/[code]?token=<uuid>`** (link from the agent UI).
3. User submits the form → Next route → MCP handles Google side effects.

## Prerequisites

- Phase 2 MCP and Google env vars configured (see [phase-2-scheduling-core/README.md](../phase-2-scheduling-core/README.md))
- Phase 3 env vars in root **`.env`**: e.g. `PII_ENCRYPTION_KEY`, Gmail delegation, `GOOGLE_SHEETS_TAB_PII` — all listed in [`.env.example`](../.env.example)

## How to run locally

Run the **main Next.js app** from the repository root (this folder is imported as `@/phase-3-post-call-pii/...`):

```bash
cd ..   # repo root if you are inside phase-3-post-call-pii
npm install
npm run dev
```

Then visit a valid booking URL as described above.

## Imports and paths

- The Next app and this folder both live at the **repo root**; `tsconfig` maps `@/*` to `./*`, so imports like `@/phase-3-post-call-pii/...` and `@/lib/mcp/schedulingMcpClient` resolve correctly.

## Related docs

- [tests.md](./tests.md)
- [evals.md](./evals.md)
- [implementation.md](./implementation.md)
- Root README: [../README.md](../README.md)
