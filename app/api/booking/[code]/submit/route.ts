import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { loadRepoRootEnv } from "@/lib/env/loadRepoRootEnv";
import { checkPiiSubmitRateLimits } from "@/phase-3-post-call-pii/lib/rateLimitPiiSubmit";
import { submitPiiViaMcp } from "@/phase-3-post-call-pii/lib/postPiiSubmit";

export const runtime = "nodejs";

const BodySchema = z.object({
  token: z.string().uuid(),
  name: z.string().min(1).max(200),
  email: z.string().email(),
  phone: z.string().min(5).max(40),
  account: z.string().max(80).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  loadRepoRootEnv();
  const limited = checkPiiSubmitRateLimits(request, params.code);
  if (limited) return limited;

  let body: z.infer<typeof BodySchema>;
  try {
    const json = await request.json();
    body = BodySchema.parse(json);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  return submitPiiViaMcp(params.code, body);
}
