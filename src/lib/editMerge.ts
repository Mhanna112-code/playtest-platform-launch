// (Owner, Oct 29, batch 23 section 5; final, replaces batch 16 section 19's "the box takes the other tab's value") Edit keeps what you typed; it shows what the other tab
// saved. Shared by Edit's form (TestForm.tsx) and the Save route (server/tests.ts editTest), so the two can't drift.
//
// - A field you haven't touched takes the other tab's saved value, so your Save never undoes it; (owner, Oct 31, batch 35 §26) a small blue note under it says so
//   ("Changed in another tab at 11:43 PM: was “Harbor Run”", wasLine below), until that field is edited or Save is pressed. No "Use theirs": it shows their value.
// - A field you typed in keeps your text; under it a blue note shows what the other tab saved ("Saved in another tab or device at 3:54 PM:" and their value) with
//   "Use theirs". Further saves elsewhere update the note's value; making your text match theirs removes the note.
// - On Save, each field where your text differs from what's saved now stops once: "Instructions: your version will replace the one saved in another tab at 3:54 PM."
//   The second press saves yours on top.
// - Tester spots and Open until keep the older rule (owner): they take the other tab's value even if you typed in them, with the older note ("Spots: 4 → 5",
//   "What you typed (not saved)"). Access keys are unchanged (their own merge, and their "Added / Removed" note always shows).

/** (Batch 23 section 5) The fields that take the other tab's value even when typed in (today's behaviour), as form keys and as the API's names. */
export const TAKE_THEIRS_FIELDS = ["spots", "openUntil"] as const;
export const takesTheirs = (k: string) => (TAKE_THEIRS_FIELDS as readonly string[]).includes(k);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What another tab's save does to this form: for each field the save changed (`now` differs from `base`, what this tab last knew), the base moves to it, and:
 * - `take`: the field takes the saved value (untouched here, or spots / Open until); `oldNote`: those of them (spots / Open until) that need the older note;
 * - `keep`: typed here and different: the text stays, with the "Saved in another tab" note;
 * - nothing for a field that already holds the saved value.
 */
export function mergeElsewhere<F extends Record<string, unknown>>(f: F, base: F, now: F) {
  const take: (keyof F)[] = [], keep: (keyof F)[] = [], oldNote: (keyof F)[] = [], settled: (keyof F)[] = [];
  for (const k of Object.keys(now) as (keyof F)[]) {
    if (same(now[k], base[k])) continue;
    if (same(f[k], now[k])) {
      settled.push(k); // this tab already has it: not news
      continue;
    }
    const typed = !same(f[k], base[k]);
    if (takesTheirs(String(k))) {
      take.push(k);
      oldNote.push(k);
    } else if (!typed) take.push(k);
    else keep.push(k);
  }
  return { take, keep, oldNote, settled };
}

/** What a field is called in Save's stop line (the API's field names), as on the form. */
export const EDIT_LABELS: Record<string, string> = {
  productName: "Product", title: "Name of this test", description: "Instructions", buildUrl: "Link", categories: "Categories", devices: "Devices", languages: "Languages",
  mature: "Mature (18+)", matureWhy: "Why it's mature", ndaText: "NDA", spots: "Spots", deadlineDays: "Tester deadline", openUntil: "Open until", joinMode: "How testers join",
  writtenCents: "Price for written answers", recordingCents: "Price for a recording", liveRateCents: "Live call rate", liveMinutes: "Call length",
  writtenRequired: "Written report required", recordingRequired: "Recorded session required", liveRequired: "Live session required", questions: "Questions",
};

/** Save's stop line for a typed field another tab saved (the page adds " at 3:54 PM."): "Instructions: your version will replace the one saved in another tab". */
export const replaceLine = (field: string) => `${EDIT_LABELS[field] ?? field}: your version will replace the one saved in another tab`;
/** The note's heading under such a field (the page adds the time). */
export const SAVED_ELSEWHERE = "Saved in another tab or device at";
/** (Batch 23 section 5) Note headings: your own saves elsewhere, and changes other people caused (a tester joining and given a key). */
export const CHANGED_ELSEWHERE = "Changed in another tab or device at";
export const UPDATED_AT = "Updated at";

/** (Owner, Oct 31, batch 35 §26) The note under an untouched field that took another tab's saved value (the page passes the time, "11:43 PM"). */
export const CHANGED_IN_TAB = "Changed in another tab at";
/** "Changed in another tab at 11:43 PM: was “Harbor Run”" (`was` null: "was empty"); where one note holds several fields: "…: Price for a recording was “$15.00”". */
export const wasLine = (time: string, was: string | null, name?: string) => `${CHANGED_IN_TAB} ${time}: ${name ? `${name} was` : "was"} ${was == null ? "empty" : `“${was}”`}`;
