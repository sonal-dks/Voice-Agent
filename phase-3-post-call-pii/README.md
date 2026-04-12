# Phase 3 — Post-call PII & dual email

> **Maps to** [Docs/architecture.md](../Docs/architecture.md) §14 — Backend Phase 3.

All **Phase 3** source for the secondary PII flow lives in **`phase-3-post-call-pii/`** at the repo root.

**Next.js:** The Next app also lives at the repo root, so `@/phase-3-post-call-pii/...` imports resolve directly (tsconfig `@/*` → `./*`). App routes live under `app/booking/` and `app/api/booking/`.

**MCP client imports:** Phase 3 `lib/*.ts` use `@/lib/mcp/schedulingMcpClient` (repo-root re-export of Phase 2) so paths stay valid.

## Contents

| Path | Role |
|------|------|
| **`lib/postPiiSubmit.ts`** | `submitPiiViaMcp` — calls `submit_pii_booking` (no `googleapis` in Next). |
| **`lib/rateLimitPiiSubmit.ts`** | `checkPiiSubmitRateLimits` — per-code and per-IP sliding window (run before body parse in the route). |
| **`lib/lookupBookingForPiiPage.ts`** | Server-side: `lookup_pii_booking` MCP tool for `/booking/[code]?token=`. |
| **`components/PiiBookingForm.tsx`** | Client form → `POST /api/booking/[code]/submit`. |

## MCP tools (implemented in Phase 2 server)

- **`lookup_pii_booking`** — Read-only validation for the PII page.
- **`submit_pii_booking`** — Encrypt row, update Bookings, calendar patch, user + advisor email.

## User flow

1. After booking, the agent API returns `bookingCode` + `secureLinkToken` (token is **not** included in Gemini tool responses).
2. User opens **`/booking/[code]?token=<uuid>`** (link shown on the agent page).
3. Submit → MCP handles Google side-effects.

## Related

- Tests: [tests.md](./tests.md)
- Evals: [evals.md](./evals.md)
- Env: `PII_ENCRYPTION_KEY`, Gmail delegation, `GOOGLE_SHEETS_TAB_PII` — see repo root `.env.example`.
