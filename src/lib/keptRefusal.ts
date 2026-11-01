// (Owner, Oct 29, batch 29 §36) A refused press redraws the page at once (batch 28 §9), and the redraw can take the pressed button away (Join call after a
// block, Pay after another tab paid, Charge after the developer paid, Withdraw on a closed request…). The refusal line then went with it, so the person
// never saw why. This keeps it: a blue notice ("Your Join call didn't go through: this call isn't available.") until the next press anywhere on the page.
// (Owner, Oct 29, batch 32 §10) It sits IN the page, inside the part or row the pressed button was in (the nearest one with an id that survived the
// redraw), not floating over the text; with none left, at the top of the page. It lives outside the page (the root layout's KeptRefusal), so it survives
// the redraw. When the button is still there, or the page already says the same thing anywhere, it stays hidden (never twice).
import { refusalLine } from "./pressLabels";

/** How long the kept line stays at most: (batch 32 §10) until the next press. */
export const KEEP_MS = Number.POSITIVE_INFINITY;

/** Where the pressed button was, in page coordinates (scroll included). */
export type Spot = { top: number; left: number; width: number };
export type Kept = { id: number; text: string; /** the server's own words (a line under the button may show just these) */ message: string; spot: Spot | null; at: number; el: Element | null; /** (batch 32 §10) ids of the button's sections, nearest first */ anchors: string[]; /** (batch 35 §85) the page it was pressed on */ path?: string };

let lastPress: { el: Element | null; spot: Spot | null; at: number; anchors: string[] } | null = null;
let kept: Kept | null = null;
let seq = 0;
const subs = new Set<(k: Kept | null) => void>();
const publish = () => subs.forEach((f) => f(kept));

/** Words a refusal sentence often starts with: lowercased after "didn't go through:" ("This call isn't available." → "this call isn't available."). Names stay. */
const LOWER_FIRST = new Set(["This", "That", "These", "Those", "The", "Your", "You", "It", "Its", "There", "Only", "A", "An", "Already", "Nothing", "No", "Someone", "Another", "Their", "They", "We", "Pay", "Charge", "Calls", "Call"]);

/**
 * The kept line: "Your Join call didn't go through: this call isn't available." A message that already names the press (or a press with no label) is
 * kept as the server wrote it.
 */
export function keptRefusalLine(label: string, message: string) {
  const m = message.trim();
  if (/^Your .*didn't go through/.test(m)) return m;
  const first = m.split(/\s+/)[0] ?? "";
  const lowered = LOWER_FIRST.has(first) ? m.charAt(0).toLowerCase() + m.slice(1) : m;
  const line = refusalLine(label, lowered);
  // refusalLine returns the message itself when it doesn't add the press: then the server's own capital stays.
  return line === lowered ? m : line;
}

/** A press anywhere on the page: remembered (where its button is), and any kept line goes. */
export function notePress(el: Element | null, spot: Spot | null, now = Date.now(), anchors: string[] = []) {
  lastPress = { el, spot, at: now, anchors };
  if (kept) {
    kept = null;
    publish();
  }
}

/** A press refused because the state changed (the page redraws now): keep its line where the button was. Returns the kept line (for tests). */
export function keepRefusal(label: string, message: string, now = Date.now()): Kept | null {
  if (!message.trim()) return null;
  kept = { id: ++seq, text: keptRefusalLine(label, message), message: message.trim(), spot: lastPress?.spot ?? null, at: now, el: lastPress?.el ?? null, anchors: lastPress?.anchors ?? [], path: typeof location === "undefined" ? undefined : location.pathname };
  publish();
  return kept;
}

/** (Batch 35 §95) Only other content counts as "shown elsewhere". A kept notice may be nested
 * in a <li>; that ancestor's textContent includes the portal too. Ignore the whole kept subtree
 * at every depth, otherwise each 200 ms check hides its own line, then shows it again.
 * The small DOM-node shape also lets the decision be tested without a browser dependency.
 */
export type RefusalTextNode = { nodeType: number; nodeValue: string | null; childNodes: ArrayLike<RefusalTextNode>; matches?: (selector: string) => boolean };
export function refusalTextOutsideKept(node: RefusalTextNode): string {
  if (node.nodeType === 1 && node.matches?.("[data-kept-refusal], [data-kept-host]")) return "";
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue ?? "";
  return Array.from(node.childNodes, refusalTextOutsideKept).join("");
}

/** The nearest surviving visible section; null means the notice belongs at the top. */
export function keptAnchor<T extends object>(anchors: readonly string[], visible: (id: string) => T | null): T | null {
  for (const id of anchors) {
    const anchor = visible(id);
    if (anchor) return anchor;
  }
  return null;
}

/** A kept refusal belongs only to the page where it was pressed (§85). */
export const keptOnPage = (k: Pick<Kept, "path">, pathname: string) => !k.path || k.path === pathname;

/** Shown while it's younger than KEEP_MS and its button is gone from the page (a button still there shows the refusal itself). */
export function keptShows(k: Kept | null, now: number, buttonStillThere: boolean) {
  return !!k && !!k.text.trim() && now - k.at < KEEP_MS && !buttonStillThere;
}

/** The kept line now (or null), and a way to follow it. */
export const currentKept = () => kept;
export function onKept(f: (k: Kept | null) => void) {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

/** Clear it (its time ran out). Only the one asked about: a newer kept line stays. */
export function dropKept(id: number) {
  if (kept?.id === id) {
    kept = null;
    publish();
  }
}

/** (For tests) start over. */
export function resetKept() {
  lastPress = null;
  kept = null;
  seq = 0;
  publish();
}
