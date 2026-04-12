# Phase 3 — Tests (checklist)

Manual / CI targets aligned with architecture TC-5 style cases:

- [ ] Valid `?token=` loads form with correct topic + slot from MCP lookup.
- [ ] Missing or wrong token → invalid / redirect.
- [ ] `pii_submitted=true` → redirect to confirmed.
- [ ] Submit success → 201, row in PII tab, emails when Gmail configured.
- [ ] Duplicate submit → 409.
- [ ] Rate limit → 429.
