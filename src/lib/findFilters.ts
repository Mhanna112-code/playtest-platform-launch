import { CATEGORIES, DEVICES, LANGUAGES } from "@/lib/options";

/**
 * (Owner, Nov 3, batch 35 §144) Find's tick-box filters, shared by the page (server) and its filters form (client). Rules: a test shows when it has
 * EVERY ticked category, needs no device or one of the ticked devices, needs no language or one of the ticked languages, and offers ANY ticked part;
 * a group with nothing ticked doesn't filter. The groups combine with AND.
 */
export const FIND_PARTS = { written: "Written answers", recording: "Screen recording", live: "Live call" } as const;
export type FindPart = keyof typeof FIND_PARTS;
const PART_KEYS = Object.keys(FIND_PARTS) as FindPart[];

export type FindTicks = { categories: string[]; devices: string[]; languages: string[]; parts: FindPart[] };
export type FindSp = { category?: string | string[]; device?: string | string[]; lang?: string | string[]; part?: string | string[]; sort?: string | string[]; mine?: string | string[]; q?: string | string[]; states?: string | string[] };
type Profile = { devices: string[]; languages: string[] } | null;
type Testish = { categories: string[]; devices: string[]; languages: string[]; writtenCents: number | null; recordingCents: number | null; liveRateCents: number | null };

/** A repeated GET param (`?device=Mac&device=Linux`) or an old single one, kept to the known values, in the list's order, once each. */
export function ticksOf(v: string | string[] | undefined, known: readonly string[]): string[] {
  const got = new Set((Array.isArray(v) ? v : v == null ? [] : [v]).map((x) => String(x).trim()));
  return known.filter((k) => got.has(k));
}
/** The first value of a param that may be repeated (sort, mine, q, states). */
export const oneOf = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The profile's devices and languages as ticks (only the ones Find has a box for). */
export const profileTicks = (p: Profile) => ({ devices: ticksOf(p?.devices, DEVICES), languages: ticksOf(p?.languages, LANGUAGES) });

/** (Owner, Nov 3) `mine=1`: the profile's devices and languages ARE the device and language ticks (whatever else the link says). */
export function ticksFrom(sp: FindSp, mine: boolean, profile: Profile): FindTicks {
  const own = mine ? profileTicks(profile) : null;
  return {
    categories: ticksOf(sp.category, CATEGORIES),
    devices: own ? own.devices : ticksOf(sp.device, DEVICES),
    languages: own ? own.languages : ticksOf(sp.lang, LANGUAGES),
    parts: ticksOf(sp.part, PART_KEYS) as FindPart[],
  };
}

const offers = (t: Testish, p: FindPart) => (p === "written" ? t.writtenCents != null : p === "recording" ? t.recordingCents != null : t.liveRateCents != null);
/** Whether a test passes the ticks: AND for categories, OR within devices / languages / parts, AND across the groups. */
export function passesTicks(t: Testish, f: FindTicks) {
  return f.categories.every((c) => t.categories.includes(c))
    && (!f.devices.length || !t.devices.length || t.devices.some((d) => f.devices.includes(d)))
    && (!f.languages.length || !t.languages.length || t.languages.some((l) => f.languages.includes(l)))
    && (!f.parts.length || f.parts.some((p) => offers(t, p)));
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
/**
 * (Owner, Nov 3) Show follows the ticks: "Matching my profile" while the device and language ticks are exactly the profile's (a profile with
 * something in it), else "Everything".
 */
export function showFor(ticks: { devices: string[]; languages: string[] }, profile: Profile): "1" | "0" {
  const own = profileTicks(profile);
  if (!own.devices.length && !own.languages.length) return "0";
  return sameSet(ticks.devices, own.devices) && sameSet(ticks.languages, own.languages) ? "1" : "0";
}

/**
 * (Owner, Nov 3) Which empty state Find shows when no card is left (the profile never hides tests by itself: only "Matching my profile" does).
 * `nothing`: nothing open to this account; `profile`: the categories and parts alone leave `n` tests, and Matching my profile hid them;
 * `filters`: the ticks hid all `n` open tests.
 */
export function findEmpty(open: Testish[], f: FindTicks, mine: boolean): { kind: "nothing" } | { kind: "profile" | "filters"; n: number } {
  if (!open.length) return { kind: "nothing" };
  const withoutProfile = mine ? open.filter((t) => passesTicks(t, { ...f, devices: [], languages: [] })).length : 0;
  return withoutProfile ? { kind: "profile", n: withoutProfile } : { kind: "filters", n: open.length };
}
export const profileHidLine = (n: number) => `${n} open ${n === 1 ? "test needs" : "tests need"} a device or language that isn't on your profile.`;
export const filtersHidLine = (n: number) => `${n} open ${n === 1 ? "test doesn't" : "tests don't"} match.`;

/** What a Find link keeps: the ticks, sort, Show and the search (admin: the states). */
export type FindLink = Partial<FindTicks> & { sort?: string; mine?: boolean; q?: string; states?: string };
/** Find's address with repeated params (`?category=Game&category=Social`); with `mine` the profile stands for the device and language ticks. */
export function findHref(l: FindLink) {
  const q = new URLSearchParams();
  for (const c of l.categories ?? []) q.append("category", c);
  if (l.mine) q.set("mine", "1");
  else {
    for (const d of l.devices ?? []) q.append("device", d);
    for (const g of l.languages ?? []) q.append("lang", g);
  }
  for (const p of l.parts ?? []) q.append("part", p);
  if (l.sort) q.set("sort", l.sort);
  if (l.q) q.set("q", l.q);
  if (l.states) q.set("states", l.states);
  const s = q.toString();
  return s ? `/app/find?${s}` : "/app/find";
}
