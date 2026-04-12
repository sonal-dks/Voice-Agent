import Link from "next/link";

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        gap: 16,
      }}
    >
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>
        Advisor Appointment Scheduler
      </h1>
      <p style={{ color: "var(--muted)", margin: 0, textAlign: "center", maxWidth: 420 }}>
        Phase 1 implementation: text chat with Gemini, guardrails, and disclaimer on the
        first assistant turn.
      </p>
      <Link
        href="/agent"
        style={{
          display: "inline-block",
          padding: "12px 20px",
          background: "var(--accent)",
          color: "#fff",
          borderRadius: 8,
          textDecoration: "none",
          fontWeight: 600,
        }}
      >
        Open agent (text chat)
      </Link>
    </main>
  );
}
