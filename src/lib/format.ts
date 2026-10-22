/** $12.50 from 1250 cents. */
export const money = (cents: number | null | undefined) =>
  cents == null || Number.isNaN(cents) ? "–" : (cents < 0 ? "-$" : "$") + (Math.abs(cents) / 100).toFixed(2);

/** "12.50" → 1250; null when not a valid amount. */
export function toCents(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

export const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) && s.length <= 254;
export const normEmail = (s: string) => s.trim().toLowerCase();

/** A person's name for others to read: their name, or the part of their email before the @. */
export const displayName = (u: { name?: string | null; email: string }) => (u.name?.trim() ? u.name.trim() : u.email.split("@")[0]);

/** "they" unless a pronoun is on record. */
export function pronouns(p: string | null | undefined) {
  if (p === "she") return { subj: "she", obj: "her", poss: "her" };
  if (p === "he") return { subj: "he", obj: "him", poss: "his" };
  return { subj: "they", obj: "them", poss: "their" };
}

export const fmtDateTime = (d: Date | string) =>
  new Date(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const fmtTime = (d: Date | string) => new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
export const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
