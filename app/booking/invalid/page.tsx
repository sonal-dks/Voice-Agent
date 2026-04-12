import Link from "next/link";

type Props = {
  searchParams: Record<string, string | string[] | undefined>;
};

function firstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v[0]) return v[0];
  return undefined;
}

export default function BookingInvalidPage({ searchParams }: Props) {
  const reason = firstString(searchParams.reason) ?? "unknown";
  const code = firstString(searchParams.code);

  const human =
    reason === "missing_token"
      ? "This link is missing a security token. Open the complete link from your session, or use the copyable secure link shown after booking."
      : reason === "missing_code"
        ? "No booking code was provided."
        : reason === "scheduling_not_configured"
          ? "Scheduling is not configured on this server."
          : "This booking link is invalid or has expired.";

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
          border: "1px solid #7f1d1d",
        }}
      >
        <h1 style={{ margin: "0 0 12px", fontSize: "1.25rem", color: "#fca5a5" }}>
          Link not valid
        </h1>
        <p style={{ margin: "0 0 8px", lineHeight: 1.5 }}>{human}</p>
        {code ? (
          <p style={{ margin: "0 0 16px", color: "var(--muted)", fontSize: "0.9rem" }}>
            Code referenced: <code style={{ color: "#7dd3fc" }}>{code}</code>
          </p>
        ) : null}
        <Link href="/agent" style={{ fontWeight: 600 }}>
          ← Back to agent
        </Link>
      </div>
    </main>
  );
}
