// (Design doc 4 and 5) Access keys: one per line; each joining tester gets one. Pure helpers shared by the form and the server.

export const KEY_MAX_LENGTH = 200;

/** The keys typed (one per line, or an array): trimmed, blank lines dropped, each once, in order. */
export function parseKeys(v: unknown): string[] {
  const lines = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? v.split(/\r?\n/) : [];
  const out: string[] = [];
  for (const raw of lines) {
    const k = raw.trim();
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** Keys typed twice in one box: each repeated key once. */
export function repeatedKeys(v: unknown): string[] {
  const lines = (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? v.split(/\r?\n/) : []).map((x) => x.trim()).filter(Boolean);
  return [...new Set(lines.filter((k, i) => lines.indexOf(k) !== i))];
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * "Add 1 more key: 3 open spots, 2 free keys": every open spot needs a free key. "" when there are enough. (Batch 30 §17) Working testers without a key get one of the
 * free keys at Save, so they count too: "Add 2 more keys: 3 working testers and 4 open spots need 7, you have 5."
 */
export function keyNeedLine(openSpots: number, freeKeys: number, keyless = 0) {
  const need = openSpots + keyless;
  const short = need - freeKeys;
  if (short <= 0) return "";
  const add = `Add ${short} more key${short === 1 ? "" : "s"}`;
  if (keyless <= 0) return `${add}: ${plural(openSpots, "open spot")}, ${plural(freeKeys, "free key")}.`;
  const who = openSpots > 0 ? `${plural(keyless, "working tester")} and ${plural(openSpots, "open spot")}` : plural(keyless, "working tester");
  return `${add}: ${who} need${keyless + openSpots === 1 ? "s" : ""} ${need}, you have ${freeKeys}.`;
}
/** (Batch 34 §12) The tester's key box on their session page: the "gave you an access key" line's "See it" jumps to it. */
export const KEY_BOX_ID = "access-key";
/** (Batch 30 §17) The tester's top-box and bell line when the developer's Save gave them a key (the key itself is only on their page). */
export const keyGivenToYouLine = (dev: string, title: string) => `${dev} gave you an access key for “${title}”`;
/** (Batch 30 §17) The event a Save's key leaves (third person: the admin timeline reads it as it is). */
export const keyGivenEventLine = (dev: string, tester: string) => `${dev} gave ${tester} an access key`;

/**
 * (Owner, Oct 28, batch 16 section 18) Keys another tab or device changed: one line per kind, the keys comma-separated, the same under Edit's key boxes and
 * in Save's stop-once box. A key given to a joining tester is its own line ("Ana Silva joined and was given HR-4444"), never under Removed.
 */
export const keysAddedLine = (values: string[]) => `Added: ${values.join(", ")}`;
export const keysRemovedLine = (values: string[]) => `Removed: ${values.join(", ")}`;
export const keyGivenLine = (name: string, value: string) => `${name} joined and was given ${value}`;

const both = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
/**
 * (Owner, Oct 28, batch 16 section 20) A key this tab deleted (not saved yet) that a joining tester was given: a warning, never a mistake. "Ben Okafor joined
 * and was given K-2, which you had deleted here." Several stack: "Ben Okafor and Cam Lee joined and were given K-2 and K-3, which you had deleted here."
 */
export function givenDeletedLine(given: { name: string; value: string }[]) {
  const names = [...new Set(given.map((g) => g.name))], keys = given.map((g) => g.value);
  return `${both(names)} joined and ${names.length === 1 ? "was" : "were"} given ${both(keys)}, which you had deleted here.`;
}

/**
 * Why a typed key can't be added ("" when it can). `status` is the state of the same key already on this test, if any. (Owner, Oct 30, batch 15 sections 19 and 44)
 * Refused only when it's in use by a CURRENT working tester (broken or not) or already free; a key of a tester who left or finished can come back (with a warning).
 */
export function keyRefusal(value: string, status: string | null, who: { working?: boolean; name?: string } = {}) {
  if (!status) return "";
  if (status === "free") return `${value} is already in your free keys.`;
  if ((status === "inuse" || status === "broken") && who.working) return `${value} is in use by ${who.name || "a tester"}, so it can't be added.`;
  return "";
}
/** (Batch 15 section 44) The warning-only line under the Free box for a key typed back in (never a mistake, never blocks Save). */
export const reusedKeyLine = (value: string, name: string, broken: boolean) => (broken ? `${value}: reported as broken by ${name}.` : `${value}: reused, previously given to ${name}.`);
/** The hint under the boxes. */
export const FREE_KEYS_RULE = "Keys in use can't be added. Keys from testers who left or finished can be typed in again; you'll see if one was reported as broken.";

/** (Owner, Oct 29, batch 14 section 6) The developer's quiet live-box line when a tester reports their key (not a stop-once kind, no bell). */
export const keyReportedLine = (name: string) => `${name} reported their key doesn't work`;
/** The Free keys notice's hint (its "in Edit" opens Edit's access keys section in a new tab). */
export const FREE_KEYS_HINT = ["If a tester's key doesn't work, delete a free key ", "in Edit", " and send it to them in a message."] as const;
export const openSpotsKeyLine = (open: number) => `${open} open spot${open === 1 ? "" : "s"}: each new tester gets one.`;
