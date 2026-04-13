/**
 * Deepgram Nova-2 STT — server-side REST API for pre-recorded audio.
 * Called from the /api/agent/stream route handler.
 *
 * Why REST (not WebSocket streaming)?
 *   Vercel serverless functions do not support long-lived WebSocket connections.
 *   REST transcription of short utterances (~3-10 s) adds ~300-500 ms — acceptable
 *   for the target 1.5 s round-trip budget.  If you move to a persistent server,
 *   swap this for Deepgram's live-streaming WebSocket for ~150 ms savings.
 */

const DEEPGRAM_API = "https://api.deepgram.com/v1/listen";

export interface SttResult {
  transcript: string;
  confidence: number;
  durationSec: number;
}

export async function transcribeAudio(
  audioBuffer: ArrayBuffer,
  mimeType: string
): Promise<SttResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "DEEPGRAM_API_KEY is not set — voice mode requires a valid Deepgram key."
    );
  }

  const params = new URLSearchParams({
    model: "nova-2",
    language: "en",
    smart_format: "true",
    punctuate: "true",
    diarize: "false",
    filler_words: "false",
    detect_language: "false",
  });

  const res = await fetch(`${DEEPGRAM_API}?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": mimeType || "audio/webm",
    },
    body: audioBuffer,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Deepgram STT error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    results?: {
      channels?: Array<{
        alternatives?: Array<{ transcript?: string; confidence?: number }>;
      }>;
      duration?: number;
    };
  };

  const alt = data.results?.channels?.[0]?.alternatives?.[0];
  return {
    transcript: alt?.transcript?.trim() ?? "",
    confidence: alt?.confidence ?? 0,
    durationSec: data.results?.duration ?? 0,
  };
}
