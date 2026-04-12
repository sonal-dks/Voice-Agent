# Phase 3 — Manual Test Cases

> **Storage:** All booking state is in **Google Sheets** (`Bookings` tab). **Preconditions:** [`.env.example`](../.env.example) variables set on the deployment under test; **Calendar** and **Sheets** shared with the service account.

## Pre-conditions

- Next.js app deployed (e.g. Vercel Preview URL) with Phase 3 code.
- `GET /api/health` returns OK (if implemented).
- **Bookings** sheet has header row; test calendar has **free** windows for “tomorrow afternoon” (or adjust steps to match your seed data).

```bash
export HOST=https://your-preview.vercel.app   # no trailing slash

curl -s "$HOST/api/health"
# Expected: 200 JSON with status ok (if route exists)
```

**Optional — verify empty or known row count:** Open the spreadsheet in Google Sheets, or use a one-off script with `googleapis` to count rows in `Bookings` (excluding header).

---

## Backend / API Tests (browser agent — text first)

Assume **text** path: `POST /api/agent/message` with `{ "sessionId": "test-session", "text": "..." }` unless you are testing voice.

### TC-3-01: Two slots offered for topic + time preference

**Verifies:** Agent returns exactly **two** slots in **IST** for the requested day window.

**Setup:** Clean session id; calendar has ≥2 free slots tomorrow afternoon.

**Steps (example utterances):**

1. Send: intent to book + topic, e.g. *"I want to book KYC onboarding."*
2. After topic confirmation, send: *"Tomorrow afternoon."*

**Expected:**

- Assistant message lists **exactly two** slot options.
- Wording includes **IST** and a full date.
- Slots match **live** Calendar free/busy (not static mock times).

**Fail hints:** Wrong count → cap at 2 in slot builder; wrong TZ → `ADVISOR_TIMEZONE` / IST formatting.

---

### TC-3-02: Booking confirmed with code and IST repeat

**Verifies:** After slot choice, assistant returns `NL-[A-Z][0-9]{3}` and repeats slot in IST; mentions completing contact details on the site (no PII in chat).

**Steps:**

1. From TC-3-01, send: *"The first slot please"* (or equivalent).

**Expected:**

- Regex `NL-[A-Z]\d{3}` in assistant text.
- Same slot as chosen, with IST/date.
- Copy for post-call form / booking code — no email or phone collected.

**Fail hints:** Code generation → `booking_code.ts` + Sheets uniqueness.

---

### TC-3-03: Waitlist when no slots

**Verifies:** If no slots match, agent explains waitlist and gives a **waitlist** `booking_code` (still `NL-…`); **Bookings** row has `status=waitlisted`.

**Setup:** Use a day/window with **no** free slots (busy calendar or extreme filter), or a dedicated test calendar.

**Steps:**

1. Request booking for that window.

**Expected:**

- No fake slot times.
- Waitlist code spoken or typed.
- New **Sheets** row: `status` = `waitlisted`.

**Fail hints:** Engine still offers slots → availability query or filters wrong.

---

### TC-3-04: Bookings row persisted (Sheets)

**Verifies:** After TC-3-02, a row exists with correct fields.

**Steps:**

1. Note the booking code from the assistant (e.g. `NL-A742`).
2. In **Google Sheets**, find the row where `booking_code` = `NL-A742` (filter UI or **Data → Filter**).

**Expected columns (values):**

| Column | Expected |
|--------|----------|
| `booking_code` | Matches assistant |
| `topic` | Matches conversation |
| `status` | `confirmed` |
| `pii_submitted` | `FALSE` |
| `side_effects_completed` | `FALSE` (until Phase 4 completes MCP) |
| `slot_display` | IST string as offered |

**Fail hints:** No row → `appendBookingRow` not called; wrong topic → tool args mapping.

---

## Aggregate checks (after suite)

- **Bookings** tab: count rows with `status = confirmed` and `status = waitlisted` matches tests run.
- No requirement to query PostgreSQL — there is none in the default stack.
