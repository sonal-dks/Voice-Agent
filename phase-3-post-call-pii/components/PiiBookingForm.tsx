"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, type CSSProperties, type FormEvent } from "react";

function validateFields(input: {
  name: string;
  email: string;
  phone: string;
  account: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (input.name.trim().length < 2) errors.name = "Name must be at least 2 characters";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    errors.email = "Enter a valid email";
  }
  const ph = input.phone.trim();
  if (ph.length < 5 || ph.length > 40) errors.phone = "Enter a valid phone";
  if (input.account.length > 80) errors.account = "Too long";
  return errors;
}

export type PiiBookingFormProps = {
  bookingCode: string;
  secureLinkToken: string;
  topic: string;
  slotDisplay: string;
};

export function PiiBookingForm({
  bookingCode,
  secureLinkToken,
  topic,
  slotDisplay,
}: PiiBookingFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [account, setAccount] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setFormError(null);
      setErrors({});
      const fieldErrors = validateFields({ name, email, phone, account });
      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors);
        return;
      }
      setSubmitting(true);
      try {
        const res = await fetch(
          `/api/booking/${encodeURIComponent(bookingCode)}/submit`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token: secureLinkToken,
              name: name.trim(),
              email: email.trim(),
              phone: phone.trim(),
              account: account.trim() || undefined,
            }),
          }
        );
        if (res.status === 201) {
          router.push(`/booking/${encodeURIComponent(bookingCode)}/confirmed`);
          return;
        }
        if (res.status === 429) {
          setFormError("Too many attempts. Please try again later.");
          return;
        }
        if (res.status === 409) {
          setFormError("Details were already submitted for this booking.");
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(data.error ?? "Something went wrong. Try again shortly.");
      } catch {
        setFormError("Network error. Check your connection and retry.");
      } finally {
        setSubmitting(false);
      }
    },
    [account, bookingCode, email, name, phone, router, secureLinkToken]
  );

  return (
    <form
      onSubmit={(ev) => void onSubmit(ev)}
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem" }}>
        Topic: <strong style={{ color: "var(--text)" }}>{topic || "—"}</strong>
        <br />
        Slot: <strong style={{ color: "var(--text)" }}>{slotDisplay || "—"}</strong>
      </p>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Full name</span>
        <input
          name="name"
          value={name}
          onChange={(ev) => setName(ev.target.value)}
          autoComplete="name"
          disabled={submitting}
          style={inputStyle}
        />
        {errors.name ? <span style={errStyle}>{errors.name}</span> : null}
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Email</span>
        <input
          name="email"
          type="email"
          value={email}
          onChange={(ev) => setEmail(ev.target.value)}
          autoComplete="email"
          disabled={submitting}
          style={inputStyle}
        />
        {errors.email ? <span style={errStyle}>{errors.email}</span> : null}
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Phone</span>
        <input
          name="phone"
          type="tel"
          value={phone}
          onChange={(ev) => setPhone(ev.target.value)}
          autoComplete="tel"
          disabled={submitting}
          style={inputStyle}
        />
        {errors.phone ? <span style={errStyle}>{errors.phone}</span> : null}
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
          Account number (optional)
        </span>
        <input
          name="account"
          value={account}
          onChange={(ev) => setAccount(ev.target.value)}
          disabled={submitting}
          style={inputStyle}
        />
        {errors.account ? <span style={errStyle}>{errors.account}</span> : null}
      </label>

      {formError ? (
        <p style={{ margin: 0, color: "#f87171", fontSize: "0.9rem" }} role="alert">
          {formError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        style={{
          marginTop: 4,
          padding: "12px 18px",
          borderRadius: 8,
          border: "none",
          background: "var(--accent)",
          color: "#fff",
          fontWeight: 600,
          cursor: submitting ? "wait" : "pointer",
          fontSize: "1rem",
        }}
      >
        {submitting ? "Submitting…" : "Submit details"}
      </button>
    </form>
  );
}

const inputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #2d3d52",
  background: "#121a24",
  color: "var(--text)",
  fontSize: "1rem",
};

const errStyle: CSSProperties = {
  color: "#f87171",
  fontSize: "0.8rem",
};
