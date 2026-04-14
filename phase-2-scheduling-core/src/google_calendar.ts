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
/** When the user has not specified a time-of-day window, scan a full working day (IST). */
function isUnspecifiedDayPreference(pref: string): boolean {
  const p = pref.trim().toLowerCase();
  if (!p) return true;
  return /^(any|unspecified|no\s*preference|any\s*time|full\s*day|whenever|flexible|whole\s*day)$/i.test(
    p
  );
}

function timePreferenceToHours(pref: string): { start: number; end: number } {
  if (isUnspecifiedDayPreference(pref)) {
    return { start: 9, end: 22 };
  }
  const p = pref.toLowerCase();

  // Specific hour (e.g. "3 pm", "3pm", "15:00", "3:30 pm"): center a 3-hour window around it
  const hourMatch =
    p.match(/\b(\d{1,2})\s*(?::?\d{2})?\s*(am|pm)\b/i) ||
    p.match(/\b(\d{1,2}):(\d{2})\b/);
  if (hourMatch) {
    let h = parseInt(hourMatch[1], 10);
    const ampm = hourMatch[2]?.toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    if (!ampm && h >= 1 && h <= 7) h += 12; // bare "3" likely means 3 PM
    const start = Math.max(9, h - 1);
    const end = Math.min(23, h + 2);
    return { start, end };
  }

  if (p.includes("morning")) return { start: 9, end: 12 };
  if (p.includes("afternoon")) return { start: 12, end: 17 };
  if (p.includes("evening")) return { start: 17, end: 23 };
  if (p.includes("night")) return { start: 19, end: 23 };
  return { start: 9, end: 18 };
}

/** Resolve "today" | "tomorrow" | ISO-ish date to a Luxon start-of-day in TZ */
function resolveDayStart(day: string, tz: string): DateTime {
  const d = day.trim().toLowerCase();
  const now = DateTime.now().setZone(tz).startOf("day");
  if (d === "today") return now;
  if (d === "tomorrow") return now.plus({ days: 1 });
  if (
    d === "day after tomorrow" ||
    d === "the day after tomorrow" ||
    d === "after tomorrow"
  ) {
    return now.plus({ days: 2 });
  }
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
 * True if the advisor calendar has no busy blocks overlapping [startIso, endIso).
 */
export async function isSlotFree(startIso: string, endIso: string): Promise<boolean> {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end <= start
  ) {
    return false;
  }
  const auth = await getOAuthClient();
  const calId = calendarId();
  const cal = google.calendar({ version: "v3", auth });
  const fb = await cal.freebusy.query({
    requestBody: {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      items: [{ id: calId }],
    },
  });
  const busy = fb.data.calendars?.[calId]?.busy ?? [];
  return busy.length === 0;
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

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
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
    } catch (e) {
      lastErr = e;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Delete (cancel) a calendar event by its id. Returns true if deleted; false if not found.
 */
export async function deleteCalendarEvent(eventId: string): Promise<boolean> {
  const auth = await getOAuthClient();
  const cal = google.calendar({ version: "v3", auth });
  const calId = calendarId();
  try {
    await cal.events.delete({ calendarId: calId, eventId });
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("404") || msg.includes("Not Found")) return false;
    throw e;
  }
}

function googleApiErrors(err: unknown): { reason?: string; message?: string }[] {
  const e = err as {
    errors?: { reason?: string; message?: string }[];
    response?: { data?: { error?: { errors?: { reason?: string; message?: string }[] } } };
  };
  const top = e.errors;
  if (Array.isArray(top) && top.length > 0) return top;
  const nested = e.response?.data?.error?.errors;
  if (Array.isArray(nested) && nested.length > 0) return nested;
  return [];
}

function isServiceAccountAttendeeForbidden(err: unknown): boolean {
  if (
    googleApiErrors(err).some((x) => x.reason === "forbiddenForServiceAccounts")
  ) {
    return true;
  }
  const e = err as { message?: string };
  const m = e?.message ?? String(err);
  return m.includes("Service accounts cannot invite attendees");
}

/**
 * Add user as attendee and append a short non-sensitive note to the event description.
 * Consumer Gmail calendars: service accounts cannot add attendees without domain-wide delegation;
 * in that case we only update the description (contact email is recorded there).
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
  const contactLine = `Contact email: ${input.userEmail.trim()}`;
  const newDesc = `${prevDesc}\n\n---\nPII submitted via app.\n${input.note}\n${contactLine}`;
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
  try {
    await cal.events.patch({
      calendarId: calId,
      eventId: input.eventId,
      requestBody: {
        description: newDesc,
        attendees,
      },
    });
  } catch (e) {
    if (!isServiceAccountAttendeeForbidden(e)) throw e;
    console.warn(
      "[patchCalendarEventForPiiSubmit] Skipping attendee add (service account); description-only update."
    );
    await cal.events.patch({
      calendarId: calId,
      eventId: input.eventId,
      requestBody: {
        description: newDesc,
      },
    });
  }
}
