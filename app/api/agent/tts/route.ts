import { synthesizeSpeech } from "@/lib/voice/tts";

export const runtime = "nodejs";

/**
 * POST /api/agent/tts
 * Body: { text: string }
 * Returns: { data: "<base64-mp3>" }
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { text?: string };
    const text = (body.text ?? "").trim();
    if (!text) {
      return new Response(JSON.stringify({ error: "Missing text" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const buffer = await synthesizeSpeech(text);
    const data = Buffer.from(buffer).toString("base64");
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error:
          err instanceof Error ? err.message : "Failed to synthesize greeting.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
