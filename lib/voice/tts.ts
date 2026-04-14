/**
 * Deepgram Aura TTS — server-side REST API (`/v1/speak`).
 * Returns MP3 audio as an ArrayBuffer (same `DEEPGRAM_API_KEY` as STT).
 *
 * @see https://developers.deepgram.com/docs/text-to-speech
 */

const SPEAK_URL = "https://api.deepgram.com/v1/speak";

export async function synthesizeSpeech(text: string): Promise<ArrayBuffer> {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "DEEPGRAM_API_KEY is not set — voice playback requires the same key used for speech-to-text."
    );
  }

  const model =
    process.env.DEEPGRAM_TTS_MODEL?.trim() || "aura-2-thalia-en";

  const url = new URL(SPEAK_URL);
  url.searchParams.set("model", model);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    let hint = errBody;
    try {
      const j = JSON.parse(errBody) as { err_msg?: string; message?: string };
      hint = j.err_msg || j.message || errBody;
    } catch {
      /* use raw */
    }
    throw new Error(`Deepgram TTS error ${res.status}: ${hint.slice(0, 500)}`);
  }

  return res.arrayBuffer();
}
