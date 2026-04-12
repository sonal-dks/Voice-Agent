/** Session + tool payloads for scheduling (no Google SDK imports). Phase 2 — see Docs/architecture.md §14. */

export interface OfferedSlot {
  key: string;
  display: string;
  startIso: string;
  endIso: string;
}
