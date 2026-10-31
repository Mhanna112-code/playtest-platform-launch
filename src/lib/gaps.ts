// The full app's "What this test needs" words (lib/devices.ts) on lean data: what a tester's profile lacks for a test.
export type Gaps = { languages: string[]; devices: string[] };
/** (Batch 35 §56) The press the needs pop-up sends: its main button names it ("Ask to rejoin anyway" / "Apply anyway" / "Join anyway"). */
export type GapAsk = "apply" | "join" | "rejoin";

export const noGaps = (g: Gaps | null | undefined) => !g || (!g.languages.length && !g.devices.length);
/**
 * (Owner, Oct 31, batch 35 §47) The kinds missing: the same one-or-none rule as the developer's Invite rows (testerNeedsChangedLines, the "Doesn't list languages"
 * badge): a kind (devices, languages) is missing only when the profile lists NONE of the test's items of that kind; listing at least one covers it.
 */
export const gapKinds = (g: Gaps | null | undefined): ("devices" | "languages")[] => (!g ? [] : [...(g.devices.length ? ["devices" as const] : []), ...(g.languages.length ? ["languages" as const] : [])]);
/** A kind is missing now that the pop-up didn't show as missing (a kind that flipped from covered to missing). Items within a kind already missing are no news. */
export const gapsUnseen = (now: Gaps, shown: Gaps) => gapKinds(now).some((k) => !gapKinds(shown).includes(k));
/** (Batch 35 §47) The same kinds missing: a second item added or dropped within a kind (covered or missing) changes nothing. */
export const sameGaps = (a: Gaps, b: Gaps) => gapKinds(a).join("|") === gapKinds(b).join("|");
/** The same items too (the pop-up's words name a missing kind's items: refreshed silently when only they changed). */
export const sameGapItems = (a: Gaps, b: Gaps) => a.languages.join("|") === b.languages.join("|") && a.devices.join("|") === b.devices.join("|");

// ---------- (Owner, Oct 31, batch 35 §44) where a change in the pop-up came from ----------

/** What the pop-up (or the page) last knew: the profile's and the test's needs' save times (server times, ISO). */
export type GapTimes = { profileAt?: string; needsAt?: string };
/** Which changed since `base`: the tester's own profile (saved in another tab or device), the developer's needs, or both; empty when neither is newer. */
export function gapSources(base: GapTimes, now: GapTimes): GapTimes {
  const newer = (a?: string, b?: string) => !!b && (!a || b > a);
  return { ...(newer(base.profileAt, now.profileAt) ? { profileAt: now.profileAt } : {}), ...(newer(base.needsAt, now.needsAt) ? { needsAt: now.needsAt } : {}) };
}
/** "You updated your profile in another tab (3:20 AM):" */
export const profileUpdatedLabel = (time: string) => `You updated your profile in another tab (${time}):`;
/** "Nora Lane changed what this test needs (3:20 AM):" */
export const needsChangedLabel = (dev: string, time: string) => `${dev} changed what this test needs (${time}):`;
/** The labels for a change from these sources (both: both lines, the profile's first); none known: the plain "Just updated (3:20 AM):". */
export function updateLabels(from: GapTimes, dev: string, clock: (iso: string) => string, at: string) {
  const out = [...(from.profileAt ? [profileUpdatedLabel(clock(from.profileAt))] : []), ...(from.needsAt ? [needsChangedLabel(dev, clock(from.needsAt))] : [])];
  return out.length ? out : [`Just updated (${clock(at)}):`];
}
/** The page's line once the pop-up closed covered: "You updated your profile in another tab (3:20 AM): you now meet this test's needs. Press Join to join." */
export function coveredLine(from: GapTimes, dev: string, clock: (iso: string) => string, at: string, ask: GapAsk) {
  const tail = `${from.profileAt || from.needsAt ? "you" : "You"} now meet this test's needs. ${pressToLine(ask)}`;
  return `${updateLabels(from, dev, clock, at).join(" ")} ${tail}`;
}

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
  rejoin: { question: "Ask to rejoin anyway?", anyway: "Ask to rejoin anyway", plain: "Ask to rejoin" },
};
/** (Batch 35 §56) The pop-up's press for a join-page action: Apply, Ask to rejoin, or Join. */
export const gapAskOf = (action: string): GapAsk => (action === "apply" ? "apply" : action === "rejoin-ask" ? "rejoin" : "join");
/** "Press Join to join." / "Press Apply to apply." / "Press Ask to rejoin to ask to rejoin." */
export const pressToLine = (ask: GapAsk) => `Press ${TESTER_ASK[ask].plain} to ${TESTER_ASK[ask].plain.toLowerCase()}.`;
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
