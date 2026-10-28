// (Design doc 6) The Alerts menu: which update notifications interrupt the developer's sensitive actions. Ticked types are IGNORED:
// they no longer stop a press, and show greyed in the live top box. A payment hold or pause, a closed tester account, the test being
// stopped and final refusals are never in the menu: they always stop.
export const ALERT_TYPES = [
  { key: "joins", label: "Joins and applications" },
  { key: "leaving", label: "Testers leaving" },
  { key: "work", label: "Work sent" },
  { key: "calls", label: "Call changes" },
  { key: "payments", label: "Payments (going through or failing)" },
  { key: "disputes", label: "Disputes" },
  { key: "admin", label: "Decisions by the team" },
  { key: "own", label: "Your saves and presses in another tab" },
  { key: "listing", label: "Listing changes" },
] as const;
export type AlertKey = (typeof ALERT_TYPES)[number]["key"];
export const alertLabel = (k: string) => ALERT_TYPES.find((a) => a.key === k)?.label ?? k;

/** Which Alerts type an update belongs to; null = never ignorable (always stops). */
export function alertOf(kind: string): AlertKey | null {
  switch (kind) {
    case "joined": case "applied": case "invite": case "invited": case "full": case "spot_open": return "joins";
    case "left": return "leaving";
    case "sent": return "work";
    case "booked": case "confirmed": case "cancelled": case "offered": case "removed": case "requested": case "withdrew_req": case "declined_req": return "calls";
    case "paid": case "rejected": case "choice": case "payment": return "payments";
    case "dispute": return "disputes";
    case "admin": return "admin";
    case "own": return "own";
    case "info": case "renamed": case "edited": return "listing"; // (batch 14) a tester's Switch is a quiet line, not an alert type
    default: return null; // paused, chargeback, stopped, ...: always stop
  }
}
