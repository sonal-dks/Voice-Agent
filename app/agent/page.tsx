"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PiiBookingForm } from "@/phase-3-post-call-pii/components/PiiBookingForm";
import { DISCLAIMER_PHRASE } from "@/lib/agent/prompts";
import MicButton from "./components/MicButton";
import { useVoice, type VoiceResponse } from "./components/useVoice";

type ChatLine = { role: "user" | "assistant"; content: string; via?: "voice" };

const OPENING = `${DISCLAIMER_PHRASE}

Hello — I'm the White Money Advisor scheduling assistant. Here's what I can help with:

• Book a new consultation
• Reschedule or cancel a booking
• Check availability for a day you have in mind
• Get ready — what to bring to your appointment

What would you like to do?`;

const END_PHRASES =
  /^(bye|goodbye|end\s*chat|exit|done|no\s*thanks|nothing\s*else|that'?s\s*all|i'?m\s*done|close\s*chat|quit)$/i;

export default function AgentPage() {
  /* ── Session state ──────────────────────────────────────────────── */
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([
    { role: "assistant", content: OPENING },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ── Booking state ──────────────────────────────────────────────── */
  const [bookingCode, setBookingCode] = useState<string | null>(null);
  const [secureLinkToken, setSecureLinkToken] = useState<string | null>(null);
  const [slotDisplay, setSlotDisplay] = useState("");
  const [bookingTopic, setBookingTopic] = useState("");
  const [piiModalOpen, setPiiModalOpen] = useState(false);
  const [piiSuccessMsg, setPiiSuccessMsg] = useState<string | null>(null);
  const [chatEnded, setChatEnded] = useState(false);

  /* ── Mode: chat vs voice ────────────────────────────────────────── */
  const [mode, setMode] = useState<"chat" | "voice">("voice");
  const hasPlayedVoiceGreetingRef = useRef(false);

  /* ── Auto-scroll ────────────────────────────────────────────────── */
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [lines, loading]);

  /* ── Voice greeting on first switch to voice mode ─────────────── */
  useEffect(() => {
    if (mode !== "voice" || chatEnded) return;
    if (hasPlayedVoiceGreetingRef.current) return;
    if (lines.length !== 1 || lines[0]?.role !== "assistant") return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const utter = new SpeechSynthesisUtterance(lines[0].content);
    utter.rate = 1;
    utter.pitch = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
    hasPlayedVoiceGreetingRef.current = true;

    return () => {
      window.speechSynthesis.cancel();
    };
  }, [mode, lines, chatEnded]);

  /* ── Apply server response (shared by text and voice paths) ──── */
  const applyResponse = useCallback(
    (data: {
      sessionId?: string;
      bookingCode?: string | null;
      secureLinkToken?: string | null;
      slotDisplay?: string | null;
      bookingTopic?: string | null;
    }) => {
      if (data.sessionId) setSessionId(data.sessionId);
      if (data.bookingCode) setBookingCode(data.bookingCode);
      if (data.secureLinkToken) setSecureLinkToken(data.secureLinkToken);
      if (data.slotDisplay != null) setSlotDisplay(data.slotDisplay);
      if (data.bookingTopic != null) setBookingTopic(data.bookingTopic);
    },
    []
  );

  /* ── Voice hook ─────────────────────────────────────────────────── */
  const voice = useVoice({
    sessionId,
    messages: lines,
    disabled: piiModalOpen || chatEnded,
    onResponse: useCallback(
      (data: VoiceResponse) => {
        if (END_PHRASES.test(data.transcript.trim())) {
          setLines((p) => [
            ...p,
            { role: "user", content: data.transcript, via: "voice" },
            {
              role: "assistant",
              content:
                'Thanks for chatting with White Money Advisor. Have a great day. Click "New conversation" below to start a fresh session.',
            },
          ]);
          setChatEnded(true);
          return;
        }
        setLines((p) => [
          ...p,
          { role: "user", content: data.transcript, via: "voice" },
          { role: "assistant", content: data.assistant },
        ]);
        applyResponse(data);
      },
      [applyResponse]
    ),
    onError: useCallback((msg: string) => setError(msg), []),
  });

  /* ── New session ────────────────────────────────────────────────── */
  const startNewSession = useCallback(() => {
    voice.cancelRecording();
    voice.stopPlayback();
    setSessionId(null);
    setLines([{ role: "assistant", content: OPENING }]);
    setInput("");
    setLoading(false);
    setError(null);
    setBookingCode(null);
    setSecureLinkToken(null);
    setSlotDisplay("");
    setBookingTopic("");
    setPiiModalOpen(false);
    setPiiSuccessMsg(null);
    setChatEnded(false);
    hasPlayedVoiceGreetingRef.current = false;
  }, [voice]);

  /* ── Send text message (chat mode) ──────────────────────────────── */
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || chatEnded) return;

    if (END_PHRASES.test(text)) {
      setLines((p) => [
        ...p,
        { role: "user", content: text },
        {
          role: "assistant",
          content:
            'Thanks for chatting with White Money Advisor. Have a great day. Click "New conversation" below to start a fresh session.',
        },
      ]);
      setInput("");
      setChatEnded(true);
      return;
    }

    setLoading(true);
    setError(null);
    setInput("");
    const userLine: ChatLine = { role: "user", content: text };
    const payload = [...lines, userLine];
    setLines((p) => [...p, userLine]);

    try {
      const res = await fetch("/api/agent/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionId ?? undefined,
          text,
          messages: payload,
        }),
      });
      const data = (await res.json()) as {
        sessionId?: string;
        assistant?: string;
        bookingCode?: string | null;
        secureLinkToken?: string | null;
        slotDisplay?: string | null;
        bookingTopic?: string | null;
        bookingJustConfirmed?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || res.statusText);
      applyResponse(data);
      if (data.assistant) {
        setLines((p) => [
          ...p,
          { role: "assistant", content: data.assistant! },
        ]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setError(msg);
      setLines((p) => p.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }, [input, loading, sessionId, lines, chatEnded, applyResponse]);

  /* ── Mic toggle handler ─────────────────────────────────────────── */
  const handleMicToggle = useCallback(() => {
    if (voice.isRecording) {
      voice.stopRecording();
    } else {
      voice.startRecording();
    }
  }, [voice]);

  const frozen = piiModalOpen;
  const voiceBusy = voice.isProcessing || voice.isPlaying;

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside
        style={{
          width: 260,
          background: "var(--sidebar)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          padding: "16px 12px",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontWeight: 700,
            fontSize: "1.1rem",
            marginBottom: 20,
            color: "var(--accent)",
          }}
        >
          White Money Advisor
        </div>
        <button
          type="button"
          onClick={startNewSession}
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            fontSize: "0.9rem",
            cursor: "pointer",
            textAlign: "left",
            color: "var(--text)",
            marginBottom: 8,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New conversation
        </button>
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--accent)",
            color: "#fff",
            fontSize: "0.9rem",
            marginBottom: 12,
            cursor: "default",
            fontWeight: 500,
          }}
        >
          Advisor Scheduling
        </div>
        <div style={{ flex: 1 }} />
        {sessionId && (
          <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
            Session: {sessionId.slice(0, 8)}…
          </div>
        )}
      </aside>

      {/* ── Main chat area ──────────────────────────────────────── */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        {/* Booking banner */}
        {bookingCode && !piiModalOpen && (
          <div
            style={{
              padding: "10px 20px",
              background: "var(--banner-bg)",
              borderBottom: "1px solid var(--banner-border)",
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              fontSize: "0.9rem",
            }}
          >
            <span>
              Booking{" "}
              <code
                style={{
                  color: "var(--accent)",
                  fontWeight: 700,
                  background: "#fff",
                  padding: "2px 6px",
                  borderRadius: 4,
                }}
              >
                {bookingCode}
              </code>
            </span>
            {secureLinkToken && (
              <button
                type="button"
                onClick={() => {
                  setPiiModalOpen(true);
                  setPiiSuccessMsg(null);
                }}
                style={{
                  background: "var(--accent)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "6px 14px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                Submit contact details
              </button>
            )}
          </div>
        )}

        {/* ── Messages thread ────────────────────────────────────── */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflow: "auto",
            opacity: frozen ? 0.35 : 1,
            pointerEvents: frozen ? "none" : "auto",
            transition: "opacity 0.2s",
          }}
        >
          <div
            style={{ maxWidth: 768, margin: "0 auto", padding: "24px 20px" }}
          >
            {lines.map((l, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 12,
                  marginBottom: 24,
                  flexDirection: l.role === "user" ? "row-reverse" : "row",
                }}
              >
                {/* Avatar */}
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background:
                      l.role === "user" ? "#5436DA" : "var(--accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    color: "#fff",
                    flexShrink: 0,
                  }}
                >
                  {l.role === "user" ? (
                    l.via === "voice" ? (
                      <VoiceBadge />
                    ) : (
                      "U"
                    )
                  ) : (
                    "NL"
                  )}
                </div>
                {/* Bubble */}
                <div
                  style={{
                    maxWidth: "80%",
                    padding: "12px 16px",
                    borderRadius: 16,
                    background:
                      l.role === "user"
                        ? "var(--user-bg)"
                        : "var(--assistant-bg)",
                    border:
                      l.role === "assistant"
                        ? "1px solid var(--border)"
                        : "1px solid var(--banner-border)",
                    lineHeight: 1.55,
                    fontSize: "0.95rem",
                    whiteSpace: "pre-wrap",
                    color: "var(--text)",
                  }}
                >
                  {l.content}
                </div>
              </div>
            ))}

            {/* Loading indicator (text or voice) */}
            {(loading || voice.isProcessing) && (
              <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: "var(--accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    color: "#fff",
                    flexShrink: 0,
                  }}
                >
                  NL
                </div>
                <div
                  style={{
                    color: "var(--muted)",
                    padding: "12px 0",
                    fontSize: "0.9rem",
                  }}
                >
                  <span className="thinking-dots">Thinking</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Error bar */}
        {error && (
          <div
            style={{
              padding: "8px 20px",
              color: "var(--danger)",
              fontSize: "0.85rem",
            }}
          >
            {error}
          </div>
        )}
        {voice.error && !error && (
          <div
            style={{
              padding: "8px 20px",
              color: "var(--danger)",
              fontSize: "0.85rem",
            }}
          >
            {voice.error}
          </div>
        )}

        {/* ── Chat ended ─────────────────────────────────────────── */}
        {chatEnded && (
          <div
            style={{
              padding: "16px 20px",
              borderTop: "1px solid var(--border)",
              background: "var(--sidebar)",
              textAlign: "center",
            }}
          >
            <button
              type="button"
              onClick={startNewSession}
              style={{
                padding: "12px 28px",
                borderRadius: 8,
                border: "none",
                background: "var(--accent)",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
                fontSize: "1rem",
              }}
            >
              New conversation
            </button>
          </div>
        )}

        {/* ── Input area (mode toggle + chat/voice inputs) ──────── */}
        {!chatEnded && (
          <div
            style={{
              borderTop: "1px solid var(--border)",
              padding: "12px 20px 16px",
              background: "var(--bg)",
              opacity: frozen ? 0.4 : 1,
              pointerEvents: frozen ? "none" : "auto",
            }}
          >
            {/* Mode toggle tabs */}
            <div
              style={{
                maxWidth: 768,
                margin: "0 auto 10px",
                display: "flex",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  display: "inline-flex",
                  background: "var(--sidebar)",
                  borderRadius: 10,
                  padding: 3,
                  gap: 2,
                }}
              >
                <button
                  type="button"
                  onClick={() => setMode("chat")}
                  style={{
                    padding: "6px 16px",
                    borderRadius: 8,
                    border: "none",
                    fontSize: "0.82rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background:
                      mode === "chat" ? "var(--bg)" : "transparent",
                    color:
                      mode === "chat" ? "var(--text)" : "var(--muted)",
                    boxShadow:
                      mode === "chat"
                        ? "0 1px 3px rgba(0,0,0,0.08)"
                        : "none",
                    transition: "all 0.15s",
                  }}
                >
                  <KeyboardIcon />
                  Chat
                </button>
                <button
                  type="button"
                  onClick={() => setMode("voice")}
                  disabled={!voice.isSupported}
                  title={
                    voice.isSupported
                      ? "Switch to voice mode"
                      : "Voice not supported in this browser"
                  }
                  style={{
                    padding: "6px 16px",
                    borderRadius: 8,
                    border: "none",
                    fontSize: "0.82rem",
                    fontWeight: 600,
                    cursor: voice.isSupported ? "pointer" : "not-allowed",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background:
                      mode === "voice" ? "var(--bg)" : "transparent",
                    color:
                      mode === "voice"
                        ? "var(--text)"
                        : "var(--muted)",
                    boxShadow:
                      mode === "voice"
                        ? "0 1px 3px rgba(0,0,0,0.08)"
                        : "none",
                    opacity: voice.isSupported ? 1 : 0.5,
                    transition: "all 0.15s",
                  }}
                >
                  <MicTabIcon />
                  Voice
                </button>
              </div>
            </div>

            {/* ── Chat input ───────────────────────────────────── */}
            {mode === "chat" && (
              <div
                style={{
                  maxWidth: 768,
                  margin: "0 auto",
                  display: "flex",
                  gap: 10,
                }}
              >
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Message…"
                  rows={1}
                  disabled={loading || frozen}
                  style={{
                    flex: 1,
                    resize: "none",
                    padding: "12px 16px",
                    borderRadius: 24,
                    border: "1px solid var(--input-border)",
                    background: "var(--input-bg)",
                    color: "var(--text)",
                    fontSize: "0.95rem",
                    outline: "none",
                    lineHeight: 1.5,
                    minHeight: 48,
                    maxHeight: 160,
                  }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                  }}
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={loading || !input.trim() || frozen}
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    border: "none",
                    background:
                      input.trim() && !loading
                        ? "var(--accent)"
                        : "var(--input-border)",
                    color: "#fff",
                    cursor: loading ? "wait" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    transition: "background 0.15s",
                  }}
                  aria-label="Send"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
            )}

            {/* ── Voice input ──────────────────────────────────── */}
            {mode === "voice" && (
              <div
                style={{
                  maxWidth: 768,
                  margin: "0 auto",
                  padding: "8px 0 4px",
                }}
              >
                <MicButton
                  status={voice.status}
                  audioLevel={voice.audioLevel}
                  disabled={frozen || voiceBusy}
                  onToggle={handleMicToggle}
                  onCancel={voice.cancelRecording}
                />
              </div>
            )}

            <p
              style={{
                textAlign: "center",
                fontSize: "0.72rem",
                color: "var(--muted)",
                margin: "8px 0 0",
              }}
            >
              White Money Advisor can make mistakes. Verify important scheduling details.
            </p>
          </div>
        )}
      </main>

      {/* ── PII Modal ──────────────────────────────────────────── */}
      {piiModalOpen && bookingCode && secureLinkToken && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--modal-overlay)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && piiSuccessMsg) {
              setPiiModalOpen(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pii-title"
            style={{
              width: "100%",
              maxWidth: 440,
              maxHeight: "90vh",
              overflow: "auto",
              background: "var(--modal-bg)",
              borderRadius: 16,
              padding: "28px 24px",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {piiSuccessMsg ? (
              <div>
                <h2
                  id="pii-title"
                  style={{
                    margin: "0 0 12px",
                    fontSize: "1.2rem",
                    color: "var(--accent)",
                  }}
                >
                  Thank you!
                </h2>
                <p
                  style={{
                    margin: "0 0 20px",
                    lineHeight: 1.55,
                    fontSize: "0.95rem",
                  }}
                >
                  {piiSuccessMsg}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setPiiModalOpen(false);
                    setPiiSuccessMsg(null);
                  }}
                  style={{
                    padding: "12px 24px",
                    borderRadius: 8,
                    border: "none",
                    background: "var(--accent)",
                    color: "#fff",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontSize: "1rem",
                  }}
                >
                  Back to chat
                </button>
              </div>
            ) : (
              <>
                <h2
                  id="pii-title"
                  style={{ margin: "0 0 4px", fontSize: "1.2rem" }}
                >
                  Complete your booking
                </h2>
                <p
                  style={{
                    margin: "0 0 16px",
                    color: "var(--muted)",
                    fontSize: "0.88rem",
                  }}
                >
                  Booking{" "}
                  <code style={{ color: "var(--accent)" }}>{bookingCode}</code>
                  {bookingTopic ? ` · ${bookingTopic}` : ""}
                  {slotDisplay ? ` · ${slotDisplay}` : ""}
                </p>
                <PiiBookingForm
                  bookingCode={bookingCode}
                  secureLinkToken={secureLinkToken}
                  topic={bookingTopic || "—"}
                  slotDisplay={slotDisplay || "—"}
                  completionMode="callback"
                  onSubmitted={(p) => setPiiSuccessMsg(p.message)}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/*  Small inline icons for mode tabs + voice badge                     */
/* ──────────────────────────────────────────────────────────────────── */

function KeyboardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <line x1="6" y1="8" x2="6" y2="8" />
      <line x1="10" y1="8" x2="10" y2="8" />
      <line x1="14" y1="8" x2="14" y2="8" />
      <line x1="18" y1="8" x2="18" y2="8" />
      <line x1="6" y1="12" x2="6" y2="12" />
      <line x1="10" y1="12" x2="10" y2="12" />
      <line x1="14" y1="12" x2="14" y2="12" />
      <line x1="18" y1="12" x2="18" y2="12" />
      <line x1="8" y1="16" x2="16" y2="16" />
    </svg>
  );
}

function MicTabIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="1" width="6" height="12" rx="3" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function VoiceBadge() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
    </svg>
  );
}
