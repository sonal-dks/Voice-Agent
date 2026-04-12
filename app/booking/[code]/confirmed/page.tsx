import Link from "next/link";

type Props = { params: { code: string } };

export default function BookingConfirmedPage({ params }: Props) {
  const code = decodeURIComponent(params.code ?? "").trim();
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "var(--panel)",
          borderRadius: 16,
          padding: "28px 24px",
          border: "1px solid #2d6a4f",
        }}
      >
        <h1 style={{ margin: "0 0 12px", fontSize: "1.35rem", color: "#86efac" }}>
          You&apos;re all set
        </h1>
        <p style={{ margin: "0 0 16px", color: "var(--text)", lineHeight: 1.5 }}>
          Your contact details are saved for booking{" "}
          <code style={{ color: "#7dd3fc" }}>{code || "—"}</code>. If email is configured,
          you should receive a confirmation message shortly. The advisor has been notified as
          well.
        </p>
        <p
          style={{
            margin: 0,
            padding: "12px 14px",
            background: "#1a2636",
            borderRadius: 10,
            fontSize: "0.9rem",
            color: "var(--muted)",
          }}
          role="status"
        >
          In-app confirmation: details submitted successfully.
        </p>
        <p style={{ margin: "20px 0 0" }}>
          <Link href="/agent" style={{ fontWeight: 600 }}>
            ← Back to agent
          </Link>
        </p>
      </div>
    </main>
  );
}
