import { NextResponse } from "next/server";

import { callAdvisorMcpTool } from "@/lib/mcp/schedulingMcpClient";

export type ValidatedPiiSubmitBody = {
  token: string;
  name: string;
  email: string;
  phone: string;
  account?: string;
};

/**
 * MCP-only PII submit (rate limits must be applied before calling — see `checkPiiSubmitRateLimits`).
 */
export async function submitPiiViaMcp(
  pathBookingCode: string,
  body: ValidatedPiiSubmitBody
): Promise<NextResponse> {
  const code = decodeURIComponent(pathBookingCode ?? "").trim();
  if (!code) {
    return NextResponse.json({ error: "Missing booking code" }, { status: 400 });
  }

  const result = await callAdvisorMcpTool("submit_pii_booking", {
    booking_code: code,
    secure_link_token: body.token,
    name: body.name,
    email: body.email,
    phone: body.phone,
    account: body.account,
  });

  if (result.ok === true) {
    return NextResponse.json(
      {
        success: true,
        calendar_patched: result.calendar_patched,
        user_email_sent: result.user_email_sent,
        advisor_email_sent: result.advisor_email_sent,
        email_errors: result.email_errors,
        message: result.message,
      },
      { status: 201 }
    );
  }

  const err = String(result.error ?? "unknown");
  if (err === "already_submitted") {
    return NextResponse.json({ error: "Details already submitted" }, { status: 409 });
  }
  if (
    err === "booking_not_found" ||
    err === "invalid_token" ||
    err === "scheduling_not_configured"
  ) {
    return NextResponse.json({ error: "Invalid or expired booking" }, { status: 404 });
  }
  if (err === "pii_encryption_misconfigured") {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  return NextResponse.json(
    { error: typeof result.message === "string" ? result.message : "Submit failed" },
    { status: 502 }
  );
}
