/**
 * (Owner, Oct 30, batch 35 §8) Drafts after signing back in (after signing out, or after another account signed in on this browser). Every kept form comes back
 * with its latest draft (last typed, any tab or device), marked (`SIGNED_IN_MARK`): the form shows each box or field still different from the saved value as
 * "Draft" with "Use saved" (Edit / Post also "Use saved for all"). Whether a draft's selections and numbers come back too is ONE switch, `SIGN_IN_DRAFTS`:
 * - "whole" (the coordinator's lean, Oct 30, while the owner reconsiders step 3): the draft comes back whole, text and selections, since some selections belong
 *   with their text (the Mature tick with Why it's mature, the written part and its Required questions with Questions).
 * - "written": only the written parts come back; every selection or number (dates, part ticks and prices, spots, devices, languages, join mode, categories, call
 *   times / length / ticks) is dropped at the sign-in, so the form shows the saved value there, and a draft with nothing written goes.
 * Things outside a kept form (invite ticks, search boxes) always start over. Shared by the server (it marks / trims at sign-in), the forms and the tests.
 */
export const SIGN_IN_DRAFTS = "whole" as "whole" | "written";

/** Set on a draft trimmed at a sign-in; the form keeps it on its saves until the draft is sent or emptied. */
export const SIGNED_IN_MARK = "_signin";

/** (Batch 35 §10) The profile fields a profile draft keeps (`{ f: { …the fields that differ from the saved profile } }`, key "profile:<side>"). */
export const PROFILE_DRAFT_FIELDS = ["name", "pronoun", "devices", "languages", "categories", "bio"] as const;
export type ProfileDraftField = (typeof PROFILE_DRAFT_FIELDS)[number];
/** Its written ones (kept by SIGN_IN_DRAFTS "written"); the others are selections. */
export const PROFILE_TEXT_FIELDS = ["name", "bio"] as const;

/** (Batch 35 §11) The admin console's drafts: "admin:<action>:<id>" (only admins keep or read them). */
export const ADMIN_DRAFT_PREFIX = "admin:";
export const adminDraftKey = (action: string, id: string) => `${ADMIN_DRAFT_PREFIX}${action}:${id}`;

/** Edit / Post's written fields (the coordinator's split, Oct 30): the access keys' text (`keysText`) is written too. */
export const TEST_TEXT_FIELDS = ["productName", "title", "description", "buildUrl", "ndaText", "matureWhy", "questions"] as const;
export type TestTextField = (typeof TEST_TEXT_FIELDS)[number];
export const isTestTextField = (k: string): k is TestTextField => (TEST_TEXT_FIELDS as readonly string[]).includes(k);

/**
 * The written parts of every other kept form, by name: written answers (`answers`, `notes`; `questions` says which questions they were typed for), chat and
 * Contact us (`text`, `message`), dispute reasons and sides (`reason`, `text`), pay / pay-more / End early / Stop reasons (`reason`), rating comments (`comment`),
 * (batch 35 §10) the Apply / Ask to rejoin note (`note`), (batch 35 §11) the admin boxes' reasons and notes (`note`, `reason`; Decide's total and Extend's days are numbers).
 * Anything else (Contact us' topic, a call request's rows, length and ticks) is a selection.
 */
const TEXT_PARTS = ["answers", "notes", "questions", "text", "message", "reason", "comment", "note"] as const;
/** Parts that only describe the draft (never "typed" on their own). */
const META_PARTS = new Set(["questions"]);

const typed = (v: unknown): boolean => (typeof v === "string" ? v.trim() !== "" : Array.isArray(v) ? v.some(typed) : false);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A draft's written parts only (null: nothing written is left, the draft goes). */
export function textOnly(key: string, data: unknown): Record<string, unknown> | null {
  if (!isObj(data)) return null;
  // Call requests (both sides): times, length and ticks only.
  if (key.startsWith("request:")) return null;
  // (Batch 35 §10) The profile: its name and bio only.
  if (key.startsWith("profile:")) {
    const f = isObj(data.f) ? data.f : {};
    const kept = Object.fromEntries(PROFILE_TEXT_FIELDS.filter((k) => typeof f[k] === "string").map((k) => [k, f[k]]));
    return Object.keys(kept).length ? { f: kept } : null;
  }
  if (key.startsWith("test:")) {
    const f = isObj(data.f) ? data.f : {};
    const touched = Array.isArray(data.touched) ? data.touched.filter((k): k is string => typeof k === "string") : [];
    // Only the written fields typed in: a field never touched keeps the saved value (never an old copy of it).
    const textTouched = touched.filter(isTestTextField).filter((k) => typeof f[k] === "string");
    const out: Record<string, unknown> = { f: Object.fromEntries(textTouched.map((k) => [k, f[k]])), touched: textTouched };
    const keysText = typeof data.keysText === "string" && data.keysText !== "" ? data.keysText : null;
    if (keysText != null) out.keysText = keysText;
    return textTouched.length || keysText != null ? out : null;
  }
  const out: Record<string, unknown> = {};
  for (const k of TEXT_PARTS) {
    const v = data[k];
    if (typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string"))) out[k] = v;
  }
  return Object.entries(out).some(([k, v]) => !META_PARTS.has(k) && typed(v)) ? out : null;
}

/** Does this Edit / Post field come back after a sign-in (SIGN_IN_DRAFTS)? */
export const signInKeeps = (k: string) => SIGN_IN_DRAFTS === "whole" || isTestTextField(k);

/** The draft as kept after a sign-in (SIGN_IN_DRAFTS: whole, or its written parts only), marked; null when nothing is left. */
export function trimAtSignIn(key: string, data: unknown, mode: "whole" | "written" = SIGN_IN_DRAFTS): Record<string, unknown> | null {
  const t = mode === "whole" ? (isObj(data) ? data : null) : textOnly(key, data);
  return t ? { ...t, [SIGNED_IN_MARK]: true } : null;
}
