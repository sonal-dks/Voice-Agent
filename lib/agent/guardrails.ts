/**
 * Pre-LLM PII detection — deterministic safety net.
 */

const PII_PATTERNS: RegExp[] = [
  /\b\d{10}\b/,
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  /\+\d{1,3}\s?\d{6,14}\b/,
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/i,
  /\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/,
  /\b[A-Z]{2,5}\d{8,20}\b/,
];

export function containsPii(text: string): boolean {
  return PII_PATTERNS.some((re) => re.test(text));
}

const ADVICE_TRIGGERS =
  /\b(should i invest|which fund|best sip|mutual fund|fixed deposit|market timing|stock tip|recommend a fund|where should i put my money)\b/i;

/** Lightweight pre-LLM hint; primary refusal still comes from the model + system prompt. */
export function looksLikeAdviceRequest(text: string): boolean {
  return ADVICE_TRIGGERS.test(text);
}
