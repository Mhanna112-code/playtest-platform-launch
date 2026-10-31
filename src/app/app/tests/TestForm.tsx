"use client";
import { SubscribersTag } from "@/components/SubscribeLink";
import { TermsAgainBox } from "@/components/TermsAgainBox";
import { TERMS_UPDATED_CODE } from "@/lib/termsOfUse";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { Err } from "@/components/Err";
import { mergeChanges, useLiveAppend } from "@/lib/live";
import { QUESTIONS_RULE_LINE, qRequired, qStored, qText, questionLimitLine, capQuestions } from "@/lib/questions";
import { MistakeList, focusFirstMistake, markServerMistakes, useLocalMin } from "@/components/FieldChecks";
import { BUILD_URL_LINE, BUILD_URL_PATTERN, fieldOfMistake, isCriticalLine, type ListingField } from "@/lib/listingFields";
import { Choices, PICK_CHIP } from "@/components/Choices";
import { api, ApiError, isFieldError } from "@/lib/client";
import { DRAFT_START_LINE, DraftTag, NotSentTag, START_EMPTY_LABEL, USE_SAVED_ALL_LABEL, useKept } from "@/lib/useKept";
import { signInKeeps } from "@/lib/keptText";
import { CATEGORIES, DEVICES, LANGUAGES } from "@/lib/options";
import { LIMITS, changesLeftLine, counterOf, countersOf, countsOf, criticalLine, type CriticalCounts, type CriticalField } from "@/lib/limits";
import { givenDeletedLine, keyGivenLine, keyNeedLine, keysAddedLine, keysRemovedLine, parseKeys } from "@/lib/keys";
import { LISTING_MIN_CHARS, openUntilExtendLine, duplicateQuestion, duplicateQuestionLine, STEPS_FIELD, TITLE_FIELD, minCounter, PART_PRICE_MISSING, PAY_RULES_LINK, PAY_RULES_TICK, PAYMENTS_TERMS_HREF, OPEN_UNTIL_MAX_LINE, openUntilCapHint, openUntilCapLine, DESCRIPTION_REQUIRED, HIGH_PART_CENTS, HIGH_PART_TICK, MATURE_WHY_MIN, MATURE_WHY_REQUIRED, MATURE_WHY_SHORT, NDA_TOO_LONG, OPEN_UNTIL_RANGE, QUESTION_TOO_LONG, counterText, daysBetween, partHighLine, partLowLine, rateHighLine, rateLowLine, openUntilLine, MAX_SPOTS, SPOTS_MAX_LINE, spotsCap, spotsKeptLine, type Listing } from "@/lib/rules";
/** The browser's own date (YYYY-MM-DD) and zone. */
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""; } catch { return ""; } };
import { ScrollText } from "@/components/ScrollText";
import { fmtDateTime, toCents } from "@/lib/format";
import { KeyBoxes, freeBoxCheck, type KeysData } from "./KeyBoxes";
import { FieldNote, GroupNote, NoteItems, TheirsNote, WasNote, type NoteItem } from "@/components/FieldNote";
import { CHANGED_ELSEWHERE, SAVED_ELSEWHERE, UPDATED_AT, mergeElsewhere, takesTheirs } from "@/lib/editMerge";
import { ShieldCheck } from "lucide-react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { jumpTo } from "@/lib/markJump";
import { lockedChangeLine, lockedChangeParts, shortValue, type LockedItem } from "@/lib/lockedChange";

// Post and Edit share this form. Prices are typed in dollars ("7.50"; "0" for free). Edit sends only the fields the
// user touched plus the version it loaded; if the test changed since, Save stops once and lists what changed.

type F = {
  productName: string; title: string; description: string; buildUrl: string; categories: string[]; devices: string[]; languages: string[];
  mature: boolean; matureWhy: string; ndaText: string;
  spots: string; deadlineDays: string; written: boolean; writtenPrice: string; recording: boolean; recordingPrice: string;
  live: boolean; liveRate: string; liveMinutes: string; writtenRequired: boolean; recordingRequired: boolean; liveRequired: boolean; questions: string; requiredQs: string[]; openUntil: string; joinMode: string;
};

const dollars = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));
export function toForm(l: Listing): F {
  return {
    productName: l.productName ?? "", title: l.title, description: l.description, buildUrl: l.buildUrl, categories: l.categories, devices: l.devices, languages: l.languages,
    mature: !!l.mature, matureWhy: l.matureWhy ?? "", ndaText: l.ndaText ?? "",
    spots: String(l.spots), deadlineDays: String(l.deadlineDays), written: l.writtenCents != null, writtenPrice: dollars(l.writtenCents),
    recording: l.recordingCents != null, recordingPrice: dollars(l.recordingCents), live: l.liveRateCents != null,
    liveRate: dollars(l.liveRateCents), liveMinutes: String(l.liveMinutes ?? 30),
    writtenRequired: !!l.writtenRequired, recordingRequired: !!l.recordingRequired, liveRequired: !!l.liveRequired, questions: l.questions.map(qText).join("\n"), requiredQs: l.questions.filter(qRequired).map(qText),
    openUntil: l.openUntil ? l.openUntil.slice(0, 10) : "",
    joinMode: l.joinMode ?? "anyone",
  };
}

/** Form values → API fields (prices in dollars; the server turns them into cents). */
function toApi(f: F): Record<string, unknown> {
  return {
    productName: f.productName, title: f.title, description: f.description, buildUrl: f.buildUrl, categories: f.categories, devices: f.devices, languages: f.languages,
    mature: f.mature, matureWhy: f.mature ? f.matureWhy : "", ndaText: f.ndaText,
    spots: f.spots, deadlineDays: f.deadlineDays, writtenCents: f.written ? f.writtenPrice || "" : null,
    recordingCents: f.recording ? f.recordingPrice || "" : null, liveRateCents: f.live ? f.liveRate || "" : null,
    liveMinutes: null, writtenRequired: f.written && f.writtenRequired, recordingRequired: f.recording && f.recordingRequired, liveRequired: f.live && f.liveRequired, questions: f.questions.split("\n").map((q) => q.trim()).filter(Boolean).map((q) => qStored(q, f.requiredQs.includes(q))), openUntil: f.openUntil, joinMode: f.joinMode,
  };
}
// Which API fields each form field feeds.
const API_FIELDS: Record<keyof F, string[]> = {
  productName: ["productName"], title: ["title"], description: ["description"], buildUrl: ["buildUrl"], categories: ["categories"], devices: ["devices"], languages: ["languages"],
  mature: ["mature", "matureWhy"], matureWhy: ["matureWhy"], ndaText: ["ndaText"],
  spots: ["spots"], deadlineDays: ["deadlineDays"], written: ["writtenCents"], writtenPrice: ["writtenCents"], recording: ["recordingCents"],
  recordingPrice: ["recordingCents"], live: ["liveRateCents", "liveMinutes"], liveRate: ["liveRateCents"], liveMinutes: ["liveMinutes"], writtenRequired: ["writtenRequired"], recordingRequired: ["recordingRequired"], liveRequired: ["liveRequired"], questions: ["questions"], requiredQs: ["questions"], openUntil: ["openUntil"], joinMode: ["joinMode"],
};

/** (Owner, Oct 28, batch 16 section 19) What a field is called in a note: the form label's short name, capitalised ("Spots: 4 → 5", "Instructions:"). */
const NAMES: Partial<Record<keyof F, string>> = {
  productName: "Product", title: "Name of this test", description: "Instructions", buildUrl: "Link", categories: "Categories", devices: "Devices", languages: "Languages",
  mature: "Mature (18+)", matureWhy: "Why it's mature", ndaText: "NDA", spots: "Spots", deadlineDays: "Tester deadline", openUntil: "Open until", joinMode: "How testers join",
  written: "Written report", writtenPrice: "Price for written answers", recording: "Recorded session", recordingPrice: "Price for a recording", live: "Live session", liveRate: "Live call rate",
  writtenRequired: "Written report required", recordingRequired: "Recorded session required", liveRequired: "Live session required", questions: "Questions", requiredQs: "Required questions",
};

/** (Batch 16 section 19) A field's value as a note shows it ("$8.00", "Windows PC, iPad"); the questions as a list. */
function valueText(k: keyof F, v: unknown): string | string[] {
  if (typeof v === "boolean") return v ? "on" : "off";
  if (k === "questions") return String(v ?? "").split("\n").map((q) => q.trim()).filter(Boolean);
  if (k === "requiredQs") return (v as string[]) ?? [];
  if (Array.isArray(v)) return v.length ? v.join(", ") : "none";
  const s = String(v ?? "");
  if (!s) return "empty";
  if (k === "writtenPrice" || k === "recordingPrice" || k === "liveRate") return `$${s}`;
  return s;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** (Batch 35 §26) A field's value that reads "empty" in the note under it. */
const emptyValue = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
/** (Batch 35 §26) The value in "was “…”": a list (the questions) one per line. */
const wasText = (v: string | string[] | null) => (v == null ? null : Array.isArray(v) ? v.join("\n") : v);
// Where each form field's note shows (parts and prices share one place).
const NOTE_AT: Partial<Record<keyof F, string>> = { written: "parts", writtenPrice: "parts", recording: "parts", recordingPrice: "parts", live: "parts", liveRate: "parts", writtenRequired: "parts", recordingRequired: "parts", liveRequired: "parts", questions: "questions", requiredQs: "questions" };

/**
 * (Owner, Oct 30, batch 35 §8) After signing in, where the form marks "Draft" (with "Use saved"): every field that came back (SIGN_IN_DRAFTS, lib/keptText.ts) and
 * still differs from the saved value, by the place its mark shows (the parts and prices share one; the questions and their Required ticks share one).
 */
export function draftMarks(f: F, base: F): Record<string, (keyof F)[]> {
  const out: Record<string, (keyof F)[]> = {};
  for (const k of Object.keys(f) as (keyof F)[]) {
    if (!signInKeeps(k) || same(f[k], base[k])) continue;
    const where = NOTE_AT[k] ?? k;
    (out[where] ??= []).push(k);
  }
  return out;
}

// The parts, as the full app's Parts and prices cards (prices-widget.tsx there), with lean's names and price limits.
const PARTS = [
  { on: "written", req: "writtenRequired", price: "writtenPrice", title: "Written report", help: "Answers to your questions", ph: "10.00", unit: "", min: "1", max: "1000", key: "written", lowMsg: partLowLine("written answers"), highMsg: partHighLine("written answers") },
  { on: "recording", req: "recordingRequired", price: "recordingPrice", title: "Recorded session", help: "Screen recording, thinking out loud", ph: "15.00", unit: "", min: "1", max: "1000", key: "recording", lowMsg: partLowLine("recording"), highMsg: partHighLine("recording") },
  { on: "live", req: "liveRequired", price: "liveRate", title: "Live session", help: "A call while you watch, billed by the minute", ph: "30.00", unit: "/h", min: "10", max: "200", key: "", lowMsg: rateLowLine(), highMsg: rateHighLine() },
] as const;

type EditProps = {
  id: string; version: number; testersIn: number; draft: boolean; seenAt?: string;
  /** The access keys now (Edit's In use / Free boxes). */
  keys: KeysData;
  /** (Owner, Oct 28 afternoon) Per limited field, the Saves that changed it since the first tester joined; and whether any tester has joined yet. */
  criticalCounts: CriticalCounts; everJoined: boolean;
  /** When the test opened (the deadline must leave 3 days inside Open until from here). */
  openedAt: string;
  /** (Batch 16 section 16) The last day Open until can reach (30 days after the test opened), and each tester's days now. */
  capDay?: string; testerDays?: number;
};

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** (Owner, Oct 28 evening) `draft`: a draft (a next round not opened yet) shown in Post a test: Post opens it for testers, and it can be deleted here. */
export function TestForm({ init, edit, draft, perks = true, termsAgain = false, hasCard = true }: { init: Listing; edit?: EditProps; draft?: { id: string }; /** (Batch 8) false on the free plan: "Subscribers" on Approved-only */ perks?: boolean; /** (Batch 20 section 21) the account hasn't agreed to the current Terms: the tick shows above Post */ termsAgain?: boolean; hasCard?: boolean }) {
  const [f, setF] = useState<F>(toForm(init));
  // What this tab last knew the test to be (Edit): fields that differ from it are "changed" (Save is faded when none are).
  const [base, setBase] = useState<F>(toForm(init));
  const [touched, setTouched] = useState<Set<keyof F>>(new Set());
  const [busy, setBusy] = useState(false);
  // (Batch 16 section 10) The server's mistakes go to their fields (FieldChecks); only those that belong to no field are kept here, for the list.
  const [orphans, setOrphans] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [listingEdited, setListingEdited] = useState(false);
  // (Owner) When the box last updated: the next Save goes ahead only if nothing new happened since.
  const [boxAt, setBoxAt] = useState("");
  const [version, setVersion] = useState(edit?.version ?? 0);
  // (Owner, Oct 28) Each field's "Changes left: N of 3" follows another tab's Save live.
  const [critCounts, setCritCounts] = useState<CriticalCounts>(edit?.criticalCounts ?? countsOf({}));
  const [everJoined, setEverJoined] = useState(edit?.everJoined ?? false);
  // (Owner, Oct 27) "I confirm this part pays more than $200." per part.
  const [high, setHigh] = useState<Record<string, boolean>>({});
  const confirmHigh = () => (["written", "recording"] as const).filter((k) => high[k]);
  useLiveAppend(changes != null, (added) => {
    setChanges((c) => (c ? mergeChanges(c, added) : c));
    const newest = added.map((a) => a.at).sort().pop();
    if (newest) setBoxAt((b) => (b && b > newest ? b : newest));
  });
  const [saved, setSaved] = useState("");
  const [refusal, setRefusal] = useState("");
  // (Batch 18 section 1) The account accepted an older Terms of Use: Post the test shows the box with its tick under the button; ticked, the next press posts.
  const [termsAsk, setTermsAsk] = useState(termsAgain);
  const [agreeTerms, setAgreeTerms] = useState(false);
  // (Batch 19 section 7) The required tick about Charge above Post the test / Save (Edit: only while Save is enabled; it unticks when the form is back to unchanged).
  const [payTick, setPayTick] = useState(false);
  // Keys: Post types them one per line. (Batch 15 section 19) Edit's Free box holds every free key, one per line: Save works out what was added and deleted against
  // the free keys this page LOADED (freeLoaded), so another tab's work is never undone.
  const [freeLoaded, setFreeLoaded] = useState<string[]>(edit?.keys.free.map((k) => k.value) ?? []);
  const [keysText, setKeysText] = useState(edit ? edit.keys.free.map((k) => k.value).join("\n") : "");
  const [keysData, setKeysData] = useState<KeysData | null>(edit?.keys ?? null);
  // Fields the user has left (cross-field mistakes show then) and whether Save was pressed.
  const [blurred, setBlurred] = useState<Set<string>>(new Set());
  const [pressed, setPressed] = useState(false);
  // (Design doc 5) Notes under each field changed in another tab or device: { field: { at, text } }.
  const [notes, setNotes] = useState<Record<string, { at: string; items: NoteItem[] }>>({});
  // (Owner, Oct 29, batch 23 section 5) Fields typed here that another tab or device saved meanwhile: the text stays, and the note under it shows their value (saved at `at`).
  const [theirs, setTheirs] = useState<Partial<Record<keyof F, string>>>({});
  // (Owner, Oct 31, batch 35 §26) Fields this tab hadn't touched that took another tab's saved value: what each showed before, and when (the note under it), until that
  // field is edited or Save is pressed.
  const [was, setWas] = useState<Partial<Record<keyof F, { at: string; value: string | string[] | null }>>>({});
  const dropWas = (ks: (keyof F)[] | "all") => setWas((o) => (ks === "all" ? {} : Object.keys(o).some((k) => ks.includes(k as keyof F)) ? (Object.fromEntries(Object.entries(o).filter(([k]) => !ks.includes(k as keyof F))) as typeof o) : o));
  // (Batch 23 section 5) The keys' note in two groups: your own saves elsewhere ("Added / Removed"), and what other people caused (a tester joining and given a key).
  const [keysNote, setKeysNote] = useState<{ own: { at: string; lines: string[] } | null; others: { at: string; lines: string[] } | null }>({ own: null, others: null });
  // (Owner, Oct 28, batch 16 sections 17 and 19) What this tab loaded (until a stop box shows the newer values), what it held in each field another tab
  // changed (before taking the newer value), and each such field's note, for Save's stop box: the server stops only for what this tab doesn't have.
  const seenBase = useRef<F>(toForm(init));
  const prior = useRef<Partial<Record<keyof F, { had: unknown; took: unknown }>>>({});
  const details = useRef<Partial<Record<keyof F, NoteItem>>>({});
  // (Batch 16 section 18) The free keys as of the page load (or its last stop box): Save's stop always lists what changed in them since.
  const keysSeen = useRef<string[]>(edit?.keys.free.map((k) => k.value) ?? []);
  const [stopDetails, setStopDetails] = useState<Record<string, NoteItem[]>>({});
  // (NEXT-UI 10) The form typed and not sent is kept on the server, for Post and for each Edit. (Owner, Oct 30, batch 35 §8) After signing in, it comes back with
  // each changed field marked "Draft" with "Use saved" (whether selections come back too: SIGN_IN_DRAFTS, lib/keptText.ts).
  const fb = freeBoxCheck(keysText, freeLoaded, keysData);
  const keysChanged = edit ? fb.added.length > 0 || fb.removed.length > 0 : parseKeys(keysText).length > 0;
  const keep = useKept(edit ? `test:edit:${edit.id}` : draft ? `test:draft:${draft.id}` : "test:new", { f, touched: [...touched], keysText }, touched.size === 0 && !keysChanged, (v) => {
    setF({ ...toForm(init), ...v.f });
    setTouched(new Set(v.touched));
    if (v.keysText) setKeysText(v.keysText);
  });
  const set = (p: Partial<F>) => {
    setF((o) => ({ ...o, ...p }));
    setTouched((t) => new Set([...t, ...(Object.keys(p) as (keyof F)[])]));
    setSaved("");
    dropWas(Object.keys(p) as (keyof F)[]); // (batch 35 §26) edited here: its "Changed in another tab" note goes
    // (Batch 23 section 5) Your text now matches what the other tab saved: its note goes.
    const matched = (Object.keys(p) as (keyof F)[]).filter((k) => theirs[k] && same(p[k], base[k]));
    if (matched.length) setTheirs((o) => Object.fromEntries(Object.entries(o).filter(([k]) => !matched.includes(k as keyof F))) as typeof o);
  };
  /** (Batch 23 section 5) "Use theirs": the other tab's saved value replaces what you typed here, and the note goes. */
  const takeTheirs = (k: keyof F) => {
    setF((o) => ({ ...o, [k]: base[k] }));
    setTouched((t) => new Set([...t].filter((x) => x !== k)));
    setTheirs((o) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k)) as typeof o);
  };
  /**
   * (Owner, Oct 30, batch 35 §8) After signing in, each field whose draft came back and still differs from the saved value: "Draft" and "Use saved" (the saved
   * value back). Fields that share one place (the parts and prices; the questions and their Required ticks) share one mark; "Use saved for all" at Save puts the
   * whole form back. Which fields come back at all: SIGN_IN_DRAFTS (lib/keptText.ts).
   */
  const savedKeysText = edit ? freeLoaded.join("\n") : "";
  // (Owner, Oct 31, batch 35 §18) Not only after a sign-in: whenever the form opened from a restored draft (a reload, a new tab, another tab's draft), every field
  // that differs from the saved listing (Edit) / the empty start (Post) carries its mark, until the draft is saved, posted or emptied (a field typed here after
  // opening keeps its mark too: the marks follow the draft, not who typed it).
  const marks = keep.restored ? draftMarks(f, base) : {};
  /**
   * (Owner, Oct 31, batch 35 §23) Post a test for a NEW test ("test:new") has nothing saved: each field's mark reads "Discard" (that field back to the empty start)
   * and the whole form's button "Start empty"; never "Use saved". A saved draft opened from the drafts list and Edit keep "Use saved" / "Use saved for all".
   */
  const isNew = !edit && !draft;
  const draftKind = isNew ? "discard" : "saved";
  const draftKeys = Object.values(marks).flat();
  const putSaved = (ks: (keyof F)[]) => {
    setF((o) => ({ ...o, ...Object.fromEntries(ks.map((k) => [k, base[k]])) }));
    setTouched((t) => new Set([...t].filter((x) => !ks.includes(x))));
    setTheirs((o) => Object.fromEntries(Object.entries(o).filter(([x]) => !ks.includes(x as keyof F))) as typeof o);
    dropWas(ks);
  };
  const draftMark = (where: string) => {
    const ks = marks[where] ?? [];
    return ks.length ? <DraftTag kind={draftKind} field={where} onUseSaved={() => putSaved(ks)} /> : null;
  };
  const keysDraft = keep.restored && keysChanged ? <DraftTag kind={draftKind} field="keys" onUseSaved={() => setKeysText(savedKeysText)} /> : null;
  const putAllSaved = () => {
    putSaved(draftKeys);
    setKeysText(savedKeysText);
  };
  /**
   * (Owner, Oct 31, batch 35 §18) The form opened with a restored draft (a reload, a new tab, a sign-in): a line at the top says so, with a way out. Post a test
   * ("test:new"): "Start empty" puts every field back to the empty start and deletes the draft (a brand-new test). Edit (and a saved draft opened in Post):
   * "Use saved for all" puts every field and the keys back to what is saved, and the draft goes.
   */
  const fromDraft = keep.restored && (touched.size > 0 || keysChanged);
  const discardAll = () => {
    const all = Object.keys(f) as (keyof F)[];
    setF(edit || draft ? base : toForm(init));
    setTouched(new Set());
    setTheirs((o) => Object.fromEntries(Object.entries(o).filter(([x]) => !all.includes(x as keyof F))) as typeof o);
    setKeysText(savedKeysText);
    setBlurred(new Set());
    dropWas("all");
    void keep.clear();
  };
  const leave = (k: string) => setBlurred((b) => (b.has(k) ? b : new Set([...b, k])));

  // What differs from what this tab knows (Edit): the Save button is faded when nothing does.
  const changedKeys = useMemo(() => (edit ? (Object.keys(f) as (keyof F)[]).filter((k) => JSON.stringify(f[k]) !== JSON.stringify(base[k])) : []), [f, base, edit]);
  const nothingChanged = !!edit && changedKeys.length === 0 && !keysChanged;
  useEffect(() => {
    if (nothingChanged) setPayTick(false);
  }, [nothingChanged]);
  // (Owner, Oct 28 afternoon) Once a tester has joined, each limited field (the steps, questions, required languages, required devices; batch 34 §15: never the NDA) has its OWN 3 changes (one Save that
  // changes two of them uses one change of each; prices, parts, the build link and access keys are not limited). "Changes left: N of 3" sits next to each field's label; a field
  // at 0 locks with its note, and the other fields stay editable.
  const limited = !!edit && everJoined;
  const fieldLocked = (f: CriticalField) => limited && critCounts[f] >= LIMITS.criticalChanges;
  // A field changed here that another tab's Save locked meanwhile doesn't save: the field is red and its line says so.
  const apiOf = (ks: (keyof F)[]) => ks.flatMap((k) => API_FIELDS[k]);
  // (Batch 14) Each field's own counter: the build link, and ONE for the parts and prices (part ticks, prices, Required, Free, the live rate and call length).
  const lockedNow = edit ? countersOf(apiOf(changedKeys)).filter(fieldLocked) : [];
  const locked = lockedNow.length > 0;
  const lockedKey = (k: keyof F) => locked && changedKeys.includes(k) && API_FIELDS[k].some((a) => { const c = counterOf(a); return !!c && lockedNow.includes(c); });
  /** "Changes left: 2 of 3" next to a limited field's label (Edit, once a tester has joined). */
  const left = (f: CriticalField) => (limited ? <span className="ml-2 text-xs font-normal text-slate-500" data-changes-left={f}>{changesLeftLine(critCounts[f])}</span> : null);
  /** The lock note under a field that used its 3 changes. */
  const lockNote = (f: CriticalField) => (fieldLocked(f) ? <p className="info mt-1" data-critical-locked={f}>{criticalLine(f)}</p> : null);
  /**
   * (Batch 30 §9) A locked field this tab still changes (another tab's Save locked it meanwhile): what each change is, for the line at Save ("Your change to the live
   * call rate ($24.00/h → $30.00/h) can't be saved: …") with Put it back.
   */
  const lockedItems = (c: CriticalField): LockedItem[] =>
    changedKeys.filter((k) => API_FIELDS[k].some((a) => counterOf(a) === c)).map((k) => {
      const unit = k === "liveRate" ? "/h" : "";
      const before = shortValue(valueText(k, base[k])), now = shortValue(valueText(k, f[k]));
      const name = (NAMES[k] ?? String(k)).replace(/^./, (x) => x.toLowerCase());
      return { key: String(k), name, ...(before != null && now != null ? { before: before + (before.startsWith("$") ? unit : ""), now: now + (now.startsWith("$") ? unit : "") } : {}) };
    });
  /** Put it back: the saved value returns to these fields (the other changes still save). */
  const putBack = (keys: string[]) => {
    setF((o) => ({ ...o, ...Object.fromEntries(keys.map((k) => [k, base[k as keyof F]])) }));
    setTouched((t) => new Set([...t].filter((k) => !keys.includes(k))));
    setOrphans([]);
  };
  /** The field's name in the line scrolls to it, marked. */
  const jumpField = (k: string) => jumpTo(k === "writtenPrice" || k === "recordingPrice" || k === "liveRate" ? k : k === "languages" || k === "devices" ? `${k}-group` : k === "questions" || k === "requiredQs" ? "questions-group" : NOTE_AT[k as keyof F] ?? k);

  // (Owner, Oct 29, batch 12 section 6; batch 15 section 18) No "days after joining" field: Open until is required (3 to 30 days from today on Post) and is the last day
  // to join; every tester gets the same days (opened → Open until) from when they join.
  const dlLine = "";
  // (5) Open until can only be extended.
  const ouNow = init.openUntil ? init.openUntil.slice(0, 10) : "";
  const shortened = !!edit && !!ouNow && !!f.openUntil && f.openUntil < base.openUntil && f.openUntil < ouNow;
  // (Batch 35 §30) The same line as the server's (openUntilExtendLine), so the press's refusal is this line, shown once, at the box.
  const ouLine = shortened ? openUntilExtendLine(base.openUntil.slice(0, 10)) : "";
  // Keys: every open spot needs a free key.
  const spotsN = Number(f.spots);
  const freeAfter = parseKeys(keysText).length;
  // The working testers follow the test live (testers joining while Edit is open take open spots and free keys).
  const testersIn = edit ? (keysData?.testersIn ?? edit.testersIn) : 0;
  const openN = edit ? Math.max(0, spotsN - testersIn) : spotsN;
  const usesKeys = edit ? (keysData?.uses ?? false) || parseKeys(keysText).length > 0 : parseKeys(keysText).length > 0;
  // (Batch 15 sections 19 and 44) Red, one line each: a typed key in use by a working tester, a duplicate, a deleted line whose key a tester was given meanwhile, too few keys.
  const keyLine = [...(edit ? fb.errors : []), usesKeys && Number.isInteger(spotsN) && spotsN > 0 ? keyNeedLine(openN, freeAfter, edit ? keysData?.keyless ?? 0 : 0) : ""].filter(Boolean).join(" ");
  const showOn = (k: string) => pressed || blurred.has(k);

  // (Batch 16 section 10) A server mistake is red AT its field (FieldChecks marks it, with the same text, until that field's value changes); here only a
  // field another tab's Save locked, and Open until's own line.
  const bad = (k: keyof F) => lockedKey(k) || (k === "openUntil" && showOn("openUntil") && (!!dlLine || !!ouLine)) || (k === "deadlineDays" && showOn("deadlineDays") && !!dlLine);
  /** The box (or group) a field's mistakes go to. */
  const fieldEl = (k: ListingField) => document.getElementById(k === "keys" ? (edit ? "keysFree" : "accessKeys") : k === "highWritten" ? "high-written" : k === "highRecording" ? "high-recording" : k);
  /** The server's mistakes: each at its field (red, the same text); the page goes to the first red field; the rest stay in the list under the button. */
  function showServer(messages: string[]) {
    const left = markServerMistakes(formRef.current, messages, (m) => {
      const k = fieldOfMistake(m);
      const el = k ? fieldEl(k) : null;
      // A box already red with this very line (the keys' own line) isn't marked twice. (Batch 17 section 13) The keys' line is this page's own, even before the
      // press has re-rendered the box red: shown once, under the Free box.
      return el && (el.dataset.redMsg === m || (k === "keys" && !!keyLine && keyLine.includes(m))) ? null : el;
    });
    // (Batch 30 §9) A locked field's line is the one at Save (naming the change, with Put it back), never a second copy in the list: the counts the server sends with
    // it lock the field here.
    setOrphans(left.filter((m) => !isCriticalLine(m)));
    focusFirstMistake(formRef.current);
  }
  const keysBad = (showOn("keys") || pressed) && !!keyLine;

  /**
   * Apply what another tab or device saved. (Owner, Oct 29, batch 23 section 5: Edit keeps what you typed; it shows what the other tab saved) A field you haven't touched
   * takes the saved value silently; a field you typed in keeps your text, with a note under it showing what was saved there and "Use theirs" (lib/editMerge.ts). A
   * field that already holds the saved value isn't news: its base just moves. Spots and Open until keep the older rule: they take the saved value with the note naming
   * what it replaced ("Spots: 4 → 5") and, when this tab had typed something else, "What you typed (not saved):" in full with Copy.
   */
  function applyElsewhere(listing: Listing, at: string) {
    const now = toForm(listing);
    const m = mergeElsewhere(f, base, now);
    const fresh: Record<string, { at: string; items: NoteItem[] }> = {};
    const takeover: Partial<F> = {};
    for (const k of m.take) (takeover as Record<string, unknown>)[k] = now[k];
    for (const k of m.oldNote) {
      if (!prior.current[k]) prior.current[k] = { had: f[k], took: now[k] };
      const typed = !same(f[k], base[k]);
      const item: NoteItem = { name: NAMES[k] ?? k, before: valueText(k, base[k]), after: valueText(k, now[k]), ...(typed ? { typed: valueText(k, f[k]) } : {}) };
      if (!details.current[k]) details.current[k] = item;
      const where = NOTE_AT[k] ?? k;
      fresh[where] = { at, items: [...(fresh[where]?.items ?? []), item] };
    }
    const moved = (Object.keys(now) as (keyof F)[]).filter((k) => !same(now[k], base[k]));
    if (moved.length) setBase((o) => ({ ...o, ...Object.fromEntries(moved.map((k) => [k, now[k]])) }));
    // (Batch 34 §9) A field this tab already holds the saved value of, or took silently, is no longer news to it: what it sends as loaded moves there too, so typing
    // in it again later never stops Save as "saved in another tab" (that line only ever comes with its note, below).
    const known = [...m.settled, ...m.take.filter((k) => !m.oldNote.includes(k))];
    if (known.length) seenBase.current = { ...seenBase.current, ...Object.fromEntries(known.map((k) => [k, now[k]])) };
    if (Object.keys(takeover).length) setF((o) => ({ ...o, ...takeover }));
    const settled = [...m.take, ...m.settled];
    if (settled.length) setTouched((t) => new Set([...t].filter((k) => !settled.includes(k))));
    if (moved.length) setTheirs((o) => ({ ...Object.fromEntries(Object.entries(o).filter(([k]) => !settled.includes(k as keyof F))), ...Object.fromEntries(m.keep.map((k) => [k, at])) }) as typeof o);
    if (Object.keys(fresh).length) setNotes((n) => ({ ...n, ...fresh }));
    // (Owner, Oct 31, batch 35 §26) Each field this tab hadn't touched that took the saved value says so under it: "Changed in another tab at 11:43 PM: was “…”" (what it
    // showed just before). Spots and Open until keep their own notes (above).
    const quiet = m.take.filter((k) => !m.oldNote.includes(k));
    if (quiet.length) setWas((o) => ({ ...o, ...Object.fromEntries(quiet.map((k) => [k, { at, value: emptyValue(base[k]) ? null : valueText(k, base[k]) }])) }));
  }
  /**
   * (Owner, Oct 28, batch 16 sections 18 and 20) The keys another tab, device or joining tester changed, as soon as the page sees them: the Free box becomes
   * the current free keys with this tab's own additions and deletions still applied (a key typed here that was added elsewhere shows once; a key deleted
   * elsewhere leaves the box: it never comes back by itself). The note always says so, even for a change this tab also made: "Added: …", "Removed: …", a join
   * on its own line, and for a key this tab had deleted that a joining tester was given, the warning (it simply leaves this tab's pending deletions).
   */
  function applyKeys(next: { free: string[]; inUse: KeysData["inUse"] }, at: string) {
    const nowFree = next.free;
    const addedElse = nowFree.filter((v) => !freeLoaded.includes(v));
    const goneElse = freeLoaded.filter((v) => !nowFree.includes(v));
    if (!addedElse.length && !goneElse.length) return;
    const mine = freeBoxCheck(keysText, freeLoaded, null);
    const givenTo = (v: string) => next.inUse.find((k) => k.value === v && !k.gone)?.tester;
    const joined = goneElse.filter((v) => givenTo(v));
    const deletedHere = joined.filter((v) => mine.removed.includes(v));
    const joinedOnly = joined.filter((v) => !mine.removed.includes(v));
    const removed = goneElse.filter((v) => !givenTo(v));
    // (Batch 23 section 5) Your own saves elsewhere, and what other people caused (a tester joining and given a key), each under its own heading.
    const ownLines = [
      ...(addedElse.length ? [keysAddedLine(addedElse)] : []),
      ...(removed.length ? [keysRemovedLine(removed)] : []),
    ];
    const otherLines = [
      ...joinedOnly.map((v) => keyGivenLine(givenTo(v)!, v)),
      ...(deletedHere.length ? [givenDeletedLine(deletedHere.map((v) => ({ name: givenTo(v)!, value: v })))] : []),
    ];
    setFreeLoaded(nowFree);
    setKeysText([...nowFree.filter((v) => !mine.removed.includes(v)), ...mine.added.filter((v) => !nowFree.includes(v) && !givenTo(v))].join("\n"));
    // Your own changes replace the older ones (unless from the same refresh); joins add up.
    const merge = (old: { at: string; lines: string[] } | null, lines: string[], keepOld: boolean) =>
      lines.length ? { at, lines: [...(old && (keepOld || old.at === at) ? old.lines : []), ...lines].filter((l, i, all) => all.indexOf(l) === i) } : old;
    setKeysNote((n) => ({ own: merge(n.own, ownLines, false), others: merge(n.others, otherLines, true) }));
  }
  /** (Batch 16 section 17) What this tab holds, for the server: a field another tab changed counts with the value this tab had then (unless typed in since). */
  const holding = (): F => {
    const out = { ...f } as Record<string, unknown>;
    for (const [k, p] of Object.entries(prior.current)) if (p && same(f[k as keyof F], p.took)) out[k] = p.had;
    return out as F;
  };

  // (Design doc 5) While Edit is open, what other tabs and devices save shows up here, live: the field takes the new value
  // and a blue note under it says what changed; the In use / Free boxes follow too.
  const versionRef = useRef(version);
  versionRef.current = version;
  // (Batch 34 §9) A Save went through and the page is on its way to the test page: nothing redraws it meanwhile (no flash of "Changes left" or of a lock line).
  const leaving = useRef(false);
  const live = useRef({ applyElsewhere, applyKeys, f, base, keysData });
  live.current = { applyElsewhere, applyKeys, f, base, keysData };
  useEffect(() => {
    if (!edit) return;
    let alive = true;
    const tick = async () => {
      if (leaving.current) return;
      const r = await api<{ version: number; listing: Listing; keys: KeysData; at: string; criticalCounts?: CriticalCounts; everJoined?: boolean }>(`/api/tests/${edit.id}/listing`).catch(() => null);
      if (!r || !alive || leaving.current) return;
      if (r.criticalCounts) setCritCounts(countsOf(r.criticalCounts));
      if (typeof r.everJoined === "boolean") setEverJoined(r.everJoined);
      if (r.version !== versionRef.current) {
        live.current.applyElsewhere(r.listing, r.at);
        setVersion(r.version);
      }
      // (Batch 16 sections 18 and 20) Keys change without a new version too (a join): every refresh compares them.
      live.current.applyKeys({ free: r.keys.free.map((k) => k.value), inUse: r.keys.inUse }, r.at);
      setKeysData(r.keys);
    };
    const t = setInterval(tick, 20_000);
    const onTick = () => void tick();
    window.addEventListener("live-tick", onTick);
    // (Batch 34 §9) Shown again from the browser's back/forward cache (Back after a Save): the data is refreshed at once, from the base the Save left.
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      leaving.current = false;
      setBusy(false);
      void tick();
    };
    window.addEventListener("pageshow", onShow);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("live-tick", onTick);
      window.removeEventListener("pageshow", onShow);
    };
  }, [edit]);

  /**
   * (Batch 34 §9, owner's finding) The Save went through: the page's base (the version and every field's saved value, the free keys) becomes what was just saved, nothing
   * is "changed" any more and the kept draft goes, so a tab switch, a Back / forward return or a draft restore never brings older text back or calls this save "another tab".
   */
  function savedHere(listing: Listing, v: number, keys?: KeysData) {
    leaving.current = true;
    const now = toForm(listing);
    setF(now);
    setBase(now);
    seenBase.current = now;
    versionRef.current = v;
    setVersion(v);
    setTouched(new Set());
    prior.current = {};
    details.current = {};
    setTheirs({});
    setNotes({});
    setWas({});
    setStopDetails({});
    setChanges(null);
    setBoxAt("");
    setOrphans([]);
    setPressed(false);
    setPayTick(false);
    setHigh({});
    if (keys) {
      const free = keys.free.map((k) => k.value);
      setKeysData(keys);
      setFreeLoaded(free);
      setKeysText(free.join("\n"));
      keysSeen.current = free;
      setKeysNote({ own: null, others: null });
    }
  }

  /** (Batch 15 section 19) The Free box after a red line or a stop: the current free keys, with this page's own additions and deletions still applied. */
  async function rebaseKeys() {
    if (!edit) return;
    const r = await api<{ keys: KeysData }>(`/api/tests/${edit.id}/listing`).catch(() => null);
    if (!r) return;
    setKeysData(r.keys);
    live.current.applyKeys({ free: r.keys.free.map((k) => k.value), inUse: r.keys.inUse }, new Date().toISOString());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (nothingChanged) return;
    setPressed(true);
    dropWas("all"); // (batch 35 §26) on Save, the "Changed in another tab" notes go
    if (locked) return;
    setBusy(true);
    setOrphans([]);
    setRefusal("");
    try {
      if (!edit) {
        // (Batch 15 section 32) The developer's time zone goes with the press: "today" and the 3 to 30 days are counted in it.
        const r = await api<{ id: string }>(draft ? `/api/tests/${draft.id}/post-draft` : "/api/tests", { ...toApi(f), accessKeys: keysText, confirmHigh: confirmHigh(), payRulesOk: payTick, timeZone: browserZone(), agreeTerms });
        await keep.clear();
        window.location.href = `/app/tests/${r.id}`;
        return;
      }
      const all = toApi(f);
      const fields: Record<string, unknown> = {};
      for (const k of touched) for (const a of API_FIELDS[k]) fields[a] = all[a];
      const r = await api<{ offered: number; notReinvited?: string[]; resent?: string[]; closedApps?: string[]; spotClosed?: string[]; spots?: number; version?: number; listing?: Listing; keys?: KeysData }>(`/api/tests/${edit.id}/edit`, {
        version, fields, confirmHigh: confirmHigh(), payRulesOk: payTick, seenAt: edit.seenAt, confirmed: changes != null, ...(changes != null && boxAt ? { boxAt } : {}), timeZone: browserZone(),
        keysAdd: fb.added, keysRemove: fb.removed,
        // (Batch 16 section 17) What this tab loaded and what it holds: another tab's save of the same values is no reason to stop.
        base: toApi(seenBase.current), has: toApi(holding()), keysLoaded: keysSeen.current,
      });
      if (r.listing && typeof r.version === "number") savedHere(r.listing, r.version, r.keys);
      else leaving.current = true;
      await keep.clear();
      const q = (k: string, v?: string[]) => (v?.length ? `&${k}=${encodeURIComponent(v.join(", "))}` : "");
      window.location.href = `/app/tests/${edit.id}?saved=1&offered=${r.offered ?? 0}${q("closed", r.closedApps)}${q("resent", r.resent)}${q("skipped", r.notReinvited)}${r.spotClosed?.length ? `${q("spotclosed", r.spotClosed)}&spots=${r.spots}` : ""}`;
    } catch (err) {
      if (err instanceof ApiError && err.code === "changed") {
        // The blue stop (what changed since Edit opened), and any red mistakes with it. Fields saved elsewhere take their new value here.
        setChanges((c) => (c ? mergeChanges(c, (err.data.changes as Change[]) ?? []) : (err.data.changes as Change[])));
        if (typeof err.data.now === "string") setBoxAt(err.data.now);
        setListingEdited(err.data.listingEdited === true);
        showServer(Array.isArray(err.data.errors) ? (err.data.errors as string[]) : []);
        if (typeof err.data.version === "number") setVersion(err.data.version);
        if (err.data.criticalCounts) setCritCounts(countsOf(err.data.criticalCounts));
        // The In use / Free boxes and the open spots follow at once (not at the next 20-second refresh); (batch 15 section 19) the Free box shows the current free keys
        // with this page's own edits still applied.
        if (edit) void rebaseKeys();
        if (err.data.current) applyElsewhere(err.data.current as Listing, typeof err.data.now === "string" ? err.data.now : new Date().toISOString());
        // (Batch 34 §9) Every "<field>: your version will replace the one saved in another tab at …" line shows that field's blue note (their value, Use theirs), also when
        // this tab's base had already caught up with that save (a live refresh) and after a fresh load with a restored draft.
        if (err.data.current) {
          const yours = ((err.data.changes as Change[]) ?? []).filter((c) => c.kind === "yours" && c.fields?.length);
          const marks = yours.flatMap((c) => (Object.keys(API_FIELDS) as (keyof F)[]).filter((k) => !takesTheirs(String(k)) && API_FIELDS[k].some((a) => c.fields!.includes(a))).map((k) => [k, c.at || (typeof err.data.now === "string" ? err.data.now : new Date().toISOString())] as const));
          if (marks.length) setTheirs((o) => ({ ...o, ...Object.fromEntries(marks) }));
        }
        // (Batch 16 section 19) The stop box shows each field's Before / What you typed (from the notes); the next press counts from what it showed.
        const byApi: Record<string, NoteItem[]> = {};
        for (const [k, item] of Object.entries(details.current) as [keyof F, NoteItem][]) for (const a of API_FIELDS[k]) byApi[a] = [...(byApi[a] ?? []), item];
        setStopDetails((o) => ({ ...o, ...byApi }));
        details.current = {};
        prior.current = {};
        if (err.data.current) seenBase.current = toForm(err.data.current as Listing);
        if (err.data.keys) keysSeen.current = (err.data.keys as { free: string[] }).free;
      }
      else if (err instanceof ApiError && err.code === TERMS_UPDATED_CODE) {
        // (Batch 20 section 21) The tick shows above the button (if the Terms changed while the page was open) with its red line.
        setChanges(null);
        setTermsAsk(true);
        showServer([err.message]);
      }
      else if (err instanceof ApiError && !isFieldError(err)) {
        // A refusal (e.g. "Confirm your email first."): blue, under the button.
        setChanges(null);
        setRefusal(err.message);
      } else {
        setChanges(null);
        showServer(err instanceof ApiError && Array.isArray(err.data.errors) ? (err.data.errors as string[]) : [(err as Error).message]);
        if (edit && err instanceof ApiError && Array.isArray(err.data.errors) && (err.data.errors as string[]).some((x) => /key/i.test(x))) void rebaseKeys();
        if (err instanceof ApiError && err.data.criticalCounts) setCritCounts(countsOf(err.data.criticalCounts));
      }
    } finally {
      // (Batch 34 §9) Leaving after a Save: the button stays "Saving…" until the test page shows (a Back return frees it).
      if (!leaving.current) setBusy(false);
    }
  }

  // (Owner, Oct 29, batch 30 §18) Title and steps: at least 10 characters, red on leaving the field and on the press ("Name of this test: at least 10 characters (6 so
  // far)."). On Edit only once that field is changed: an older test's short value never blocks saving another field.
  const minAttrs = (k: "title" | "description", label: string): Record<string, string> => (!edit || f[k] !== base[k] ? { "data-min-chars": String(LISTING_MIN_CHARS), "data-min-label": label } : {});
  // (Owner) Every box with a range says it next to it and is checked as soon as it's left (FieldChecks).
  const text = (k: keyof F, label: string, opts: { req?: boolean; ph?: string; type?: string; cls?: string; attrs?: Record<string, string>; hint?: string; max?: number; disabled?: boolean; after?: React.ReactNode; /** (batch 35 §30) a red line of the page's own, right under the box */ below?: React.ReactNode; /** (Batch 30 §18) the field's minimum: its counter shows it while under */ min?: number } = {}) => (
    <div>
      <label className={"label" + (opts.req ? " req" : "")} htmlFor={k}>{label}{opts.after}{draftMark(k)}</label>
      <div className="flex flex-wrap items-center gap-2">
        <input id={k} type={opts.type ?? "text"} disabled={opts.disabled} className={"input " + (opts.cls ?? "") + (bad(k) ? " field-bad" : "")} placeholder={opts.ph} value={f[k] as string} maxLength={opts.max}
          onChange={(e) => set({ [k]: e.target.value } as Partial<F>)} onBlur={() => leave(k)} {...(opts.req ? { "data-required": "" } : {})} {...opts.attrs} />
        {opts.hint && <span className="text-xs text-slate-500">{opts.hint}</span>}
        {opts.max && <span className="ml-auto text-xs text-slate-500" aria-hidden data-count={k}>{opts.min && (f[k] as string).trim().length < opts.min ? minCounter((f[k] as string).trim().length) : `${(f[k] as string).length}/${opts.max}`}</span>}
      </div>
      {opts.below}
      {note(k)}
    </div>
  );
  /** The blue note under a field changed in another tab or device (batch 16 section 19: what it replaced, and what this tab had typed). */
  const note = (k: string) => {
    // (Batch 23 section 5) The keys: "Changed in another tab or device at …:" over your own saves elsewhere, "Updated at …:" over a tester joining and given a key.
    if (k === "keys") {
      const groups = [
        ...(keysNote.own ? [{ heading: `${CHANGED_ELSEWHERE} ${clock(keysNote.own.at)}`, lines: keysNote.own.lines }] : []),
        ...(keysNote.others ? [{ heading: `${UPDATED_AT} ${clock(keysNote.others.at)}`, lines: keysNote.others.lines }] : []),
      ];
      return groups.length ? <GroupNote groups={groups} /> : null;
    }
    const n = notes[k];
    // Typed fields another tab saved (still different from what you typed): their value, with Use theirs.
    const mine = (Object.keys(theirs) as (keyof F)[]).filter((x) => (NOTE_AT[x] ?? x) === k && !takesTheirs(String(x)) && !same(f[x], base[x]));
    const at = mine.map((x) => theirs[x]!).sort().pop();
    // (Batch 35 §26) Untouched fields here that took another tab's saved value: what each was.
    const quiet = (Object.keys(was) as (keyof F)[]).filter((x) => (NOTE_AT[x] ?? x) === k);
    if (!n && !at && !quiet.length) return null;
    return (
      <>
        {n && <FieldNote key={n.at + JSON.stringify(n.items)} label={`${CHANGED_ELSEWHERE} ${clock(n.at)}`} items={n.items} />}
        {quiet.length > 0 && <WasNote items={quiet.map((x) => ({ field: String(x), name: x === k ? undefined : NAMES[x] ?? String(x), time: clock(was[x]!.at), was: wasText(was[x]!.value) }))} />}
        {at && <TheirsNote heading={`${SAVED_ELSEWHERE} ${clock(at)}`} items={mine.map((x) => ({ field: String(x), name: NAMES[x] ?? String(x), value: valueText(x, base[x]), onUse: () => takeTheirs(x) }))} />}
      </>
    );
  };
  /** Save's stop box: under "You changed the … in another tab", each field's Before / What you typed. */
  const stopDetail = (c: Change) => {
    const items = [...new Set((c.fields ?? []).flatMap((a) => stopDetails[a] ?? []))];
    return items.length ? <NoteItems items={items} /> : null;
  };
  const tomorrow = useLocalMin(24 * 60, true), in3 = useLocalMin(3 * 24 * 60, true), monthOut = useLocalMin(30 * 24 * 60, true);
  const minOpen = edit ? tomorrow : in3;
  // (Batch 16 section 16) Edit: up to 30 days after the test opened (a date already past it stays as it is: it just can't move later).
  const capMax = edit?.capDay ? (base.openUntil && base.openUntil.slice(0, 10) > edit.capDay ? base.openUntil.slice(0, 10) : edit.capDay) : monthOut;
  // (Owner, Oct 29, batch 31) At most 10 testers per test; Edit: a test already above 10 keeps its saved spots (lower, never higher).
  const limit = edit ? spotsCap(Number(base.spots) || 0) : MAX_SPOTS;
  const spotsLine = limit > MAX_SPOTS ? spotsKeptLine(limit) : SPOTS_MAX_LINE;
  const redLine = (t: string) => (t ? <p className="err-field mt-1" role="alert">{t}</p> : null);

  return (
    <form ref={formRef} className="space-y-4" onSubmit={submit} {...(edit ? { "data-red-and-blue": "" } : {})} noValidate>
      {fromDraft && (
        <p className="info text-sm" data-from-draft="">
          {DRAFT_START_LINE(keep.restoredAt ? fmtDateTime(keep.restoredAt) : "")}
          {" · "}<button type="button" className="text-sky-300 underline" data-discard-draft="" onClick={discardAll}>{isNew ? START_EMPTY_LABEL : USE_SAVED_ALL_LABEL}</button>
        </p>
      )}
      <p className="note"><span className="text-punch-400">*</span> marks the fields you have to fill in.</p>
      <div className="panel">
        <h2>What are testers trying?</h2>
        {text("productName", "Product", { req: true, ph: "Harbor Run", max: LIMITS.productName, attrs: { "data-required-msg": "Enter the product name." } })}
        {text("title", "Name of this test", { req: true, ph: "First 3 levels", max: LIMITS.testName, min: LISTING_MIN_CHARS, attrs: { "data-required-msg": "Give the test a title.", "data-match": `^${TITLE_FIELD}: at least`, ...minAttrs("title", TITLE_FIELD) } })}
        <div>
          <label className="label req" htmlFor="description">What should testers do?{left("description")}{draftMark("description")}</label>
          <textarea id="description" rows={4} disabled={fieldLocked("description")} className={"input" + (bad("description") ? " field-bad" : "")} value={f.description} maxLength={LIMITS.whatToDo} data-required="" data-required-msg={DESCRIPTION_REQUIRED} data-match={`^${STEPS_FIELD}: at least`} {...minAttrs("description", STEPS_FIELD)} onBlur={() => leave("description")} onChange={(e) => set({ description: e.target.value })} />
          <p className="mt-1 text-right text-xs text-slate-500" data-steps-count="">{f.description.trim().length < LISTING_MIN_CHARS ? minCounter(f.description.trim().length) : `${f.description.length.toLocaleString("en-US")} / ${LIMITS.whatToDo.toLocaleString("en-US")}`}</p>
          {lockNote("description")}
          {note("description")}
        </div>
        {/* (Batch 14) The build link is a limited field with its own 3 changes. */}
        {/* (Owner, Oct 31, batch 35 §27) The link checks itself: red at the box as soon as it holds something not starting with https:// (on leaving it, then as it's
            typed in once red), and the server's same line lands here too. On Edit only once the link is changed (an older link never blocks saving another field). */}
        {text("buildUrl", "Link to the product or build", { ph: "https://…", after: left("buildUrl"), disabled: fieldLocked("buildUrl"), attrs: { "data-match": "^The build link must start", ...(!edit || f.buildUrl !== base.buildUrl ? { "data-pattern": BUILD_URL_PATTERN, "data-msg": BUILD_URL_LINE } : {}) } })}
        {lockNote("buildUrl")}
        {/* The full app's Categories: a row of tick boxes, at least one. */}
        <fieldset id="categories" data-field-group="" className="space-y-2">
          <legend className="label req">Categories{draftMark("categories")}</legend>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((o) => (
              <label key={o} className={PICK_CHIP}>
                <input type="checkbox" name="categories" value={o} checked={f.categories.includes(o)} onChange={(e) => set({ categories: e.target.checked ? [...f.categories, o] : f.categories.filter((x) => x !== o) })} /> {o}
              </label>
            ))}
          </div>
          {note("categories")}
        </fieldset>
        {/* (Owner, Oct 28 afternoon) Required languages and devices are limited fields: each locks after its own 3rd change since testers joined. */}
        <fieldset id="languages-group" disabled={fieldLocked("languages")} data-locked={fieldLocked("languages") ? "" : undefined} className={`scroll-mt-24 rounded-xl data-[marked]:ring-2 data-[marked]:ring-sky-300 ${lockedKey("languages") ? "p-2 ring-1 ring-rose-400" : ""}`}>
          <Choices label="Language requirements (any one)" aside={<>{left("languages")}{draftMark("languages")}</>} options={LANGUAGES} value={f.languages} onChange={(languages) => set({ languages })} />
          {lockNote("languages")}
          {note("languages")}
        </fieldset>
        <fieldset id="devices-group" disabled={fieldLocked("devices")} data-locked={fieldLocked("devices") ? "" : undefined} className={`scroll-mt-24 rounded-xl data-[marked]:ring-2 data-[marked]:ring-sky-300 ${lockedKey("devices") ? "p-2 ring-1 ring-rose-400" : ""}`}>
          <Choices label="Technology requirements: devices, platforms or skills (any one; none ticked = any)" aside={<>{left("devices")}{draftMark("devices")}</>} options={DEVICES} value={f.devices} onChange={(devices) => set({ devices })} />
          {lockNote("devices")}
          {note("devices")}
        </fieldset>
        {/* (4) Mature (18+): ticking it shows the required "why" at once. */}
        <div className="space-y-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink-200">
            <input type="checkbox" checked={f.mature} onChange={(e) => set({ mature: e.target.checked })} /> Mature (18+) content{draftMark("mature")}
          </label>
          {/* (Owner, Oct 28, batch 16 section 9) One line that doesn't contradict itself. */}
          <p className="text-xs text-slate-500" data-mature-hint="">Tick this if your test has mature content, and say why. Never allowed: sexual content involving minors, illegal content, real-world gore. Other graphic content must be marked Mature.</p>
          {f.mature && (
            <div>
              <label className="label req" htmlFor="matureWhy">Why is this test mature?{draftMark("matureWhy")}</label>
              {/* (Batch 16 section 9) At least 5 characters: the red line under the box says which rule (empty, or too short), the same lines as the server. */}
              <textarea id="matureWhy" rows={2} className="input" maxLength={LIMITS.matureWhy} value={f.matureWhy} placeholder="e.g. Violence in the boss fights; testers must be 18 or older"
                data-required="" data-required-msg={MATURE_WHY_REQUIRED} data-min-chars={String(MATURE_WHY_MIN)} data-msg={MATURE_WHY_SHORT} onBlur={() => leave("matureWhy")} onChange={(e) => set({ matureWhy: e.target.value })} />
              <p className="mt-1 text-right text-xs text-slate-500" data-mature-count="">{f.matureWhy.length.toLocaleString("en-US")} / {LIMITS.matureWhy.toLocaleString("en-US")}</p>
            </div>
          )}
          {note("mature")}{note("matureWhy")}
        </div>
      </div>

      <div className="panel">
        <h2>Deliverables</h2>
        <p className="note">Every term is fixed in each tester&apos;s contract when they join. Edits change the listing for new testers only.</p>
        {/* The full app's Parts and prices: one card per part (tick, title, what it is, Required, price, Free). Required is
            a label only (NEWEST+10): part of the terms, it blocks nothing. */}
        {/* (Batch 30 §9) Locked, EVERY input in the group is disabled (the ticks, Required, prices, Free and the over-$200 tick); a note's Use theirs still works. */}
        <fieldset id="parts" data-field-group="" className="space-y-2 scroll-mt-24 rounded-xl data-[marked]:ring-2 data-[marked]:ring-sky-300" data-locked={fieldLocked("parts") ? "" : undefined}>
          {/* (Batch 14) Parts and prices: ONE limited counter for the part ticks, prices, Required and Free ticks, the live rate and call length. */}
          <legend className="label req">Parts and prices{left("parts")}{draftMark("parts")}</legend>
          {lockNote("parts")}
          {PARTS.map((part) => {
            const on = f[part.on] as boolean;
            const price = f[part.price] as string;
            const free = on && /^0+(\.0+)?$/.test(price.trim());
            const pl = fieldLocked("parts");
            return (
              <div key={part.on} className={`space-y-1.5 rounded-xl border p-3 text-sm ${on ? "border-indigo-400/60 bg-indigo-500/10" : "border-white/10 bg-white/[0.03]"}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <label className="flex min-w-[11rem] flex-1 cursor-pointer gap-2">
                    <input type="checkbox" disabled={pl} checked={on} onChange={(e) => set({ [part.on]: e.target.checked } as Partial<F>)} aria-label={`Include the ${part.title.toLowerCase()}`} />
                    <span><span className="block text-white">{part.title}</span><span className="text-xs text-slate-400">{part.help}</span></span>
                  </label>
                  <label className={`flex items-center gap-1.5 ${on ? "text-slate-200" : "text-slate-600"}`}>
                    <input type="checkbox" disabled={!on || pl} checked={on && (f[part.req] as boolean)} onChange={(e) => set({ [part.req]: e.target.checked } as Partial<F>)} aria-label={`${part.title}: required`} /> Required
                  </label>
                  <span className="flex flex-wrap items-center gap-2">
                    <label className={`flex items-center gap-1 ${free || !on ? "text-slate-600" : "text-slate-300"}`}>
                      $
                      <input id={part.price} className={"input w-24 py-1 scroll-mt-24 data-[marked]:ring-2 data-[marked]:ring-sky-300" + (bad(part.price) ? " field-bad" : "")} inputMode="decimal" data-money="" disabled={!on || free || pl} placeholder={part.ph} value={free ? "" : price}
                        onChange={(e) => set({ [part.price]: e.target.value } as Partial<F>)} aria-label={`Price for the ${part.title.toLowerCase()}`}
                        data-min={part.min} data-max={part.max} data-zero-ok="" data-min-msg={part.lowMsg} data-max-msg={part.highMsg} data-msg={part.lowMsg}
                        // (Owner, Oct 28, batch 20 section 22) Ticked: a price is required ($0 only through Free), red on leaving it and on press; the server says the same.
                        {...(on && !free ? { "data-required": "", "data-required-msg": PART_PRICE_MISSING[part.on] } : {})} data-match={`^${PART_PRICE_MISSING[part.on].slice(0, 30)}`} />
                      {part.unit}
                    </label>
                    <span className="text-xs text-slate-500">{part.min}–{Number(part.max).toLocaleString("en-US")}{part.unit}</span>
                    {part.key && on && (() => {
                      const cents = toCents(price);
                      const savedSame = !!edit && toCents(base[part.price] as string) === cents && base[part.on];
                      return cents != null && cents > HIGH_PART_CENTS && !savedSame ? (
                        <label className="flex items-center gap-1.5 text-xs text-amber-200" data-high-tick={part.key}>
                          <input type="checkbox" id={`high-${part.key}`} disabled={pl} checked={!!high[part.key]} onChange={(e) => setHigh({ ...high, [part.key]: e.target.checked })} /> {HIGH_PART_TICK}
                        </label>
                      ) : null;
                    })()}
                    <label className={`flex items-center gap-1 ${on ? "text-sky-200" : "text-slate-600"}`}>
                      <input type="checkbox" disabled={!on || pl} checked={free} onChange={(e) => set({ [part.price]: e.target.checked ? "0" : "" } as Partial<F>)} aria-label={`${part.title}: free`} /> Free
                    </label>
                  </span>
                </div>
              </div>
            );
          })}
          <p className="text-xs text-slate-500" data-parts-help="">{/* (Owner, Oct 31, batch 35 §28) */}Prices can include cents, like 9.99. Free makes a part unpaid. Otherwise $1 to $1,000 for the written answers or a recording, and $10 to $200 an hour for a live call (each call request sets its own length). A written or recording price over $200 needs a tick.</p>
          {note("parts")}
        </fieldset>
        {f.written && (
          <div id="questions-group" data-locked={fieldLocked("questions") ? "" : undefined} className={`scroll-mt-24 rounded-xl data-[marked]:ring-2 data-[marked]:ring-sky-300 ${lockedKey("questions") ? "p-2 ring-1 ring-rose-400" : ""}`}>
            <label className="label req" htmlFor="questions">Your questions (one per line){left("questions")}{draftMark("questions")}</label>
            <textarea id="questions" rows={4} disabled={fieldLocked("questions")} className="input" data-red-msg={!f.written ? undefined /* (batch 35 §24) the written part off: no question checks */ : f.questions.split("\n").some((q) => q.trim().length > LIMITS.question) ? QUESTION_TOO_LONG : duplicateQuestion(f.questions.split("\n")) ? duplicateQuestionLine(duplicateQuestion(f.questions.split("\n"))) : undefined} value={f.questions} onChange={(e) => set({ questions: capQuestions(e.target.value) })} placeholder={"What did you like?\nWhere did you get stuck?"} />
            {f.questions.split("\n").map((q) => q.trim()).filter(Boolean).length > 0 && (
              <ul className="mt-2 space-y-1">
                {f.questions.split("\n").map((q) => q.trim()).filter(Boolean).map((q) => (
                  <li key={q} className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm">
                    {/* (Batch 15 sections 3 and 32) A long question in a scroll box; its counter, and the red message at the field when it's over. */}
                    <span className="min-w-0 flex-1 text-ink-200">
                      <ScrollText text={q} label="Question" />
                      <span className={`whitespace-nowrap text-xs ${q.length > LIMITS.question ? "text-rose-300" : "text-slate-500"}`} data-question-count="">{counterText(q.length, LIMITS.question)}</span>
                      {q.length > LIMITS.question && <span className="err-field block" data-question-red="">{QUESTION_TOO_LONG}</span>}
                    </span>
                    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-ink-300">
                      {/* (Batch 26 section 14) Off by default: a question is required only when ticked. */}
                      <input type="checkbox" disabled={fieldLocked("questions")} checked={f.requiredQs.includes(q)} onChange={(e) => set({ requiredQs: e.target.checked ? [...f.requiredQs, q] : f.requiredQs.filter((x) => x !== q) })} data-required-tick="" /> Required
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {/* (Owner, Oct 28, batch 20 section 2) At 20 questions a notice under the last one (not a mistake: not red, Save and Post still work; the server still
                refuses more than 20). Deleting a question removes it. */}
            <p className="mt-1 text-xs text-slate-400" data-questions-rule="">{QUESTIONS_RULE_LINE}</p>
            {questionLimitLine(f.questions) && <p className="mt-1 text-xs text-sky-200" data-question-limit="" role="status">{questionLimitLine(f.questions)}</p>}
            {lockNote("questions")}
            {note("questions")}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Who and how long</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            {text("spots", "Number of tester spots", { req: true, type: "number", cls: "max-w-[8rem]", hint: `1–${limit}`, attrs: { "data-min": "1", min: "1", step: "1", inputMode: "numeric", "data-max": String(limit), "data-whole": "", "data-msg": `Spots must be a whole number from 1 to ${limit}.`, "data-max-msg": spotsLine } })}
            <p className="mt-1 text-xs text-slate-500" data-spots-line="">{spotsLine}</p>
          </div>
          <div>
            {text("openUntil", "Open until (last day to join)", { req: true, type: "date", cls: "max-w-[12rem]", hint: edit?.capDay ? openUntilCapHint(edit.capDay) : edit ? "only later, up to 30 days from today" : "3 to 30 days from today", attrs: { min: minOpen, max: capMax, "data-msg": edit ? "Open until must be a date in the future." : OPEN_UNTIL_RANGE, "data-max-msg": edit?.capDay ? openUntilCapLine(edit.capDay) : OPEN_UNTIL_MAX_LINE, "data-required-msg": OPEN_UNTIL_RANGE, ...(showOn("openUntil") && ouLine ? { "data-red-msg": ouLine } : {}) }, below: showOn("openUntil") ? redLine(ouLine) : null /* (batch 35 §30) once, at the box */ })}
            {/* (Owner, Oct 28, batch 19 section 8) Live: testers join until this date, each gets N days from joining (Edit: their days now + the extension, batch 16
                section 16; Post: today to this date), so the last work can arrive Open until + N; then the 7 days to pay. */}
            {f.openUntil && /^\d{4}-\d{2}-\d{2}$/.test(f.openUntil) && (edit?.testerDays != null
              ? <p className="mt-1 text-xs text-slate-400" data-tester-days="">{openUntilLine(f.openUntil, edit.testerDays + Math.max(0, daysBetween(base.openUntil.slice(0, 10), f.openUntil)))}</p>
              : daysBetween(localToday(), f.openUntil) > 0 && <p className="mt-1 text-xs text-slate-400" data-tester-days="">{openUntilLine(f.openUntil, daysBetween(localToday(), f.openUntil))}</p>)}
          </div>
        </div>
        {edit && testersIn > 0 && <p className="note">{testersIn} tester{testersIn === 1 ? " is" : "s are"} in: spots can&apos;t go below that.</p>}
        <div>
          <label className="label" htmlFor="joinMode">How testers join{!perks && <> <span className="text-xs font-normal text-slate-400">Approved only:</span> <SubscribersTag /></>}{draftMark("joinMode")}</label>
          <select id="joinMode" className="input max-w-xs" value={f.joinMode} onChange={(e) => set({ joinMode: e.target.value })}>
            <option value="anyone">Anyone can join (they press Join)</option>
            <option value="apply">Approved only (you accept or decline)</option>
            <option value="invite">Invitation only</option>
          </select>
          {note("joinMode")}
        </div>
      </div>

      <div className="panel">
        <h2>Optional</h2>
        {/* (Owner, Oct 29, batch 13 section 5) The NDA in its own card, as in the full app; the Switch / Keep offer stays; (batch 34 §15) no change limit on the NDA. */}
        <section className="space-y-3 rounded-xl border border-white/10 p-3" data-nda-card="">
          <h3 className="flex items-center gap-2 font-semibold text-white"><ShieldCheck className="h-5 w-5 text-emerald-300" /> <label htmlFor="ndaText">Keep it confidential? (NDA, optional)</label>{draftMark("ndaText")}</h3>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-400">
            <li>An NDA stops testers sharing your build or what they saw. They must accept it before joining.</li>
            <li>With or without one, <strong className="text-slate-200">you can always use the feedback you receive</strong> to improve your product.</li>
            <li>Testers can never show work from a test under an NDA as excerpts on their profile; without one, they can only with your permission.</li>
          </ul>
          {/* (Batch 13 section 9) 1,000 characters; an older, longer NDA stays as it is until a Save changes it. */}
          <textarea id="ndaText" rows={4} className={"input" + (f.ndaText.length > LIMITS.nda && f.ndaText !== base.ndaText ? " field-bad" : "")} data-red-msg={f.ndaText.length > LIMITS.nda && f.ndaText !== base.ndaText ? NDA_TOO_LONG : undefined} value={f.ndaText} onChange={(e) => set({ ndaText: e.target.value })} placeholder="Leave blank for no NDA. If filled, testers must accept it before joining." />
          <p className={`text-right text-xs ${f.ndaText.length > LIMITS.nda && f.ndaText !== base.ndaText ? "text-rose-300" : "text-slate-500"}`} data-nda-count="">{f.ndaText.length.toLocaleString("en-US")} / {LIMITS.nda.toLocaleString("en-US")}</p>
          {note("ndaText")}
        </section>
        {edit ? (
          <KeyBoxes data={keysData} typed={keysText} onType={(t) => setKeysText(t)} onBlur={() => leave("keys")} openSpots={openN} line={keysBad ? keyLine : ""} warnings={fb.warnings} note={note("keys")} />
        ) : (
          <div>
            <label className="label" htmlFor="accessKeys">Access keys (one per line; each joining tester gets one){keysDraft}</label>
            <textarea id="accessKeys" rows={3} className={"input font-mono" + (keysBad ? " field-bad" : "")} data-red-msg={keysBad ? keyLine : undefined} value={keysText} onBlur={() => leave("keys")} onChange={(e) => setKeysText(e.target.value)} placeholder={"KEY-1111\nKEY-2222"} />
            <p className="mt-1 text-xs text-slate-500">Optional. With keys, there must be at least as many keys as spots.</p>
            {keysBad && redLine(keyLine)}
          </div>
        )}
        {edit && keysDraft}
      </div>

      <div className="space-y-2">
        {edit && edit.testersIn > 0 && <p className="note">Testers already working keep their contract; each is offered these new terms and can switch. Work they&apos;ve already sent keeps its price.</p>}
        {/* (Owner, Oct 28) Above the button: "Fix the N mistakes above…". (Batch 16 section 10) One linked bullet per field red right now, read from the
            fields themselves, so the list and the fields always agree; then any server mistake that belongs to no field. */}
        {!edit && !hasCard && <p className="note" data-card-needed="">Posting needs a card in Payments. <a className="underline" href="/app/payments">Add a card</a>.</p>}
        <MistakeList press={edit ? "Save" : "Post the test"} orphans={orphans} />
        {/* (Owner, Oct 28, batch 19 section 7) Required, just above the button: on Post (and a draft's Post) always; on Edit only while Save is enabled. Unticked, the
            server refuses the press with its red line at the tick. */}
        {/* (Owner, Oct 28, batch 20 section 21) The updated-Terms tick (only while the account hasn't agreed to the current version), then the Charge tick. */}
        {termsAsk && !edit && <TermsAgainBox agreed={agreeTerms} onAgree={setAgreeTerms} />}
        {!nothingChanged && (
          <div data-note-after="" data-pay-rules-tick="">
            <label className="flex max-w-xl items-start gap-2 text-sm text-ink-200">
              <input type="checkbox" id="payRulesOk" className="mt-1" checked={payTick} onChange={(e) => setPayTick(e.target.checked)} data-match="^Tick to confirm you understand how payments work" />
              <span>{PAY_RULES_TICK} <a href={PAYMENTS_TERMS_HREF} target="_blank" rel="noreferrer">{PAY_RULES_LINK}</a></span>
            </label>
          </div>
        )}
        <div className="flex flex-wrap items-center">
          {/* (Batch 20 section 22) Unchanged: visibly greyed (the app's disabled style), with its tooltip. */}
          <button className={`btn ${nothingChanged ? "!bg-white/10 !text-ink-400 !shadow-none" : ""}`} disabled={busy || nothingChanged} aria-disabled={nothingChanged} title={nothingChanged ? "Nothing has changed yet" : undefined} data-save-idle={nothingChanged ? "" : undefined}>{busy ? "Saving…" : edit ? "Save" : "Post the test"}</button>
          {/* (Batch 20 section 22) What the kept draft means here: Edit's typed changes aren't saved yet; Post's draft isn't posted yet. */}
          {keep.restored && draftKeys.length === 0 && !keysDraft && <NotSentTag label={edit ? "Not saved yet" : "Not posted yet"} />}
          {/* (Batch 35 §8) After signing in, with fields still marked Draft: the whole form back to the saved values. */}
          {(draftKeys.length > 0 || !!keysDraft) && <button type="button" className="ml-3 text-sm text-sky-300 underline" data-use-saved-all="" onClick={isNew ? discardAll : putAllSaved}>{isNew ? START_EMPTY_LABEL : USE_SAVED_ALL_LABEL}</button>}
        </div>
        {saved && <p className="ok">{saved}</p>}
        {/* (Batch 30 §9) The line names the change (the field name scrolls to it, marked) with Put it back beside it; then the other changes save. */}
        {locked && pressed && lockedNow.map((c) => {
          const items = lockedItems(c);
          if (!items.length) return <p key={c} className="err-field" role="alert" data-critical-limit={c}>{criticalLine(c)}</p>;
          const p = lockedChangeParts(c, items);
          return (
            <p key={c} className="err-field flex flex-wrap items-center gap-x-2" role="alert" data-critical-limit={c} data-locked-change={lockedChangeLine(c, items)}>
              <span>{p.head}{p.items.map((i) => <span key={i.key}>{i.sep}the <a href={`#${i.key}`} onClick={(e) => { e.preventDefault(); jumpField(i.key); }}>{i.name}</a>{i.value}</span>)}{p.tail}</span>
              <button type="button" className="btn-ghost !px-2 !py-0.5 text-xs" data-put-back={c} onClick={() => putBack(items.map((i) => i.key))}>Put it back</button>
            </p>
          );
        })}
        <Err text={refusal} />
        {refusal.includes("Add a card in Payments before posting") && <p className="text-sm"><a className="underline" href="/app/payments">Open Payments</a></p>}
        {draft && (
          <ConfirmButton className="btn-secondary px-3 py-1.5 text-sm text-rose-200" title="Delete this draft?" confirmLabel="Delete the draft"
            body={<p>The draft and its details are deleted. Nobody has joined it, so nothing else changes. This can&apos;t be undone.</p>}
            onConfirm={() => void api(`/api/tests/${draft.id}/delete-draft`, {}).then(async () => { await keep.clear(); window.location.href = "/app"; }).catch((e) => setRefusal((e as Error).message))}>
            Delete the draft
          </ConfirmButton>
        )}
        <ChangesBox changes={changes} detail={stopDetail} tail={listingEdited ? "Press Save again to save your changes (fields you didn't touch keep the newer values)." : "Press Save again to save."} />
      </div>
    </form>
  );
}
