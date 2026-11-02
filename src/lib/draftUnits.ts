import { qText } from "./questions";
import { SIGNED_IN_MARK } from "./keptText";

/**
 * (Owner, Nov 2, batch 35 §120) Per-field drafts. A form kept by field ("units") saves only the units THIS tab changed, and the server keeps the latest value of
 * each unit on its own (one tab's description and another tab's price both survive; the same unit typed in two tabs: the later one). A reload, a new tab or a
 * sign-in brings every unit's latest draft back. Related fields are ONE unit, saved and restored together:
 * - Post / Edit (`test:`): "parts" (all three parts: written / recording / live, their prices, Required ticks and the call length), "mature" (the tick and Why it's
 *   mature), "questions" (the questions and which are required), "keys" (the access keys' text); every other field is its own unit (named after the field).
 * - Written answers (`written:`): one unit per question (`a:<question>`) and "notes" (Anything else).
 * Shared by the form hook (useKeptUnits, lib/useKept.tsx) and the server's merge (lib/server/kept.ts patchKept), so the two never drift.
 *
 * The stored shapes stay the ones every other reader knows: Post / Edit `{ f: { …fields of the drafted units }, touched: [those fields], keysText? }` (a unit is
 * drafted when its fields are in `touched`; the keys when `touched` has "keysText" or the text isn't empty), written answers `{ answers, notes?, questions }`
 * (`questions[j]` is the question `answers[j]` was typed for; a question not listed has no draft; `notes` absent: no draft).
 */
export type Units = Record<string, unknown>;

/** Post / Edit's units that hold more than one field. */
export const TEST_GROUPS: Record<string, readonly string[]> = {
  parts: ["written", "writtenPrice", "recording", "recordingPrice", "live", "liveRate", "liveMinutes", "writtenRequired", "recordingRequired", "liveRequired"],
  mature: ["mature", "matureWhy"],
  questions: ["questions", "requiredQs"],
};
/** The access keys' unit (Post / Edit). */
export const KEYS_UNIT = "keys";
const KEYS_FIELD = "keysText";
/** The unit a Post / Edit field belongs to. */
export function testUnitOf(field: string): string {
  for (const [u, fs] of Object.entries(TEST_GROUPS)) if (fs.includes(field)) return u;
  return field === KEYS_FIELD ? KEYS_UNIT : field;
}
/** A Post / Edit unit's fields. */
export const testFieldsOf = (unit: string): readonly string[] => TEST_GROUPS[unit] ?? [unit];

/** Written answers: the unit of a question's box, and of Anything else. */
export const answerUnit = (question: string) => `a:${qText(question)}`;
export const NOTES_UNIT = "notes";

/** Which forms keep their draft by field. */
export const keptByUnit = (key: string) => key.startsWith("test:") || key.startsWith("written:");

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : "")) : []);

/**
 * The units a kept draft holds (each with its value). Post / Edit: a unit's value is `{ field: value }` for its fields (the keys: the text). Written answers:
 * a question's text, or the notes. `questions`: the questions the form's boxes are for (an older draft with no `questions` list pairs its answers by place).
 */
export function unitsOf(key: string, data: unknown, questions: string[] = []): Units {
  if (!isObj(data)) return {};
  const out: Units = {};
  if (key.startsWith("test:")) {
    const f = isObj(data.f) ? data.f : {};
    const touched = Array.isArray(data.touched) ? data.touched.filter((k): k is string => typeof k === "string") : [];
    for (const field of touched) {
      if (field === KEYS_FIELD) continue;
      const u = testUnitOf(field);
      if (u in out) continue;
      const v = Object.fromEntries(testFieldsOf(u).filter((k) => k in f).map((k) => [k, f[k]]));
      if (Object.keys(v).length) out[u] = v;
    }
    if (typeof data.keysText === "string" && (touched.includes(KEYS_FIELD) || data.keysText !== "")) out[KEYS_UNIT] = data.keysText;
    return out;
  }
  if (key.startsWith("written:")) {
    const answers = strs(data.answers);
    const typedFor = Array.isArray(data.questions) ? strs(data.questions) : questions;
    answers.forEach((a, j) => {
      if (j < typedFor.length) out[answerUnit(typedFor[j])] = a;
    });
    if (typeof data.notes === "string") out[NOTES_UNIT] = data.notes;
    return out;
  }
  return {};
}

/**
 * The server's merge: `patch` sets each named unit to its value (null: that unit's draft goes); every other unit stays as it is. Returns the draft to keep, or
 * null when no unit is left (the draft goes). The sign-in mark stays (it goes with the draft).
 */
export function mergeUnits(key: string, data: unknown, patch: Record<string, unknown>, questions: string[] = []): Record<string, unknown> | null {
  const units = { ...unitsOf(key, data, questions) };
  for (const [u, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete units[u];
    else units[u] = v;
  }
  if (!Object.keys(units).length) return null;
  const mark = isObj(data) && data[SIGNED_IN_MARK] ? { [SIGNED_IN_MARK]: true } : {};
  if (key.startsWith("test:")) {
    const f: Record<string, unknown> = {};
    const touched: string[] = [];
    let keysText: string | undefined;
    for (const [u, v] of Object.entries(units)) {
      if (u === KEYS_UNIT) {
        keysText = typeof v === "string" ? v : "";
        touched.push(KEYS_FIELD);
        continue;
      }
      if (!isObj(v)) continue;
      for (const k of testFieldsOf(u)) {
        if (!(k in v)) continue;
        f[k] = v[k];
        touched.push(k);
      }
    }
    return { f, touched, ...(keysText !== undefined ? { keysText } : {}), ...mark };
  }
  // Written answers.
  const answers: string[] = [], qs: string[] = [];
  let notes: string | undefined;
  for (const [u, v] of Object.entries(units)) {
    if (u === NOTES_UNIT) notes = typeof v === "string" ? v : "";
    else if (u.startsWith("a:")) {
      qs.push(u.slice(2));
      answers.push(typeof v === "string" ? v : "");
    }
  }
  return { answers, questions: qs, ...(notes !== undefined ? { notes } : {}), ...mark };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * (Batch 35 §120) Which units a value change writes to the shared draft: only those THIS tab changed by its own edit (§65: a real gesture a moment before). A
 * unit whose saved value moved in the same change and that now simply shows it (an untouched field taking another tab's Save) is a redraw, never written.
 */
export function unitWrites(s: { prev: Units; next: Units; prevSaved: Units; nextSaved: Units; own: boolean }): string[] {
  if (!s.own) return [];
  return Object.keys(s.next).filter((u) => !same(s.prev[u], s.next[u]) && !(!same(s.prevSaved[u], s.nextSaved[u]) && same(s.next[u], s.nextSaved[u])));
}

/** (Batch 35 §120) What a write sends for those units: the value, or null where it's back to the saved value (that unit's draft goes). */
export const unitPatch = (units: Iterable<string>, now: Units, saved: Units): Record<string, unknown> =>
  Object.fromEntries([...units].map((u) => [u, same(now[u], saved[u]) ? null : now[u]]));

/** (Batch 35 §120) A unit shows "Draft" only while it holds a draft that differs from the saved value: never a unit with no draft. */
export const unitIsDraft = (drafted: ReadonlySet<string>, u: string, now: Units, saved: Units) => drafted.has(u) && !same(now[u], saved[u]);
