import { NextResponse } from "next/server";
import { z } from "zod";
import { processMessage } from "@/lib/agent/engine";

export const runtime = "nodejs";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(12000),
});

const bodySchema = z.object({
  sessionId: z.string().uuid().optional(),
  text: z.string().min(1).max(8000),
  /** Full transcript including this user turn — required for context on serverless (in-memory session is not sticky). */
  messages: z.array(messageSchema).max(100).optional(),
});

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { sessionId, text, messages } = parsed.data;
    const out = await processMessage(sessionId, text, messages);
    return NextResponse.json({
      sessionId: out.sessionId,
      assistant: out.assistant,
      messages: out.messages,
      bookingCode: out.bookingCode ?? null,
      secureLinkToken: out.secureLinkToken ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    const status = msg.includes("GROQ_API_KEY") ? 503 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
