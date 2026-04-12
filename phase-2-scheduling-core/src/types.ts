/** Shared scheduling types — Phase 2 scheduling core */

export interface OfferedSlot {
  /** Stable id the model passes back to confirm_booking (ISO start instant) */
  key: string;
  /** Human-readable in IST, e.g. "Wed 16 Apr 2026, 2:30 PM IST" */
  display: string;
  startIso: string;
  endIso: string;
}

export interface BookingRowInput {
  booking_code: string;
  topic: string;
  slot_time: string;
  slot_display: string;
  status: "confirmed" | "waitlisted";
  google_event_id: string;
  side_effects_completed: string;
  secure_link_token: string;
  pii_submitted: string;
  created_at: string;
  updated_at: string;
}
