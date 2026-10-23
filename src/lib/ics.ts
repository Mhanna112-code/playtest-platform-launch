// The full app's .ics for a booked call (app/live/[slotId]/ics there).
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// Commas, semicolons and backslashes must be escaped in iCalendar text.
const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/[,;]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");

export function callIcs(c: { id: string; startsAt: Date; minutes: number; title: string; url: string }, now = new Date()) {
  const end = new Date(c.startsAt.getTime() + c.minutes * 60_000);
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Playtest//Live calls//EN", "BEGIN:VEVENT",
    `UID:${c.id}@playtest`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(c.startsAt)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${text(`Live call: ${c.title}`)}`,
    `DESCRIPTION:${text(`Join the call: ${c.url}`)}`, `URL:${c.url}`, `LOCATION:${text(c.url)}`,
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}
