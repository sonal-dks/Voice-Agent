import { processTranscript } from "@/lib/agent/engine";
import { transcribeAudio } from "@/lib/voice/stt";
import { synthesizeSpeech } from "@/lib/voice/tts";

export const runtime = "nodejs";

function sanitizeVoiceTranscript(raw: string): string {
  let t = raw.trim();
  if (!t) return t;

  // If microphone catches TTS greeting audio, strip that echoed prefix.
  t = t.replace(
    /^this service is informational and does not constitute investment advice\.?\s*/i,
    ""
  );
  t = t.replace(
    /^hello[—,\s-]*i['’]m the white money advisor scheduling assistant[\s\S]*?what would you like to do\??\s*/i,
    ""
  );

  // De-duplicate accidental repeated sentence fragments from STT.
  const parts = t.split(/(?<=[.?!])\s+/).map((x) => x.trim()).filter(Boolean);
  const deduped: string[] = [];
  for (const p of parts) {
    const norm = p.toLowerCase();
    if (!deduped.some((d) => d.toLowerCase() === norm)) deduped.push(p);
  }
  return deduped.join(" ").trim();
}

/**
 * POST /api/agent/stream
 *
 * Accepts a multipart form with:
 *   audio     – Blob  (webm/opus or similar)
 *   sessionId – string (optional)
 *   messages  – JSON string of chat history
 *
 * Returns NDJSON stream:
 *   Line 1 → { type:"text", transcript, assistant, sessionId, … }   (sent immediately after engine)
 *   Line 2 → { type:"audio", data:"<base64 mp3>" }                  (sent after Deepgram Aura TTS)
 *   On error → { type:"error", error:"…" }
 *
 * The streaming format lets the client show the text response ~1 s before
 * audio playback begins (TTS generation runs in parallel with UI update).
 */
export async function POST(req: Request) {
  const encoder = new TextEncoder();

  function ndjsonLine(obj: Record<string, unknown>): Uint8Array {
    return encoder.encode(JSON.stringify(obj) + "\n");
  }

  try {
    const formData = await req.formData();
    const audio = formData.get("audio") as Blob | null;
    const sessionId = (formData.get("sessionId") as string) || undefined;
    const messagesRaw = formData.get("messages") as string | null;

    if (!audio || audio.size === 0) {
      return new Response(
        JSON.stringify({ error: "No audio provided" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const clientMessages = messagesRaw
      ? (JSON.parse(messagesRaw) as { role: "user" | "assistant"; content: string }[])
      : undefined;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // ── 1. STT ──────────────────────────────────────────
          const stt = await transcribeAudio(
            await audio.arrayBuffer(),
            audio.type || "audio/webm"
          );

          const transcript = sanitizeVoiceTranscript(stt.transcript);

          if (!transcript) {
            controller.enqueue(
              ndjsonLine({
                type: "error",
                error:
                  "I didn't catch that — could you try again? Make sure your microphone is working.",
              })
            );
            controller.close();
            return;
          }

          // ── 2. Conversation Engine (same as text chat) ──────
          const result = await processTranscript(
            sessionId,
            transcript,
            clientMessages
          );

          // Send text payload immediately so the UI updates before TTS finishes
          controller.enqueue(
            ndjsonLine({
              type: "text",
              transcript,
              assistant: result.assistant,
              sessionId: result.sessionId,
              bookingCode: result.bookingCode ?? null,
              secureLinkToken: result.secureLinkToken ?? null,
              slotDisplay: result.slotDisplay ?? null,
              bookingTopic: result.bookingTopic ?? null,
              bookingJustConfirmed: result.bookingJustConfirmed ?? false,
            })
          );

          // ── 3. TTS ──────────────────────────────────────────
          if (result.assistant) {
            try {
              const ttsBuffer = await synthesizeSpeech(result.assistant);
              const b64 = Buffer.from(ttsBuffer).toString("base64");
              controller.enqueue(
                ndjsonLine({ type: "audio", data: b64 })
              );
            } catch (ttsErr) {
              console.error("[voice/tts]", ttsErr);
              controller.enqueue(
                ndjsonLine({
                  type: "audio_error",
                  error: "Voice synthesis unavailable — text response shown above.",
                })
              );
            }
          }
        } catch (err) {
          console.error("[voice/stream]", err);
          controller.enqueue(
            ndjsonLine({
              type: "error",
              error:
                err instanceof Error
                  ? err.message
                  : "Voice processing failed. Please try again.",
            })
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (outerErr) {
    console.error("[voice/stream outer]", outerErr);
    return new Response(
      JSON.stringify({
        error:
          outerErr instanceof Error
            ? outerErr.message
            : "Failed to parse voice request.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
