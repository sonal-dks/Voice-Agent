import { redirect } from "next/navigation";

import { PiiBookingForm } from "@/phase-3-post-call-pii/components/PiiBookingForm";
import { lookupBookingForPiiPage } from "@/phase-3-post-call-pii/lib/lookupBookingForPiiPage";

type Props = {
  params: { code: string };
  searchParams: Record<string, string | string[] | undefined>;
};

function firstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v[0]) return v[0];
  return undefined;
}

export default async function BookingPiiPage({ params, searchParams }: Props) {
  const code = decodeURIComponent(params.code ?? "").trim();
  const token = firstString(searchParams.token);

  if (!code) {
    redirect("/booking/invalid?reason=missing_code");
  }
  if (!token) {
    redirect(`/booking/invalid?reason=missing_token&code=${encodeURIComponent(code)}`);
  }

  const row = await lookupBookingForPiiPage(code, token);
  if (!row.ok) {
    redirect(`/booking/invalid?reason=${encodeURIComponent(row.error)}&code=${encodeURIComponent(code)}`);
  }
  if (row.pii_submitted) {
    redirect(`/booking/${encodeURIComponent(code)}/confirmed`);
  }

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
          border: "1px solid #2d4a6f",
        }}
      >
        <h1 style={{ margin: "0 0 8px", fontSize: "1.35rem" }}>Complete your booking</h1>
        <p style={{ margin: "0 0 20px", color: "var(--muted)", fontSize: "0.9rem" }}>
          Booking{" "}
          <code style={{ color: "#7dd3fc", fontSize: "0.95rem" }}>{code}</code>
        </p>
        <PiiBookingForm
          bookingCode={code}
          secureLinkToken={token}
          topic={row.topic}
          slotDisplay={row.slot_display}
        />
      </div>
    </main>
  );
}
