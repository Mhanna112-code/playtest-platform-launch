// (Owner, Oct 28, batch 16 section 10) Which Post / Edit field each server mistake belongs to, so the mistake shows red AT that field with the same
// text (and in the list under the button, linked to it). Checked in order: the first pattern that fits wins. Every message checkListing and the
// Post / Edit routes produce must land on a field (tests/batch16-form-fields.test.ts); a changed-field-limit line (criticalLine) belongs to no
// field and stays under the button.
import { CRITICAL_KEYS, criticalLine } from "@/lib/limits";

/** The field keys; each is the id of its box (or group) in TestForm ("keys": accessKeys on Post, keysFree on Edit). */
export type ListingField =
  | "joinMode" | "openUntil" | "productName" | "title" | "description" | "matureWhy" | "ndaText" | "categories" | "parts" | "spots"
  | "highWritten" | "highRecording" | "writtenPrice" | "recordingPrice" | "liveRate" | "questions" | "keys";

export const LISTING_MISTAKES: [ListingField, RegExp][] = [
  ["joinMode", /who can join/i],
  ["openUntil", /open until/i],
  ["productName", /product name/i],
  ["title", /\btitle\b/i],
  ["description", /what to do|what testers should do/i],
  ["matureWhy", /\bmature\b|^Say a little more: at least \d+ characters\.$/i],
  ["ndaText", /\bNDA\b/],
  ["categories", /\bcategory\b/i],
  ["parts", /kind of feedback/i],
  // Before spots: "Add 2 more keys: 3 open spots, 1 free key." is about the keys.
  ["keys", /\bkeys?\b|in use by|given to a tester/i],
  ["spots", /\bspots?\b|testers per test/i],
  ["highWritten", /^Tick “.*” for the written answers price\.$/],
  ["highRecording", /^Tick “.*” for the recording price\.$/],
  ["writtenPrice", /written answers price/i],
  ["recordingPrice", /recording price/i],
  ["liveRate", /live call rate/i],
  ["questions", /\bquestions?\b/i],
];

/** A changed-field-limit line ("You've changed the steps 3 times since testers joined…"): it belongs to no field. */
export const isCriticalLine = (msg: string) => CRITICAL_KEYS.some((k) => criticalLine(k) === msg);

/** The field a server mistake belongs to, or null (a changed-field-limit line, or something no field can fix). */
export function fieldOfMistake(msg: string): ListingField | null {
  if (isCriticalLine(msg)) return null;
  return LISTING_MISTAKES.find(([, re]) => re.test(msg))?.[0] ?? null;
}
