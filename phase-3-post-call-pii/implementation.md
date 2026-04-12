# Phase 3 — Implementation notes

## Rules

- **MCP-only** for Sheets / Calendar / Gmail on submit and lookup (architecture §14).
- **Do not** pass `secure_link_token` in Gemini `functionResponse` payloads — strip in `toolHandlers.ts` after copying to session.
- `phase-3-post-call-pii/` sits at repo root alongside the Next.js app (no symlink needed).
- Phase 3 **server libs** import MCP via `@/lib/mcp/schedulingMcpClient` (not `../../phase-2/...`) so TypeScript works when files are reached through the symlink.

## Next.js wiring

- `app/booking/[code]/page.tsx` — Server Component; calls `lookupBookingForPiiPage`, renders `PiiBookingForm`.
- `app/booking/[code]/confirmed/page.tsx` — Success / in-app confirmation copy.
- `app/booking/invalid/page.tsx` — Bad or incomplete links.
- `app/api/booking/[code]/submit/route.ts` — `checkPiiSubmitRateLimits`, zod, then `submitPiiViaMcp`.

## Agent API

- `POST /api/agent/message` returns `secureLinkToken` alongside `bookingCode` when the MCP tools issued a token (waitlist or confirm).
