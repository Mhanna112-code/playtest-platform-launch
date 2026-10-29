/** Counts with thousands separators: 1,240. */
export const num = (n: number) => n.toLocaleString("en-US");

/** $12,403.50 from 1240350 cents (money being acted on is always exact, with separators). */
export const money = (cents: number | null | undefined) =>
  cents == null || Number.isNaN(cents) ? "–" : (cents < 0 ? "-$" : "$") + (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * (Design doc 2) Big stat tiles only: under 10,000 in full (with separators); then one decimal and k, M, B, T ("12.4k", "1.2M");
 * 10^15 and up as "1.2 × 10^15". No trailing ".0". Percentages and days are left as they are.
 */
export function compact(n: number): string {
  const abs = Math.abs(n), sign = n < 0 ? "-" : "";
  if (abs < 10_000) return sign + (Number.isInteger(abs) ? num(abs) : abs.toLocaleString("en-US", { maximumFractionDigits: 2 }));
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, "");
  const units: [number, string][] = [[1e3, "k"], [1e6, "M"], [1e9, "B"], [1e12, "T"], [1e15, ""]];
  for (let i = 0; i < 4; i++) {
    const [base, suffix] = units[i];
    const v = abs / base;
    // 999,950 rounds to 1000k: it is 1M.
    if (abs < units[i + 1][0] && Number(trim(v)) < 1000) return sign + trim(v) + suffix;
  }
  const exp = Math.floor(Math.log10(abs));
  let m = Number((abs / 10 ** exp).toFixed(1)), e = exp;
  if (m >= 10) { m = 1; e += 1; }
  return `${sign}${m.toFixed(1).replace(/\.0$/, "")} × 10^${e}`;
}

/** A money stat tile: exact under $10,000 ("$4,203.50"), then "$12.4k". */
export const compactMoney = (cents: number) => (Math.abs(cents) < 1_000_000 ? money(cents) : (cents < 0 ? "-$" : "$") + compact(Math.abs(cents) / 100));

/**
 * Dollars typed or sent ("7.50", "$7.5", 7.5) to cents. (Owner, Oct 28, batch 16 section 36) Any number of decimals is accepted and rounded to the cent,
 * half up, from the digits themselves (1.4545 → 145, 2.005 → 201, 0.495 → 50), so no float error moves a charge; limits apply to the rounded value.
 * Letters, negative numbers and empty boxes stay refused (null).
 */
export function toCents(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? toCents(v.toFixed(6)) : null;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^\$/, "");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const f = (m[2] ?? "").padEnd(3, "0");
  return Number(m[1]) * 100 + Number(f.slice(0, 2)) + (f[2] >= "5" ? 1 : 0);
}
/** A money box's value after it's left: rounded to the cent ("1.4545" → "1.45"), or as typed when it isn't an amount (the red line says why). */
export const roundedMoneyText = (typed: string) => {
  const c = toCents(typed);
  return c == null ? typed : `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
};

export const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) && s.length <= 254;
export const normEmail = (s: string) => s.trim().toLowerCase();

/** A person's name for others to read: their name, or the part of their email before the @. */
export const displayName = (u: { name?: string | null; email: string; deletedAt?: Date | null }) => (u.deletedAt ? "Deleted account" : u.name?.trim() ? u.name.trim() : u.email.split("@")[0]);

/** "they" unless a pronoun is on record. */
export function pronouns(p: string | null | undefined) {
  if (p === "she") return { subj: "she", obj: "her", poss: "her" };
  if (p === "he") return { subj: "he", obj: "him", poss: "his" };
  return { subj: "they", obj: "them", poss: "their" };
}

export const fmtDateTime = (d: Date | string) =>
  new Date(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** `{ timeZone }` for a saved zone this runtime knows; nothing (the server's clock) for none or an unknown one. */
export function zoneOpt(tz?: string | null): { timeZone?: string } {
  if (!tz) return {};
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return { timeZone: tz };
  } catch {
    return {};
  }
}
/**
 * (Owner, Oct 29, batch 25 section 1) fmtDateTime in a person's own saved time zone ("Mon, Nov 2, 3:10 PM"), for a time a server-rendered page shows them. No saved zone:
 * the server's clock, as before.
 */
export const fmtDateTimeIn = (d: Date | string, tz?: string | null) =>
  new Date(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...zoneOpt(tz) });
/** (Batch 26 section 3) "3:10 PM" in a person's saved zone (none: the server's clock). */
export const fmtTimeIn = (d: Date | string, tz?: string | null) => new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...zoneOpt(tz) });
/** (Batch 26 section 3) A stop's time as the stop lines say it: "3:10 PM" within 12 hours, else "Tue, Nov 3, 3:10 PM", in the person's saved zone. */
export const stopTimeIn = (d: Date, tz?: string | null, now = new Date()) => (now.getTime() - d.getTime() < 12 * 3_600_000 ? fmtTimeIn(d, tz) : fmtDateTimeIn(d, tz));
export const fmtTime = (d: Date | string) => new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
export const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
