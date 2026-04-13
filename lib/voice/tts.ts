/**
 * ElevenLabs TTS — server-side REST API for speech synthesis.
 * Returns MP3 audio as an ArrayBuffer.
 *
 * Uses the "eleven_turbo_v2_5" model for ~200 ms first-byte latency.
 * Voice ID is read from ELEVENLABS_VOICE_ID (pick your voice in the
 * ElevenLabs console, copy the ID into the env var).
 */

export interface TtsOptions {
  stability?: number;
  similarityBoost?: number;
  style?: number;
}

const DEFAULT_OPTS: Required<TtsOptions> = {
  stability: 0.5,
  similarityBoost: 0.8,
  style: 0.0,
};

export async function synthesizeSpeech(
  text: string,
  opts?: TtsOptions
): Promise<ArrayBuffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();

  if (!apiKey || !voiceId) {
    throw new Error(
      "ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID must be set for voice mode."
    );
  }

  const o = { ...DEFAULT_OPTS, ...opts };

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: o.stability,
          similarity_boost: o.similarityBoost,
          style: o.style,
        },
      }),
    }
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS error ${res.status}: ${errBody}`);
  }

  return res.arrayBuffer();
}
