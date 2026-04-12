# Phase 2 — Expected outputs

> **Aligned with [Docs/architecture.md](../Docs/architecture.md) §14 — Backend — Phase 2.**

## When Phase 2 is “done”

| Output | Check |
|--------|--------|
| Two **live** slots from **Google Calendar** in **IST** after topic + day/time preference | Manual: [tests.md](./tests.md) TC-3-01 |
| **Booking code** `NL-[A-Z][0-9]{3}` + row in **Bookings** sheet after confirmation | TC-3-02, TC-3-04 |
| **Waitlist** path when no free window — real code + `status=waitlisted`, no invented times | TC-3-03 |
| **Calendar event** created on confirm (`google_event_id` populated when API succeeds) | Inspect Sheet + Calendar UI |
| **UI-2**: user sees **Booking ID** panel when server returns `bookingCode` | Browser `/agent` |

## Artefacts in this folder

- **`src/*.ts`** — scheduling implementation imported by the Phase 1 Next app.
- **`package.json`** — local deps so `src/` typechecks independently of the app.

## Not in Phase 2

- **MCP** tool server (Phase 3).
- **Advisor Pre-Bookings** append + **Gmail drafts** (Phase 3).
- **Post-call PII** (Phase 4).
- **Browser STT/TTS** (Phase 5).
