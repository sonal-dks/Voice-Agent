# Phase 3 — AI Evals

## What AI capability this phase introduces or modifies

Phase 3 extends the **Groq** conversation engine from intent classification (Phase 2) to multi-turn booking flow orchestration: the LLM must decide when to call `offer_slots`, correctly parse the caller's slot selection from natural language, and call `confirm_booking` with the right arguments. This is the first phase where LLM tool-calling accuracy directly impacts a database write.

## Eval dataset

| Property | Value |
|----------|-------|
| Source | Synthetic multi-turn conversations covering all 5 topics, various time preferences (morning, afternoon, evening, specific times, relative dates), slot selection phrasing variations, and ambiguous responses |
| Size | 80 multi-turn flows: 40 happy path completions, 20 ambiguous/clarification flows, 10 waitlist triggers, 10 topic-change mid-flow |
| Format | JSONL — each record: `{"turns": [{"role": "user", "content": "..."}, ...], "expected_tool_calls": [...], "expected_booking_fields": {...}}` |
| Location | `./eval-data/phase-3-scheduling-golden.jsonl` |
| Refresh policy | Add 10 new flows per sprint from production call transcripts where booking failed or required clarification |

---

## EVAL-3-01: Booking flow completion rate

### What it measures

The percentage of simulated booking conversations where the LLM correctly completes the full flow: topic confirmation → time collection → `offer_slots` call with correct args → slot selection parsing → `confirm_booking` call with correct args.

### How to run

```bash
python evals/run_eval.py \
  --phase 3 \
  --eval booking_completion \
  --dataset ./eval-data/phase-3-scheduling-golden.jsonl \
  --output ./eval-results/phase-3-booking-completion.json
```

### Metrics

| Metric | Definition | How measured |
|--------|------------|--------------|
| Flow completion rate | % of flows where all expected tool calls are made with correct arguments and the booking is created | Automated — tool call sequence comparison |
| Tool call accuracy | % of individual tool calls where the function name and all arguments match expected values | Automated — per-argument exact or fuzzy match |
| Slot selection accuracy | % of flows where the LLM correctly identifies which of the 2 offered slots the caller selected | Automated — match selected_slot_key against expected |
| Clarification efficiency | Average number of extra turns needed when the caller's response is ambiguous | Automated — count turns between offer and confirmation |

### Acceptance thresholds

| Metric | Threshold | Gate type | Action if not met |
|--------|-----------|-----------|-------------------|
| Flow completion rate | ≥ 0.90 | **Hard** — phase cannot ship | Analyze failed flows; common fixes: add examples of time preference phrasing to system prompt; tighten `offer_slots` parameter descriptions |
| Tool call accuracy | ≥ 0.95 | **Hard** — phase cannot ship | Identify which arguments are wrong; most common: `day` parsing ("this Friday" → wrong date). Add date parsing examples to function descriptions. |
| Slot selection accuracy | ≥ 0.95 | **Hard** — phase cannot ship | Add examples of selection phrasing: "the first one", "2 PM", "the earlier slot", "let's go with the second option" |
| Clarification efficiency | ≤ 2.0 extra turns | **Soft** — document exception | Acceptable up to 3.0 turns; beyond that, the LLM is not understanding slot selections |

### Baseline

No baseline — first scheduling eval. Phase 2 evals cover intent classification; this eval covers the tool-calling orchestration layer.

### Expected result

Flow completion ≥ 0.90 because the booking flow is linear (topic → time → offer → select → confirm) and the Groq model follows explicit tool-calling sequences. The main risk is ambiguous time preferences ("sometime next week") that the model must resolve to a specific day parameter.

### Failure analysis guide

- **Flow completion < 0.90** → Categorize failures: (a) `offer_slots` never called → LLM didn't recognize it was time to offer slots; add explicit phase transition instruction to system prompt. (b) `confirm_booking` never called → LLM didn't recognize slot selection; add more selection phrasing examples. (c) Wrong arguments → see tool call accuracy below.
- **Tool call accuracy < 0.95** → Inspect wrong arguments. Common: `day` is wrong for relative dates ("this Friday" when today is Wednesday). Fix: add current date to the system prompt dynamically. `time_preference` may be too vague ("sometime") — add default handling in function description.
- **Slot selection < 0.95** → Inspect mismatches. Common: caller says "the first one" but LLM maps to wrong slot. Fix: include slot ordering context in the LLM's tool result message.

---

## Sign-off

| Eval ID | Metric | Result | Threshold | Met? | Reviewer | Date |
|---------|--------|--------|-----------|------|----------|------|
| EVAL-3-01 | Flow completion rate | — | ≥ 0.90 | ⬜ | — | — |
| EVAL-3-01 | Tool call accuracy | — | ≥ 0.95 | ⬜ | — | — |
| EVAL-3-01 | Slot selection accuracy | — | ≥ 0.95 | ⬜ | — | — |
| EVAL-3-01 | Clarification efficiency | — | ≤ 2.0 turns | ⬜ | — | — |
