// The full app's "What this test needs" words (lib/devices.ts) on lean data: what a tester's profile lacks for a test.
export type Gaps = { languages: string[]; devices: string[] };
export type GapAsk = "apply" | "join";

export const noGaps = (g: Gaps | null | undefined) => !g || (!g.languages.length && !g.devices.length);
/** Something is missing now that the pop-up didn't show. */
export const gapsUnseen = (now: Gaps, shown: Gaps) => now.languages.some((l) => !shown.languages.includes(l)) || now.devices.some((d) => !shown.devices.includes(d));
export const sameGaps = (a: Gaps, b: Gaps) => a.languages.join("|") === b.languages.join("|") && a.devices.join("|") === b.devices.join("|");

/** What a tester's profile lacks for a test: the test's languages / devices when the profile lists none of them. */
export function gapsOf(t: { devices: string[]; languages: string[] }, p: { devices: string[]; languages: string[] } | null): Gaps {
  return {
    languages: t.languages.length && !t.languages.some((l) => p?.languages.includes(l)) ? t.languages : [],
    devices: t.devices.length && !t.devices.some((d) => p?.devices.includes(d)) ? t.devices : [],
  };
}

/** The Invite panel's notice when nobody ticked misses a need any more (the server's "needs_none" line reads the same). */
export const EVERYONE_MEETS = "Everyone you ticked now meets this test's needs. Press Invite to send.";
/**
 * (Owner's bug, Oct 31, batch 35 §21) Is that notice true NOW: someone is ticked, and every ticked tester's profile as the panel shows it meets the test's current
 * needs? After a stop for a needs change (the test now needs Spanish) the old notice stayed beside rows tagged "Doesn't list languages"; it shows only while true.
 */
export function everyoneMeets(needs: { devices: string[]; languages: string[] }, ticked: string[], shown: ReadonlyMap<string, { devices: string[]; languages: string[] }>) {
  if (!ticked.length) return false;
  return ticked.every((id) => {
    const t = shown.get(id);
    if (!t) return false;
    const g = gapsOf(needs, t);
    return !g.devices.length && !g.languages.length;
  });
}

export function readGaps(raw: unknown): Gaps | null {
  try {
    const v = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<Gaps> | null;
    if (!v || typeof v !== "object") return null;
    return { languages: Array.isArray(v.languages) ? v.languages.map(String) : [], devices: Array.isArray(v.devices) ? v.devices.map(String) : [] };
  } catch {
    return null;
  }
}

const list = (x: string[]) => (x.length < 2 ? x.join("") : `${x.slice(0, -1).join(", ")} or ${x[x.length - 1]}`);

/** "doesn't list Spanish, which this test needs, or iOS or Android, which it runs on". */
export function gapsWords(g: Gaps) {
  if (g.languages.length && g.devices.length) return `doesn't list ${list(g.languages)}, which this test needs, or ${list(g.devices)}, which it runs on`;
  if (g.languages.length) return `doesn't list ${list(g.languages)}, which this test needs`;
  return `doesn't list ${list(g.devices)}, which this test runs on`;
}

export const TESTER_ASK: Record<GapAsk, { question: string; anyway: string; plain: string }> = {
  apply: { question: "Apply anyway?", anyway: "Apply anyway", plain: "Apply" },
  join: { question: "Join anyway?", anyway: "Join anyway", plain: "Join" },
};
export const PROFILE_COVERS = "Your profile now covers what this test needs.";
// (Batch 20 section 3) The Join anyway box names both kinds in the Invite anyway box's words.
export const testerGapText = (g: Gaps, ask: GapAsk) => (noGaps(g) ? PROFILE_COVERS : `Your profile ${missingNeedText(g)}. ${TESTER_ASK[ask].question}`);
export const testerGapButton = (g: Gaps, ask: GapAsk) => (noGaps(g) ? TESTER_ASK[ask].plain : TESTER_ASK[ask].anyway);

/** (Owner, Oct 28, batch 20 section 3) "A, B or C": every item, the last joined with "or". */
export const orList = list;
/**
 * (Batch 20 section 3) Everything a profile is missing, both kinds in one: "doesn't list a language this test needs (Chinese or Portuguese) or a device it needs
 * (Windows PC or iPad)"; with only one kind missing, only that part ("doesn't list a device this test needs (Windows PC or iPad)").
 */
export function missingNeedText(g: Gaps) {
  if (g.languages.length && g.devices.length) return `doesn't list a language this test needs (${list(g.languages)}) or a device it needs (${list(g.devices)})`;
  if (g.languages.length) return `doesn't list a language this test needs (${list(g.languages)})`;
  if (g.devices.length) return `doesn't list a device this test needs (${list(g.devices)})`;
  return "";
}
/** (Batch 20 section 3) One line per ticked tester in the Invite anyway box (and the server's gap lines, which `seenGaps` compares): "fbbb doesn't list … ." */
export const missingNeedLine = (name: string, g: Gaps) => `${name} ${missingNeedText(g)}.`;
/** A gap line (as opposed to the box's "What's missing changed since you looked" heading). */
export const isMissingNeedLine = (l: string) => / doesn't list a (language|device) this test needs \(.*\)\.$/.test(l);
/** (Batch 20 section 3) What the Invite anyway box gets with its lines: who, and what's missing (so a long list can be cut to 3 with "+N more"). */
export type GapItem = Gaps & { name: string };
