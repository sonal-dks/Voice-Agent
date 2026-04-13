"use client";

import type { VoiceStatus } from "./useVoice";

interface Props {
  status: VoiceStatus;
  audioLevel: number;
  disabled?: boolean;
  onToggle: () => void;
  onCancel: () => void;
}

const STATUS_LABEL: Record<VoiceStatus, string> = {
  idle: "Tap to speak",
  recording: "Listening — tap to send",
  processing: "Processing…",
  playing: "Speaking…",
};

export default function MicButton({
  status,
  audioLevel,
  disabled,
  onToggle,
  onCancel,
}: Props) {
  const isRecording = status === "recording";
  const isProcessing = status === "processing";
  const isPlaying = status === "playing";
  const busy = isProcessing || isPlaying;

  const ringScale = isRecording ? 1 + Math.min(audioLevel / 60, 0.8) : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      {/* Outer ring (audio level feedback) */}
      <div
        style={{
          position: "relative",
          width: 96,
          height: 96,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Animated ring */}
        <div
          className={isRecording ? "voice-ring-pulse" : ""}
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: isRecording ? "rgba(239,68,68,0.15)" : "transparent",
            transform: `scale(${ringScale})`,
            transition: isRecording ? "transform 0.1s ease-out" : "transform 0.3s",
          }}
        />

        {/* Main button */}
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled || busy}
          aria-label={STATUS_LABEL[status]}
          style={{
            position: "relative",
            zIndex: 1,
            width: 72,
            height: 72,
            borderRadius: "50%",
            border: "none",
            cursor: busy || disabled ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.2s, box-shadow 0.2s",
            background: isRecording
              ? "#ef4444"
              : isProcessing
              ? "var(--accent)"
              : isPlaying
              ? "#7c3aed"
              : "var(--accent)",
            boxShadow: isRecording
              ? "0 0 0 4px rgba(239,68,68,0.25)"
              : "0 2px 8px rgba(0,0,0,0.12)",
          }}
        >
          {isProcessing ? (
            <LoadingSpinner />
          ) : isPlaying ? (
            <SpeakerIcon />
          ) : isRecording ? (
            <StopIcon />
          ) : (
            <MicIcon />
          )}
        </button>
      </div>

      {/* Status label */}
      <span
        style={{
          fontSize: "0.82rem",
          color: "var(--muted)",
          fontWeight: 500,
          minHeight: 20,
          textAlign: "center",
        }}
      >
        {STATUS_LABEL[status]}
      </span>

      {/* Cancel button (only while recording) */}
      {isRecording && (
        <button
          type="button"
          onClick={onCancel}
          style={{
            fontSize: "0.78rem",
            color: "var(--muted)",
            background: "none",
            border: "none",
            cursor: "pointer",
            textDecoration: "underline",
            padding: 0,
          }}
        >
          Cancel
        </button>
      )}
    </div>
  );
}

/* ── Inline SVG icons ─────────────────────────────────────────────── */

function MicIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="1" width="6" height="12" rx="3" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function LoadingSpinner() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" className="voice-spinner">
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    </svg>
  );
}
