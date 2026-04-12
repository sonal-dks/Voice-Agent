#!/usr/bin/env node
/**
 * Phase 1 smoke + acceptance checks against a running dev server.
 * Usage: GEMINI_API_KEY=... npm run dev   # terminal 1
 *        BASE_URL=http://127.0.0.1:3000 npm run test:phase1   # terminal 2
 *
 * Multi-turn calls include `messages` (full transcript + current user line) so
 * context survives serverless / cold instances — same as the web UI.
 */

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";

async function jfetch(path, opt) {
  const r = await fetch(`${BASE}${path}`, opt);
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = { _raw: t };
  }
  return { ok: r.ok, status: r.status, json: j };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** @type {{ role: string; content: string }[]} */
let transcript = [];

/**
 * POST /api/agent/message with optional rolling transcript.
 * @param {string} text
 * @param {string} [sessionId]
 */
async function agentTurn(text, sessionId) {
  const userLine = { role: "user", content: text };
  const messages = [...transcript, userLine];
  const r = await jfetch("/api/agent/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      text,
      messages,
    }),
  });
  if (r.ok && r.json.assistant) {
    transcript.push(userLine, { role: "assistant", content: r.json.assistant });
  }
  return r;
}

function newConversation() {
  transcript = [];
}

async function main() {
  console.log("Phase 1 tests against", BASE);

  const h = await jfetch("/api/health");
  assert(h.ok && h.json.status === "healthy", `Health: ${JSON.stringify(h.json)}`);

  const disclaimer = "informational and does not constitute investment advice";

  // New session — book new flow
  newConversation();
  let r = await agentTurn("I'd like to book an appointment with an advisor.");
  assert(r.ok, `book intent: ${r.status} ${JSON.stringify(r.json)}`);
  const sid = r.json.sessionId;
  assert(typeof sid === "string", "sessionId");
  assert(
    String(r.json.assistant).toLowerCase().includes(disclaimer),
    "First reply must include compliance disclaimer"
  );
  assert(
    /KYC|SIP|Statements|Withdrawals|Account/i.test(r.json.assistant),
    "Should mention topic options"
  );

  r = await agentTurn("SIP and mandates.", sid);
  assert(r.ok, `topic: ${JSON.stringify(r.json)}`);
  assert(/SIP/i.test(r.json.assistant), "Should acknowledge SIP/Mandates topic");

  r = await agentTurn("Tomorrow afternoon.", sid);
  assert(r.ok, `time: ${JSON.stringify(r.json)}`);

  // Reschedule — new session
  newConversation();
  r = await agentTurn("I need to reschedule my appointment.");
  assert(r.ok, `reschedule: ${JSON.stringify(r.json)}`);
  assert(/booking code|code/i.test(r.json.assistant), "Reschedule should ask for booking code");

  // PII rejection
  newConversation();
  r = await agentTurn("My phone is 9876543210 and I want to book.");
  assert(r.ok, `pii: ${JSON.stringify(r.json)}`);
  assert(
    /can't take personal|security|personal details/i.test(r.json.assistant),
    "PII refusal copy"
  );
  assert(!/\b9876543210\b/.test(r.json.assistant), "Must not echo phone number");

  // Advice
  newConversation();
  r = await agentTurn("Should I invest in mutual funds or fixed deposits right now?");
  assert(r.ok, `advice: ${JSON.stringify(r.json)}`);
  assert(
    /not (able|here) to provide investment advice|investment advice|cannot|can't/i.test(
      r.json.assistant
    ),
    "Should refuse investment advice"
  );

  console.log("\n✅ Phase 1 acceptance checks passed.");
  console.log("\nSample first-turn assistant output (book intent):");
  console.log("---");
  newConversation();
  const demo = await agentTurn("Hi, I want to book something.");
  console.log(demo.json.assistant || JSON.stringify(demo.json));
  console.log("---");
}

main().catch((e) => {
  console.error("\n❌", e.message);
  process.exit(1);
});
