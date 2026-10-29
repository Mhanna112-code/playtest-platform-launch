// (Owner, Oct 29, batch 29 §36) A refused press redraws the page at once (batch 28 §9), and the redraw can take the pressed button away (Join call after a
// block, Pay after another tab paid, Charge after the developer paid, Withdraw on a closed request…). The refusal line then went with it, so the person
// never saw why. This keeps it: a small blue line in the spot where the button was ("Your Join call didn't go through: this call isn't available."),
// until the next press anywhere on the page or KEEP_MS, whichever comes first. It lives outside the page (the root layout's KeptRefusal), so it survives
// the redraw. When the button is still there after the redraw, its own line under it says it and this one stays hidden.
import { refusalLine } from "./pressLabels";

/** How long the kept line stays at most. */
export const KEEP_MS = 10_000;

/** Where the pressed button was, in page coordinates (scroll included). */
export type Spot = { top: number; left: number; width: number };
export type Kept = { id: number; text: string; /** the server's own words (a line under the button may show just these) */ message: string; spot: Spot | null; at: number; el: Element | null };

let lastPress: { el: Element | null; spot: Spot | null; at: number } | null = null;
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
export function notePress(el: Element | null, spot: Spot | null, now = Date.now()) {
  lastPress = { el, spot, at: now };
  if (kept) {
    kept = null;
    publish();
  }
}

/** A press refused because the state changed (the page redraws now): keep its line where the button was. Returns the kept line (for tests). */
export function keepRefusal(label: string, message: string, now = Date.now()): Kept | null {
  if (!message.trim()) return null;
  kept = { id: ++seq, text: keptRefusalLine(label, message), message: message.trim(), spot: lastPress?.spot ?? null, at: now, el: lastPress?.el ?? null };
  publish();
  return kept;
}

/** Shown while it's younger than KEEP_MS and its button is gone from the page (a button still there shows the refusal itself). */
export function keptShows(k: Kept | null, now: number, buttonStillThere: boolean) {
  return !!k && now - k.at < KEEP_MS && !buttonStillThere;
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
