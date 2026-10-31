// (Design doc 6) The Alerts menu: which update notifications interrupt the developer's sensitive actions. Ticked types are IGNORED:
// they no longer stop a press, and show greyed in the live top box. A payment hold or pause, the test being stopped and final refusals are
// never in the menu: they always stop. (Owner, Oct 28, batch 16 section 21) A tester who deleted their account or was suspended counts as a
// tester leaving ("Testers leaving"); what the developer did in another tab is never news and isn't in the menu (batch 35 §67: it stops every press once).
export const ALERT_TYPES = [
  { key: "joins", label: "Joins and applications" },
  { key: "leaving", label: "Testers leaving" },
  { key: "work", label: "Work sent" },
  { key: "calls", label: "Call changes" },
  { key: "payments", label: "Payments (going through or failing)" },
  { key: "disputes", label: "Disputes" },
  { key: "admin", label: "Decisions by the team" },
  // (Owner, Oct 31, batch 35 §69) No "Listing changes" for the developer: their own saves always stop and nobody else edits their listing. A stored "listing" tick
  // is ignored. (Testers keep listing changes in their own Alerts.)
] as const;
/** (Owner, Oct 30, batch 15 section 39) The Alerts a paused test (any cause) still lists: what can still happen while paused. */
export const PAUSED_ALERTS = ["leaving", "calls", "payments", "disputes", "admin"] as const;
/** A stopped test (the developer's or the team's stop): every call ahead was cancelled at the stop, and nobody can leave. */
export const STOPPED_ALERTS = ["payments", "disputes", "admin"] as const;
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
    case "info": case "renamed": case "edited": return null; // (batch 35 §69) listing changes always stop the developer; (batch 14) a tester's Switch is a quiet line
    default: return null; // paused, chargeback, stopped, ...: always stop
  }
}
