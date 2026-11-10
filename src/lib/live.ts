import { useEffect, useRef } from "react";
import type { Change } from "@/components/ChangesBox";
import type { Press } from "@/lib/server/live";
import { devKeeps } from "./pressForce";

// The page's "seen" marker moves forward as the live top notice shows changes (owner, NEWEST+3): every button sends
// the later of the page's own render time and the last time the notice showed everything.
let shownUpTo = "";
let scope = "";

export function setShown(s: string, at: string) {
  scope = s;
  if (!shownUpTo || at > shownUpTo) shownUpTo = at;
}
/**
 * (Owner, Oct 31, batch 35 §90) An update the page has shown (redrawn, the pill up, or the top box) counts as seen at once, call changes too: no stop notice for it
 * afterwards. Replaces batch 32 §12 (seen only once the top box was in view) and batch 16 §38B (a call change stopped until a stop box listed it).
 */
export function setShownOnPage(s: string, at: string) {
  setShown(s, at);
  if (at > boxSeenUpTo) boxSeenUpTo = at;
}
export function clearShown(s: string) {
  if (scope === s) {
    scope = "";
    shownUpTo = "";
  }
}
/**
 * (Owner, Oct 28, batch 16 section 38B) When this page first loaded in this tab (a refresh of its data never moves it), and the newest change a stop box under a button
 * has listed. A tester's press sends both: a call change stops it once even when the live box or a refresh already showed it, until a stop box has listed it.
 */
let loaded: { path: string; at: string } | null = null;
let boxSeenUpTo = "";
export function notePageLoaded(at: string) {
  if (typeof window === "undefined") return;
  const path = window.location.pathname;
  if (!loaded || loaded.path !== path) {
    loaded = { path, at };
    boxSeenUpTo = "";
  }
}
export const pageLoadedAt = () => (loaded && typeof window !== "undefined" && loaded.path === window.location.pathname ? loaded.at : "");
export const boxSeenAt = () => boxSeenUpTo;

/**
 * The seen marker a press sends: the page's render time, or later if the top notice has shown more. (Batch 30 §12 and the Oct 29 addition) A redraw of the page (a
 * refresh after a press, its poll, "You now meet this test's needs", new terms, a refused press) gives the page a newer render time but shows no
 * change lines: on a page that notes its first load (PageLoaded), the marker starts from that load and moves on only with what the top box actually showed.
 */
export function seenNow(pageSeenAt: string) {
  return pressSeenAt(pageSeenAt, pageLoadedAt(), shownUpTo);
}
/** (Batch 30) The rule itself: the earlier of the press's render time and the page's first load, moved on to what the top box showed. */
export function pressSeenAt(rendered: string, loadedAt: string, shown: string) {
  const base = loadedAt && loadedAt < rendered ? loadedAt : rendered;
  return shown && shown > base ? shown : base;
}

/** New changes the top notice just picked up: an open stop box under a button adds them (it stays live). */
export const LIVE_EVENT = "live-changes";
export function announce(added: Change[]) {
  if (added.length) window.dispatchEvent(new CustomEvent(LIVE_EVENT, { detail: added }));
}

const ck = (c: Change) => `${new Date(c.at).getTime()}|${c.text}`;

/**
 * Lines a stop box under a pressed button has shown: seen. The top box still lists them, quietly: they never cause
 * its once-per-page scroll (a press never moves the page).
 */
const shownInBox = new Set<string>();
export function markShownInBox(lines: Change[]) {
  for (const c of lines) {
    shownInBox.add(ck(c));
    if (c.at > boxSeenUpTo) boxSeenUpTo = c.at;
  }
  noteListed(lines);
}

/**
 * (Owner, Nov 5, §250) An update listed in ANY stop box on this page counts as seen for EVERY button on it: each line the server sends carries its identity (`sid`,
 * lib/server/shownLines.ts), a box rendering it records it page-wide, and every press sends the list (`shownIds`, client.ts). Per update, not by time: only what a
 * box ACTUALLY LISTED counts. Per page load: a reload starts fresh (module state), and moving to another page in the tab (another path) does too.
 */
export const SHOWN_IDS_SENT = 200;
let listed = new Set<string>();
let listedPath = "";
const herePath = () => (typeof window === "undefined" ? "" : window.location.pathname);
function listedHere() {
  if (listedPath !== herePath()) {
    listed = new Set();
    listedPath = herePath();
  }
  return listed;
}
export function noteListed(lines: Change[]) {
  const set = listedHere();
  for (const c of lines) {
    if (!c.sid) continue;
    set.delete(c.sid); // newest last: the cap keeps the most recent
    set.add(c.sid);
  }
}
/** The identities this page's stop boxes listed (the newest SHOWN_IDS_SENT). */
export const shownIdsNow = () => [...listedHere()].slice(-SHOWN_IDS_SENT);
/** Tests: a fresh page. */
export const clearListed = () => {
  listed = new Set();
  listedPath = herePath();
};
export const wasShownInBox = (c: Change) => shownInBox.has(ck(c));
/** Adds newly picked-up changes to an open box, skipping any it already lists. */
export function mergeChanges(old: Change[], added: Change[]) {
  // (Batch 20 section 4) A keyed line (one per ticked tester's needs) replaces the box's earlier line with that key: one line per tester, its latest time.
  const keys = new Set(added.map((c) => c.key).filter(Boolean));
  const kept = old.filter((c) => !c.key || !keys.has(c.key));
  // (Batch 35 §34) The one listing line replacing an earlier one covers what that one covered too (See it marks the union).
  added = added.map((c) => {
    const was = c.key ? old.filter((o) => o.key === c.key && o.keys?.length) : [];
    return was.length ? { ...c, keys: [...new Set([...was.flatMap((o) => o.keys!), ...(c.keys ?? [])])] } : c;
  });
  const have = new Set(kept.map(ck));
  // (Owner's finding, Oct 29, batch 32 §8) The same moment from two places reads as one line: the server's "This test was stopped at 3:22 PM." and the live
  // update's "This test was stopped" (shown "· 3:22 PM") within the same minute. The box keeps its own wording.
  const same = new Set(kept.map(sameMoment));
  return [...kept, ...added.filter((c) => !have.has(ck(c)) && !same.has(sameMoment(c)))];
}
/** A line's text without a closing " at 3:22 PM." (and its full stop), with its minute: two lines that say the same moment match. */
export function sameMoment(c: Change) {
  const base = c.text.replace(/ at \d{1,2}:\d{2}\s?[AP]M\.?$/, "").replace(/\.$/, "");
  return `${Math.floor(new Date(c.at).getTime() / 60_000)}|${base}`;
}

/**
 * (Owner, Nov 10, §373) The rule a stop box was built under, as the server sent it with the box (`liveRule`): a tester's press with Alerts Off (`off`, and the
 * part the press is about), or a developer's press with Alerts types ticked off (`ignored`, and what the press is about). No rule: every line stopped it.
 */
export type LiveRule = { off: true; part?: string } | { ignored: string[]; press: Press };
export function liveRuleOf(data: Record<string, unknown> | null | undefined): LiveRule | null {
  const r = data?.liveRule as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object") return null;
  if (r.off === true) return { off: true, ...(typeof r.part === "string" && r.part ? { part: r.part } : {}) };
  const press = r.press as Press | undefined;
  if (Array.isArray(r.ignored) && press && Array.isArray(press.acts) && Array.isArray(press.keys)) return { ignored: r.ignored.map(String), press };
  return null;
}
/**
 * (Owner, Nov 10, §373; recording race-371 2) Whether a line the page picked up joins an open stop box: only if the server would have put it in that box, by
 * the rule the box was built under. Tester, Alerts Off: a line that stops whatever the press (`forced`) or a payment on the press's own part (§362); a
 * developer payment on another part never joins ("Nora Lane paid $10.00 for your recording" was added under Send Answers 1.2 s after the box). Developer:
 * the same devKeeps the server ran. A line that doesn't join is not in the box and never moves its time (`boxAt`).
 */
export function boxKeeps(c: Change, rule?: LiveRule | null): boolean {
  if (!rule) return true;
  if ("off" in rule) return !!c.forced || (!!rule.part && c.part === rule.part);
  if (!c.alert || !rule.ignored.includes(c.alert)) return true;
  return !!c.facts && devKeeps({ ...c.facts, text: c.text, createdAt: new Date(c.at) }, new Set(rule.ignored), rule.press);
}

/** While a stop box is open, new changes the page picks up are added to it. (§373) `rule`: the rule that box was built under (boxKeeps). */
export function useLiveAppend(open: boolean, add: (added: Change[]) => void, rule?: LiveRule | null) {
  const cb = useRef(add);
  cb.current = add;
  const ruleNow = useRef(rule);
  ruleNow.current = rule;
  useEffect(() => {
    if (!open) return;
    // (Batch 20 section 25) Quiet live-box lines (a tester's Switch, …) never join a stop box.
    const on = (e: Event) => {
      const added = ((e as CustomEvent<Change[]>).detail ?? []).filter((c) => !c.quiet);
      // (§373) Only the lines the box's own rule keeps.
      const kept = added.filter((c) => boxKeeps(c, ruleNow.current));
      if (kept.length) cb.current(kept);
    };
    window.addEventListener(LIVE_EVENT, on);
    return () => window.removeEventListener(LIVE_EVENT, on);
  }, [open]);
}
