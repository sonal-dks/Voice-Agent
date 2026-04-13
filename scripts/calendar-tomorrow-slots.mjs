/**
 * List all free slot-sized windows tomorrow for GOOGLE_CALENDAR_ID (Free/Busy API).
 * Usage: node scripts/calendar-tomorrow-slots.mjs
 */
import nextEnv from "@next/env";
import { DateTime } from "luxon";
import { google } from "googleapis";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

function parseServiceAccountJson() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  try {
    return JSON.parse(raw);
  } catch {
    try {
      const decoded = Buffer.from(raw, "base64").toString("utf8");
      return JSON.parse(decoded);
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON must be minified JSON or base64");
    }
  }
}

async function getOAuthClient() {
  const creds = parseServiceAccountJson();
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return auth.getClient();
}

function calendarId() {
  const id = process.env.GOOGLE_CALENDAR_ID?.trim();
  if (!id) throw new Error("GOOGLE_CALENDAR_ID is not set");
  return id;
}

function getAdvisorTimezone() {
  return process.env.ADVISOR_TIMEZONE?.trim() || "Asia/Kolkata";
}

function getSlotDurationMinutes() {
  const n = Number(process.env.SLOT_DURATION_MINUTES);
  return Number.isFinite(n) && n >= 15 && n <= 120 ? n : 30;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

async function main() {
  const tz = getAdvisorTimezone();
  const slotMinutes = getSlotDurationMinutes();
  const calId = calendarId();

  const tomorrow = DateTime.now().setZone(tz).plus({ days: 1 }).startOf("day");
  const timeMin = tomorrow.toUTC().toJSDate();
  const timeMax = tomorrow.endOf("day").toUTC().toJSDate();

  const auth = await getOAuthClient();
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
      start: new Date(b.start),
      end: new Date(b.end),
    }))
    .sort((a, b) => a.start - b.start);

  const slots = [];
  let cursor = new Date(timeMin.getTime());
  const slotMs = slotMinutes * 60 * 1000;

  while (cursor.getTime() + slotMs <= timeMax.getTime()) {
    const candEnd = new Date(cursor.getTime() + slotMs);
    const hit = busy.some((b) => overlaps(cursor, candEnd, b.start, b.end));
    if (!hit) {
      const startLux = DateTime.fromJSDate(cursor).setZone(tz);
      slots.push(
        `${startLux.toFormat("ccc d LLL yyyy")}, ${startLux.toFormat("h:mm a")} (${tz})`
      );
      cursor = candEnd;
    } else {
      cursor = new Date(cursor.getTime() + 15 * 60 * 1000);
    }
  }

  console.log(`Calendar ID: ${calId}`);
  console.log(`Timezone: ${tz} | Slot length: ${slotMinutes} min`);
  console.log(
    `Tomorrow (${tomorrow.toFormat("yyyy-MM-dd")}): ${slots.length} free slot(s)\n`
  );
  if (slots.length === 0) {
    console.log(
      "(No contiguous free windows for the configured slot length across the full calendar day.)"
    );
  } else {
    slots.forEach((s, i) => console.log(`${i + 1}. ${s}`));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
