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

/** "Add 1 more key: 3 open spots, 2 free keys": every open spot needs a free key. "" when there are enough. */
export function keyNeedLine(openSpots: number, freeKeys: number) {
  const short = openSpots - freeKeys;
  return short > 0 ? `Add ${short} more key${short === 1 ? "" : "s"}: ${plural(openSpots, "open spot")}, ${plural(freeKeys, "free key")}.` : "";
}

/** Why a typed key can't be added ("" when it can). `status` is the state of the same key already on this test, if any. */
export function keyRefusal(value: string, status: string | null) {
  if (!status) return "";
  if (status === "free") return `${value} is already in your free keys.`;
  if (status === "inuse") return `${value} is already in use by a tester, so it can't be added again.`;
  if (status === "held") return `${value} was given to a tester who left the test, so it can't be used again.`;
  return `${value} was reported as not working or was replaced, so it can't be used again.`;
}
