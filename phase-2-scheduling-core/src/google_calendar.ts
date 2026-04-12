import { google } from "googleapis";
import { DateTime } from "luxon";

import { getAdvisorTimezone, getSlotDurationMinutes } from "./env";
import { getOAuthClient } from "./google_auth";
import type { OfferedSlot } from "./types";

function calendarId(): string {
  const id = process.env.GOOGLE_CALENDAR_ID?.trim();
  if (!id) throw new Error("GOOGLE_CALENDAR_ID is not set");
  return id;
}

/**
 * Map natural language to local hour range [startHour, endHour) in advisor TZ.
 * End hour is exclusive for Luxon windowEnd; keep end at least last_slot_end + 1h for 30m slots
 * (e.g. evening through 9 PM IST needs end >= 22).
 */
function timePreferenceToHours(pref: string): { start: number; end: number } {
  const p = pref.toLowerCase();
  // Explicit late times (9 PM, 10 PM, 21:00, etc.) — search a late window
  if (
    /\b9\s*pm\b/.test(p) ||
    /\b10\s*pm\b/.test(p) ||
    /\b21\s*:?\d{0,2}\b/.test(p) ||
    /\b22\s*:?\d{0,2}\b/.test(p)
  ) {
    return { start: 18, end: 23 };
  }
  if (p.includes("morning")) return { start: 9, end: 12 };
  if (p.includes("afternoon")) return { start: 12, end: 17 };
  // "Evening" includes typical post-work up to ~9 PM IST (was 17–20, which excluded 9 PM).
  if (p.includes("evening")) return { start: 17, end: 23 };
  if (p.includes("night")) return { start: 19, end: 23 };
  // default business window
  return { start: 9, end: 18 };
}

/** Resolve "today" | "tomorrow" | ISO-ish date to a Luxon start-of-day in TZ */
function resolveDayStart(day: string, tz: string): DateTime {
  const d = day.trim().toLowerCase();
  const now = DateTime.now().setZone(tz).startOf("day");
  if (d === "today") return now;
  if (d === "tomorrow") return now.plus({ days: 1 });
  const parsed = DateTime.fromISO(day, { zone: tz });
  if (parsed.isValid) return parsed.startOf("day");
  // try common patterns
  const alt = DateTime.fromFormat(day, "d MMM yyyy", { zone: tz });
  if (alt.isValid) return alt.startOf("day");
  return now.plus({ days: 1 });
}

function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Query free/busy and return up to two non-overlapping free slots within the day window.
 */
export async function getAvailableSlots(input: {
  topic: string;
  day: string;
  time_preference: string;
}): Promise<{ slots: OfferedSlot[]; waitlist: boolean; detail?: string }> {
  void input.topic;
  const tz = getAdvisorTimezone();
  const slotMinutes = getSlotDurationMinutes();
  const dayStart = resolveDayStart(input.day, tz);
  const { start: h0, end: h1 } = timePreferenceToHours(input.time_preference);

  const windowStart = dayStart.set({ hour: h0, minute: 0, second: 0, millisecond: 0 });
  const windowEnd = dayStart.set({ hour: h1, minute: 0, second: 0, millisecond: 0 });

  const timeMin = windowStart.toUTC().toJSDate();
  const timeMax = windowEnd.toUTC().toJSDate();

  if (timeMax <= timeMin) {
    return { slots: [], waitlist: true, detail: "Invalid time window" };
  }

  const auth = await getOAuthClient();
  const calId = calendarId();

  const cal = google.calendar({ version: "v3", auth });

  const fb = await cal.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: calId }],
    },
  });

  const busyRaw = fb.data.calendars?.[calId]?.busy ?? [];
  const busy = busyRaw
    .map((b) => ({
      start: new Date(b.start as string),
      end: new Date(b.end as string),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const slots: OfferedSlot[] = [];
  let cursor = new Date(timeMin.getTime());
  const slotMs = slotMinutes * 60 * 1000;

  while (cursor.getTime() + slotMs <= timeMax.getTime() && slots.length < 2) {
    const candEnd = new Date(cursor.getTime() + slotMs);
    const hit = busy.some((b) => overlaps(cursor, candEnd, b.start, b.end));
    if (!hit) {
      const startIso = cursor.toISOString();
      const endIso = candEnd.toISOString();
      const startLux = DateTime.fromJSDate(cursor).setZone(tz);
      const display = `${startLux.toFormat("ccc d LLL yyyy")}, ${startLux.toFormat("h:mm a")} IST`;
      slots.push({
        key: startIso,
        display,
        startIso,
        endIso,
      });
      cursor = candEnd;
    } else {
      cursor = new Date(cursor.getTime() + 15 * 60 * 1000);
    }
  }

  if (slots.length === 0) {
    return {
      slots: [],
      waitlist: true,
      detail: "No contiguous free window in the requested range",
    };
  }

  return { slots, waitlist: false };
}

/**
 * Create a tentative calendar hold for a confirmed booking.
 */
export async function createCalendarHold(input: {
  topic: string;
  bookingCode: string;
  startIso: string;
  endIso: string;
}): Promise<string> {
  const auth = await getOAuthClient();
  const cal = google.calendar({ version: "v3", auth });
  const tz = getAdvisorTimezone();
  const calId = calendarId();

  const start = DateTime.fromISO(input.startIso, { setZone: true }).setZone(tz);
  const end = DateTime.fromISO(input.endIso, { setZone: true }).setZone(tz);
  const fmt = "yyyy-MM-dd'T'HH:mm:ss";

  const res = await cal.events.insert({
    calendarId: calId,
    requestBody: {
      summary: `Advisor consultation — ${input.topic} (${input.bookingCode})`,
      description: `Booking code: ${input.bookingCode}\nTopic: ${input.topic}`,
      start: { dateTime: start.toFormat(fmt), timeZone: tz },
      end: { dateTime: end.toFormat(fmt), timeZone: tz },
      transparency: "opaque",
    },
  });

  const id = res.data.id;
  if (!id) throw new Error("Calendar events.insert returned no id");
  return id;
}

/**
 * Add user as attendee and append a short non-sensitive note to the event description.
 */
export async function patchCalendarEventForPiiSubmit(input: {
  eventId: string;
  userEmail: string;
  note: string;
}): Promise<void> {
  const auth = await getOAuthClient();
  const cal = google.calendar({ version: "v3", auth });
  const calId = calendarId();
  const existing = await cal.events.get({
    calendarId: calId,
    eventId: input.eventId,
  });
  const prevDesc = existing.data.description ?? "";
  const newDesc = `${prevDesc}\n\n---\nPII submitted via app.\n${input.note}`;
  const seen = new Set<string>();
  const attendees = (existing.data.attendees ?? [])
    .filter((a) => a.email)
    .map((a) => {
      const e = String(a.email).toLowerCase();
      seen.add(e);
      return { email: a.email };
    });
  const u = input.userEmail.trim().toLowerCase();
  if (u && !seen.has(u)) {
    attendees.push({ email: input.userEmail.trim() });
  }
  await cal.events.patch({
    calendarId: calId,
    eventId: input.eventId,
    requestBody: {
      description: newDesc,
      attendees,
    },
  });
}
