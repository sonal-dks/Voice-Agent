"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ──────────────────────────────────────────────────────────────────── */
/*  Types                                                              */
/* ──────────────────────────────────────────────────────────────────── */

export type VoiceStatus = "idle" | "recording" | "processing" | "playing";

export interface VoiceResponse {
  transcript: string;
  assistant: string;
  sessionId: string;
  bookingCode: string | null;
  secureLinkToken: string | null;
  slotDisplay: string | null;
  bookingTopic: string | null;
  bookingJustConfirmed: boolean;
}

interface ChatLine {
  role: "user" | "assistant";
  content: string;
}

interface UseVoiceOpts {
  sessionId: string | null;
  messages: ChatLine[];
  disabled?: boolean;
  onResponse: (data: VoiceResponse) => void;
  onError: (msg: string) => void;
}

/* ──────────────────────────────────────────────────────────────────── */
/*  Helpers                                                            */
/* ──────────────────────────────────────────────────────────────────── */

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus"))
    return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus"))
    return "audio/ogg;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return "audio/webm";
}

const SILENCE_THRESHOLD = 8;
const SILENCE_MS = 1800;
const MIN_RECORDING_MS = 600;

/* ──────────────────────────────────────────────────────────────────── */
/*  Hook                                                               */
/* ──────────────────────────────────────────────────────────────────── */

export function useVoice({
  sessionId,
  messages,
  disabled,
  onResponse,
  onError,
}: UseVoiceOpts) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const shouldProcessRef = useRef(true);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const playbackRef = useRef<HTMLAudioElement | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const recordStartRef = useRef(0);
  const rafRef = useRef(0);

  const sessionIdRef = useRef(sessionId);
  const messagesRef = useRef(messages);
  const onResponseRef = useRef(onResponse);
  const onErrorRef = useRef(onError);

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { onResponseRef.current = onResponse; }, [onResponse]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const isSupported =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  /* ── Audio level meter (drives waveform vis) ────────────────────── */

  const pollLevel = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser || recorderRef.current?.state !== "recording") return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(buf);
    const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
    setAudioLevel(avg);

    // Silence auto-stop
    if (avg < SILENCE_THRESHOLD) {
      if (silenceTimerRef.current === null) {
        silenceTimerRef.current = Date.now();
      } else if (
        Date.now() - silenceTimerRef.current > SILENCE_MS &&
        Date.now() - recordStartRef.current > MIN_RECORDING_MS
      ) {
        stopRecording();
        return;
      }
    } else {
      silenceTimerRef.current = null;
    }

    rafRef.current = requestAnimationFrame(pollLevel);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Process audio blob (send to server) ────────────────────────── */

  const processAudio = useCallback(async (blob: Blob) => {
    setStatus("processing");
    setAudioLevel(0);

    const form = new FormData();
    form.append("audio", blob);
    if (sessionIdRef.current) form.append("sessionId", sessionIdRef.current);
    // Keep context bounded so the model does not echo the full transcript.
    form.append("messages", JSON.stringify(messagesRef.current.slice(-20)));

    try {
      const res = await fetch("/api/agent/stream", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((j as { error?: string }).error || `Server ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n");
        buf = parts.pop()!;

        for (const line of parts) {
          if (!line.trim()) continue;
          let data: Record<string, unknown>;
          try { data = JSON.parse(line); } catch { continue; }

          if (data.type === "text") {
            onResponseRef.current(data as unknown as VoiceResponse);
          } else if (data.type === "audio" && typeof data.data === "string") {
            setStatus("playing");
            try {
              await playAudio(data.data);
            } catch {
              /* playback failure is non-fatal; text is already shown */
            }
          } else if (data.type === "error" || data.type === "audio_error") {
            const msg = (data.error as string) || "Voice processing failed";
            setError(msg);
            onErrorRef.current(msg);
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Voice request failed";
      setError(msg);
      onErrorRef.current(msg);
    } finally {
      setStatus("idle");
    }
  }, []);

  /* ── Audio playback ─────────────────────────────────────────────── */

  const playAudio = useCallback((b64: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const blob = base64ToBlob(b64, "audio/mpeg");
      const url = URL.createObjectURL(blob);
      const el = new Audio(url);
      playbackRef.current = el;
      el.onended = () => { URL.revokeObjectURL(url); playbackRef.current = null; resolve(); };
      el.onerror = () => { URL.revokeObjectURL(url); playbackRef.current = null; reject(new Error("playback")); };
      el.play().catch(reject);
    });
  }, []);

  /* ── Start recording ────────────────────────────────────────────── */

  const startRecording = useCallback(async () => {
    if (status !== "idle" || disabled) return;
    setError(null);
    if (typeof window !== "undefined" && "speechSynthesis" in window && window.speechSynthesis.speaking) {
      const msg = "Please wait a second for the greeting audio to finish, then tap mic.";
      setError(msg);
      onErrorRef.current(msg);
      return;
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        },
      });
      streamRef.current = mediaStream;

      // Analyser for level metering + silence detection
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(mediaStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      src.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      const mime = pickMimeType();
      const recorder = new MediaRecorder(mediaStream, { mimeType: mime });
      chunksRef.current = [];
      shouldProcessRef.current = true;
      silenceTimerRef.current = null;
      recordStartRef.current = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        cancelAnimationFrame(rafRef.current);
        audioCtxRef.current?.close().catch(() => {});
        audioCtxRef.current = null;
        analyserRef.current = null;

        if (shouldProcessRef.current && chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
          processAudio(blob);
        } else {
          setStatus("idle");
        }
      };

      recorder.start(200);
      recorderRef.current = recorder;
      setStatus("recording");
      rafRef.current = requestAnimationFrame(pollLevel);
    } catch (e) {
      const msg =
        e instanceof Error && e.name === "NotAllowedError"
          ? "Microphone access denied. Please allow microphone in your browser settings."
          : e instanceof Error
          ? e.message
          : "Could not start microphone";
      setError(msg);
      onErrorRef.current(msg);
    }
  }, [status, disabled, processAudio, pollLevel]);

  /* ── Stop recording (triggers processing) ───────────────────────── */

  const stopRecording = useCallback(() => {
    shouldProcessRef.current = true;
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  /* ── Cancel recording (discard audio) ───────────────────────────── */

  const cancelRecording = useCallback(() => {
    shouldProcessRef.current = false;
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    chunksRef.current = [];
    setStatus("idle");
  }, []);

  /* ── Stop playback ──────────────────────────────────────────────── */

  const stopPlayback = useCallback(() => {
    if (playbackRef.current) {
      playbackRef.current.pause();
      playbackRef.current.src = "";
      playbackRef.current = null;
    }
    setStatus("idle");
  }, []);

  /* ── Cleanup on unmount ─────────────────────────────────────────── */

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
      playbackRef.current?.pause();
    };
  }, []);

  return {
    isSupported,
    status,
    isRecording: status === "recording",
    isProcessing: status === "processing",
    isPlaying: status === "playing",
    audioLevel,
    error,
    startRecording,
    stopRecording,
    cancelRecording,
    stopPlayback,
  };
}
