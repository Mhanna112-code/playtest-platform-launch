// (Owner, Oct 30, batch 15 section 11) Each person's own time zone in bell lines and emails.
// A line that goes to someone (a bell line, an email) is built with time TOKENS: T(date, kind). notify() and bell() turn them into text in the RECIPIENT's time
// zone, naming it ("2:00 PM EST"), when they store the line. The same line can go to two people in two zones and read right for each. Unknown zone: UTC.
// Times on pages keep the viewer's browser clock (they never pass through here).

export type TimeKind = "date" | "dateYear" | "time" | "datetime" | "dayTime" | "weekday";

const TOKEN = /⟦t:([0-9T:.\-Z+]+):(date|dateYear|time|datetime|dayTime|weekday)⟧/g;

/** A time token for a line that is rendered later in its recipient's time zone. */
export const T = (d: Date | string, kind: TimeKind = "datetime") => `⟦t:${new Date(d).toISOString()}:${kind}⟧`;

/** A valid IANA zone name, or "UTC". */
export function safeZone(tz: string | null | undefined) {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** One date in a zone: "Nov 5", "Nov 5, 2026", "2:00 PM EST", "Thu, Nov 5, 2:00 PM EST", "Thu, Nov 5 at 2:00 PM EST", "Thu". Times always name the zone. */
export function fmtIn(tz: string | null | undefined, date: Date | string, kind: TimeKind = "datetime") {
  const d = new Date(date);
  const timeZone = safeZone(tz);
  const time = () => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" });
  switch (kind) {
    case "date":
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });
    case "dateYear":
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone });
    case "weekday":
      return d.toLocaleDateString("en-US", { weekday: "short", timeZone });
    case "time":
      return time();
    case "dayTime":
      return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone })} at ${time()}`;
    default:
      return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone })}, ${time()}`;
  }
}

/** The one helper the spec names: a date for this person, in their own time zone. */
export const fmtFor = (user: { timeZone?: string | null } | null | undefined, date: Date | string, kind: TimeKind = "datetime") => fmtIn(user?.timeZone, date, kind);

/** Every time token in a line, written in this zone. A line without tokens comes back as it was. */
export const renderTimes = (text: string, tz: string | null | undefined) => text.replace(TOKEN, (_m, iso: string, kind: TimeKind) => fmtIn(tz, iso, kind));

/** Any tokens left? (For tests and the check that a stored line was rendered.) */
export const hasTimeTokens = (text: string) => /⟦t:/.test(text);
