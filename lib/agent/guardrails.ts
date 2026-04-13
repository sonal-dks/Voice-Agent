/**
 * Pre-LLM PII detection — deterministic safety net.
 * Must not false-positive on booking codes (NL-X123), IST times, or common phrases.
 */

const PII_PATTERNS: RegExp[] = [
  /(?<!\w)\+\d{1,3}[\s-]?\d{6,14}\b/,
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/i,
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
];

const PII_EXCLUSIONS =
  /\b(NL-[A-Z0-9]{3,6}|IST|AM|PM|UTC|GMT)\b/gi;

export function containsPii(text: string): boolean {
  const cleaned = text.replace(PII_EXCLUSIONS, "___");
  return PII_PATTERNS.some((re) => re.test(cleaned));
}

const ADVICE_TRIGGERS =
  /\b(should i invest|which fund|best sip|mutual fund|fixed deposit|market timing|stock tip|recommend a fund|where should i put my money)\b/i;

/** Lightweight pre-LLM hint; primary refusal still comes from the model + system prompt. */
export function looksLikeAdviceRequest(text: string): boolean {
  return ADVICE_TRIGGERS.test(text);
}
