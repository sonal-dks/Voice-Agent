"use client";

import { useCallback, useState } from "react";

type ChatLine = { role: "user" | "assistant"; content: string };

export default function AgentPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookingCode, setBookingCode] = useState<string | null>(null);
  const [secureLinkToken, setSecureLinkToken] = useState<string | null>(null);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setLoading(true);
    setError(null);
    setInput("");
    const userLine = { role: "user" as const, content: text };
    const messagesPayload = [...lines, userLine];
    setLines((prev) => [...prev, userLine]);

    try {
      const res = await fetch("/api/agent/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionId ?? undefined,
          text,
          messages: messagesPayload,
        }),
      });
      const data = (await res.json()) as {
        sessionId?: string;
        assistant?: string;
        bookingCode?: string | null;
        secureLinkToken?: string | null;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      if (data.sessionId) setSessionId(data.sessionId);
      setBookingCode(data.bookingCode ?? null);
      setSecureLinkToken(data.secureLinkToken ?? null);
      if (data.assistant) {
        setLines((prev) => [...prev, { role: "assistant", content: data.assistant! }]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setError(msg);
      setLines((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }, [input, loading, sessionId, lines]);

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: 16,
        gap: 12,
      }}
    >
      <header>
        <h1 style={{ fontSize: "1.25rem", margin: "0 0 4px" }}>Web Agent — text</h1>
        <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.9rem" }}>
          Session: {sessionId ? <code>{sessionId.slice(0, 8)}…</code> : "new"} · Text chat
          (Phase 2 scheduling when configured)
        </p>
      </header>

      {bookingCode && (
        <aside
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            background: "#1a2636",
            border: "1px solid #2d4a6f",
            fontSize: "0.9rem",
          }}
        >
          <div>
            <strong>Booking ID</strong>{" "}
            <code style={{ fontSize: "1rem", color: "#7dd3fc" }}>{bookingCode}</code>
            <span style={{ color: "var(--muted)", marginLeft: 8 }}>
              — copy for your records. Do not share personal details in chat.
            </span>
          </div>
          {secureLinkToken ? (
            <p style={{ margin: "10px 0 0", lineHeight: 1.45 }}>
              <strong style={{ color: "var(--text)" }}>Complete contact details (Phase 3)</strong>
              <br />
              <a
                href={`/booking/${encodeURIComponent(bookingCode)}?token=${encodeURIComponent(secureLinkToken)}`}
                style={{ fontWeight: 600, wordBreak: "break-all" }}
              >
                Open secure PII form
              </a>
            </p>
          ) : null}
        </aside>
      )}

      <section
        style={{
          flex: 1,
          overflow: "auto",
          background: "var(--panel)",
          borderRadius: 12,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          minHeight: 280,
        }}
      >
        {lines.length === 0 && (
          <p style={{ color: "var(--muted)", margin: 0 }}>
            Type a message to start — e.g. &quot;I&apos;d like to book an appointment with an
            advisor.&quot;
          </p>
        )}
        {lines.map((l, i) => (
          <div
            key={i}
            style={{
              alignSelf: l.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "92%",
              padding: "10px 14px",
              borderRadius: 12,
              background: l.role === "user" ? "var(--user)" : "#243044",
              whiteSpace: "pre-wrap",
              lineHeight: 1.45,
              fontSize: "0.95rem",
            }}
          >
            {l.content}
          </div>
        ))}
        {loading && (
          <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Thinking…</span>
        )}
      </section>

      {error && (
        <p style={{ color: "#f87171", margin: 0, fontSize: "0.9rem" }} role="alert">
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
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
          rows={2}
          disabled={loading}
          style={{
            flex: 1,
            resize: "vertical",
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #2d3d52",
            background: "#121a24",
            color: "var(--text)",
            fontSize: "1rem",
          }}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={loading || !input.trim()}
          style={{
            padding: "0 20px",
            borderRadius: 8,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontWeight: 600,
            cursor: loading ? "wait" : "pointer",
            alignSelf: "flex-end",
          }}
        >
          Send
        </button>
      </div>
    </main>
  );
}
