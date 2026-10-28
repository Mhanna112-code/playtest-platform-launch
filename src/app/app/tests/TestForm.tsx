"use client";
import { SubscribersTag } from "@/components/SubscribeLink";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { Err } from "@/components/Err";
import { mergeChanges, useLiveAppend } from "@/lib/live";
import { NOT_REQUIRED, qOptional, qText } from "@/lib/questions";
import { limitHint } from "@/lib/capacity";
import { useLocalMin } from "@/components/FieldChecks";
import { Choices } from "@/components/Choices";
import { api, ApiError, isFieldError } from "@/lib/client";
import { NotSentTag, useKept } from "@/lib/useKept";
import { CATEGORIES, DEVICES, LANGUAGES } from "@/lib/options";
import { LIMITS, changesLeftLine, counterOf, countersOf, countsOf, criticalLine, type CriticalCounts, type CriticalField } from "@/lib/limits";
import { keyNeedLine, parseKeys, tickedInUseLine } from "@/lib/keys";
import { HIGH_PART_CENTS, HIGH_PART_TICK, QUESTION_TOO_LONG, counterText, type Listing } from "@/lib/rules";
import { ScrollText } from "@/components/ScrollText";
import { toCents } from "@/lib/format";
import { KeyBoxes, type KeysData } from "./KeyBoxes";
import { ExpandNote } from "@/components/ExpandNote";
import { NdaBox } from "@/components/NdaBox";
import { ShieldCheck } from "lucide-react";
import { ConfirmButton } from "@/components/ConfirmButton";

// Post and Edit share this form. Prices are typed in dollars ("7.50"; "0" for free). Edit sends only the fields the
// user touched plus the version it loaded; if the test changed since, Save stops once and lists what changed.

type F = {
  productName: string; title: string; description: string; buildUrl: string; categories: string[]; devices: string[]; languages: string[];
  mature: boolean; matureWhy: string; ndaText: string;
  spots: string; deadlineDays: string; written: boolean; writtenPrice: string; recording: boolean; recordingPrice: string;
  live: boolean; liveRate: string; liveMinutes: string; writtenRequired: boolean; recordingRequired: boolean; liveRequired: boolean; questions: string; optionalQs: string[]; openUntil: string; joinMode: string;
};

const dollars = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));
export function toForm(l: Listing): F {
  return {
    productName: l.productName ?? "", title: l.title, description: l.description, buildUrl: l.buildUrl, categories: l.categories, devices: l.devices, languages: l.languages,
    mature: !!l.mature, matureWhy: l.matureWhy ?? "", ndaText: l.ndaText ?? "",
    spots: String(l.spots), deadlineDays: String(l.deadlineDays), written: l.writtenCents != null, writtenPrice: dollars(l.writtenCents),
    recording: l.recordingCents != null, recordingPrice: dollars(l.recordingCents), live: l.liveRateCents != null,
    liveRate: dollars(l.liveRateCents), liveMinutes: String(l.liveMinutes ?? 30),
    writtenRequired: !!l.writtenRequired, recordingRequired: !!l.recordingRequired, liveRequired: !!l.liveRequired, questions: l.questions.map(qText).join("\n"), optionalQs: l.questions.filter(qOptional).map(qText),
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
    liveMinutes: null, writtenRequired: f.written && f.writtenRequired, recordingRequired: f.recording && f.recordingRequired, liveRequired: f.live && f.liveRequired, questions: f.questions.split("\n").map((q) => q.trim()).filter(Boolean).map((q) => (f.optionalQs.includes(q) ? NOT_REQUIRED + q : q)), openUntil: f.openUntil, joinMode: f.joinMode,
  };
}
// Which API fields each form field feeds.
const API_FIELDS: Record<keyof F, string[]> = {
  productName: ["productName"], title: ["title"], description: ["description"], buildUrl: ["buildUrl"], categories: ["categories"], devices: ["devices"], languages: ["languages"],
  mature: ["mature", "matureWhy"], matureWhy: ["matureWhy"], ndaText: ["ndaText"],
  spots: ["spots"], deadlineDays: ["deadlineDays"], written: ["writtenCents"], writtenPrice: ["writtenCents"], recording: ["recordingCents"],
  recordingPrice: ["recordingCents"], live: ["liveRateCents", "liveMinutes"], liveRate: ["liveRateCents"], liveMinutes: ["liveMinutes"], writtenRequired: ["writtenRequired"], recordingRequired: ["recordingRequired"], liveRequired: ["liveRequired"], questions: ["questions"], optionalQs: ["questions"], openUntil: ["openUntil"], joinMode: ["joinMode"],
};

/** What a field is called in a note ("Changed in another tab: the instructions"). */
const NAMES: Partial<Record<keyof F, string>> = {
  productName: "the product name", title: "the test title", description: "the instructions", buildUrl: "the link", categories: "the categories", devices: "the technology requirements", languages: "the language requirements",
  mature: "the Mature (18+) box", matureWhy: "the Mature (18+) note", ndaText: "the NDA", spots: "the spots", deadlineDays: "the tester deadline", openUntil: "Open until", joinMode: "who can join",
  written: "the written report", writtenPrice: "the written report price", recording: "the recording", recordingPrice: "the recording price", live: "the live session", liveRate: "the live session rate",
  writtenRequired: "the written report Required tick", recordingRequired: "the recording Required tick", liveRequired: "the live session Required tick", questions: "the questions", optionalQs: "the questions' Not required ticks",
};
/** The note's words for a new value. */
function describe(k: keyof F, v: unknown) {
  if (typeof v === "boolean") return v ? "turned on" : "turned off";
  if (Array.isArray(v)) return v.length ? `now ${v.join(", ")}` : "now none";
  const s = String(v ?? "");
  if (!s) return "now empty";
  if (k === "writtenPrice" || k === "recordingPrice" || k === "liveRate") return `now $${s}`;
  return `now: ${s}`;
}
// Where each form field's note shows (parts and prices share one place).
const NOTE_AT: Partial<Record<keyof F, string>> = { written: "parts", writtenPrice: "parts", recording: "parts", recordingPrice: "parts", live: "parts", liveRate: "parts", writtenRequired: "parts", recordingRequired: "parts", liveRequired: "parts", questions: "questions", optionalQs: "questions" };

// The parts, as the full app's Parts and prices cards (prices-widget.tsx there), with lean's names and price limits.
const PARTS = [
  { on: "written", req: "writtenRequired", price: "writtenPrice", title: "Written report", help: "Answers to your questions", ph: "10.00", unit: "", min: "1", max: "1000", key: "written", msg: "The written answers price must be from $1.00 to $1,000.00 (or Free)." },
  { on: "recording", req: "recordingRequired", price: "recordingPrice", title: "Recorded session", help: "Screen recording, thinking out loud", ph: "15.00", unit: "", min: "1", max: "1000", key: "recording", msg: "The recording price must be from $1.00 to $1,000.00 (or Free)." },
  { on: "live", req: "liveRequired", price: "liveRate", title: "Live session", help: "A call while you watch, billed by the minute", ph: "30.00", unit: "/h", min: "10", max: "200", key: "", msg: "The live call rate must be from $10 to $200 an hour (or Free)." },
] as const;

type EditProps = {
  id: string; version: number; testersIn: number; draft: boolean; seenAt?: string;
  /** The access keys now (Edit's In use / Free boxes). */
  keys: KeysData;
  /** (Owner, Oct 28 afternoon) Per limited field, the Saves that changed it since the first tester joined; and whether any tester has joined yet. */
  criticalCounts: CriticalCounts; everJoined: boolean;
  /** When the test opened (the deadline must leave 3 days inside Open until from here). */
  openedAt: string;
};

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** (Owner, Oct 28 evening) `draft`: a draft (a next round not opened yet) shown in Post a test: Post opens it for testers, and it can be deleted here. */
export function TestForm({ init, edit, spotsLimit, draft, perks = true }: { init: Listing; edit?: EditProps; spotsLimit?: number; draft?: { id: string }; /** (Batch 8) false on the free plan: "Subscribers" on Approved-only */ perks?: boolean }) {
  const [f, setF] = useState<F>(toForm(init));
  // What this tab last knew the test to be (Edit): fields that differ from it are "changed" (Save is faded when none are).
  const [base, setBase] = useState<F>(toForm(init));
  const [touched, setTouched] = useState<Set<keyof F>>(new Set());
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<string[]>([]);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [listingEdited, setListingEdited] = useState(false);
  // (Owner) When the box last updated: the next Save goes ahead only if nothing new happened since.
  const [boxAt, setBoxAt] = useState("");
  const [version, setVersion] = useState(edit?.version ?? 0);
  // (Owner, Oct 28) Each field's "Changes left: N of 3" follows another tab's Save live.
  const [critCounts, setCritCounts] = useState<CriticalCounts>(edit?.criticalCounts ?? countsOf({}));
  const [everJoined, setEverJoined] = useState(edit?.everJoined ?? false);
  const [critical, setCritical] = useState<string[]>([]);
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
  // Keys: Post types them one per line; Edit adds new ones and ticks free ones to remove (applied on top of the newest keys).
  const [keysText, setKeysText] = useState("");
  const [keysRemove, setKeysRemove] = useState<string[]>([]);
  const [keysData, setKeysData] = useState<KeysData | null>(edit?.keys ?? null);
  // Fields the user has left (cross-field mistakes show then) and whether Save was pressed.
  const [blurred, setBlurred] = useState<Set<string>>(new Set());
  const [pressed, setPressed] = useState(false);
  // (Design doc 5) Notes under each field changed in another tab or device: { field: { at, text } }.
  const [notes, setNotes] = useState<Record<string, { at: string; lines: string[] }>>({});
  // (NEXT-UI 10) The form typed and not sent is kept on the server ("Not sent yet"), for Post and for each Edit.
  const keep = useKept(edit ? `test:edit:${edit.id}` : draft ? `test:draft:${draft.id}` : "test:new", { f, touched: [...touched], keysText }, touched.size === 0 && !keysText, (v) => {
    setF({ ...toForm(init), ...v.f });
    setTouched(new Set(v.touched));
    if (v.keysText) setKeysText(v.keysText);
  });
  const set = (p: Partial<F>) => {
    setF((o) => ({ ...o, ...p }));
    setTouched((t) => new Set([...t, ...(Object.keys(p) as (keyof F)[])]));
    setSaved("");
  };
  const leave = (k: string) => setBlurred((b) => (b.has(k) ? b : new Set([...b, k])));

  // What differs from what this tab knows (Edit): the Save button is faded when nothing does.
  const changedKeys = useMemo(() => (edit ? (Object.keys(f) as (keyof F)[]).filter((k) => JSON.stringify(f[k]) !== JSON.stringify(base[k])) : []), [f, base, edit]);
  const keysChanged = parseKeys(keysText).length > 0 || keysRemove.length > 0;
  const nothingChanged = !!edit && changedKeys.length === 0 && !keysChanged;
  // (Owner, Oct 28 afternoon) Once a tester has joined, each limited field (the steps, the NDA, questions, required languages, required devices) has its OWN 3 changes (one Save that
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

  // (Owner, Oct 29, batch 12 section 6) No "days after joining" field: Open until is required and is every tester's deadline (3 to 30 days from today on Post).
  const dlLine = "";
  // (5) Open until can only be extended.
  const ouNow = init.openUntil ? init.openUntil.slice(0, 10) : "";
  const shortened = !!edit && !!ouNow && !!f.openUntil && f.openUntil < base.openUntil && f.openUntil < ouNow;
  const ouLine = shortened ? `Open until can only be extended: it's ${new Date(base.openUntil + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} now.` : "";
  // Keys: every open spot needs a free key.
  const spotsN = Number(f.spots);
  const freeAfter = edit ? (keysData?.free.filter((k) => !keysRemove.includes(k.value)).length ?? 0) + parseKeys(keysText).filter((v) => !keysData?.free.some((k) => k.value === v)).length : parseKeys(keysText).length;
  // The working testers follow the test live (testers joining while Edit is open take open spots and free keys).
  const testersIn = edit ? (keysData?.testersIn ?? edit.testersIn) : 0;
  const openN = edit ? Math.max(0, spotsN - testersIn) : spotsN;
  const usesKeys = edit ? (keysData?.uses ?? false) || parseKeys(keysText).length > 0 : parseKeys(keysText).length > 0;
  // A key ticked for removal that a joining tester was given meanwhile is red (it can't be removed), never dropped silently.
  const tickedInUse = edit ? keysRemove.filter((v) => keysData?.inUse.some((k) => k.value === v)) : [];
  const keyLine = [...tickedInUse.map(tickedInUseLine), usesKeys && Number.isInteger(spotsN) && spotsN > 0 ? keyNeedLine(openN, freeAfter) : ""].filter(Boolean).join(" ");
  const showOn = (k: string) => pressed || blurred.has(k);

  // Server mistakes by field (red at the field).
  const FIELD_WORDS: Partial<Record<keyof F, RegExp>> = {
    productName: /product name/i, title: /\btitle\b/i, description: /what to do|what testers should do|instructions/i, matureWhy: /mature/i, ndaText: /\bNDA\b/, writtenPrice: /written answers price/i, recordingPrice: /recording price/i, liveRate: /live call rate/i, liveMinutes: /call lasts/i,
    spots: /spots|testers per test/i, deadlineDays: /deadline/i, openUntil: /open until/i, buildUrl: /build link/i, categories: /category/i,
  };
  const bad = (k: keyof F) => lockedKey(k) || (!!FIELD_WORDS[k] && errs.some((e) => FIELD_WORDS[k]!.test(e))) || (k === "openUntil" && showOn("openUntil") && (!!dlLine || !!ouLine)) || (k === "deadlineDays" && showOn("deadlineDays") && !!dlLine);
  const keysBad = (showOn("keys") || pressed) && !!keyLine;

  /** Apply what another tab or device saved: the fields it changed take its value here; the others stay as typed. */
  function applyElsewhere(listing: Listing, at: string, keys: { free: string[] } | null) {
    const now = toForm(listing);
    const fresh: Record<string, { at: string; lines: string[] }> = {};
    const takeover: Partial<F> = {};
    for (const k of Object.keys(now) as (keyof F)[]) {
      if (JSON.stringify(now[k]) === JSON.stringify(base[k])) continue;
      const mine = JSON.stringify(f[k]) !== JSON.stringify(base[k]);
      (takeover as Record<string, unknown>)[k] = now[k];
      const where = NOTE_AT[k] ?? k;
      const line = `${NAMES[k] ?? k}: ${describe(k, now[k])}${mine && JSON.stringify(f[k]) !== JSON.stringify(now[k]) ? ` (you had typed ${Array.isArray(f[k]) ? (f[k] as string[]).join(", ") : String(f[k]).slice(0, 80)}; the newer value is kept)` : ""}`;
      fresh[where] = { at, lines: [...(fresh[where]?.lines ?? []), line] };
    }
    if (keys && keysData) {
      const before = keysData.free.map((k) => k.value);
      const added = keys.free.filter((v) => !before.includes(v)), gone = before.filter((v) => !keys.free.includes(v));
      if (added.length || gone.length) fresh.keys = { at, lines: [...(added.length ? [`added ${added.length} free key${added.length === 1 ? "" : "s"}: ${added.join(", ")}`] : []), ...(gone.length ? [`${gone.length} key${gone.length === 1 ? " is" : "s are"} no longer free: ${gone.join(", ")}`] : [])] };
    }
    if (!Object.keys(fresh).length) return;
    setF((o) => ({ ...o, ...takeover }));
    setBase((o) => ({ ...o, ...takeover }));
    setTouched((t) => new Set([...t].filter((k) => !(k in takeover))));
    setNotes((n) => ({ ...n, ...fresh }));
  }

  // (Design doc 5) While Edit is open, what other tabs and devices save shows up here, live: the field takes the new value
  // and a blue note under it says what changed; the In use / Free boxes follow too.
  const versionRef = useRef(version);
  versionRef.current = version;
  const live = useRef({ applyElsewhere, f, base, keysData });
  live.current = { applyElsewhere, f, base, keysData };
  useEffect(() => {
    if (!edit) return;
    let alive = true;
    const tick = async () => {
      const r = await api<{ version: number; listing: Listing; keys: KeysData; at: string; criticalCounts?: CriticalCounts; everJoined?: boolean }>(`/api/tests/${edit.id}/listing`).catch(() => null);
      if (!r || !alive) return;
      if (r.criticalCounts) setCritCounts(countsOf(r.criticalCounts));
      if (typeof r.everJoined === "boolean") setEverJoined(r.everJoined);
      if (r.version !== versionRef.current) {
        live.current.applyElsewhere(r.listing, r.at, { free: r.keys.free.map((k) => k.value) });
        setVersion(r.version);
      }
      setKeysData(r.keys);
    };
    const t = setInterval(tick, 20_000);
    const onTick = () => void tick();
    window.addEventListener("live-tick", onTick);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("live-tick", onTick);
    };
  }, [edit]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (nothingChanged) return;
    setPressed(true);
    if (locked) return;
    setBusy(true);
    setErrs([]);
    setCritical([]);
    setRefusal("");
    try {
      if (!edit) {
        const r = await api<{ id: string }>(draft ? `/api/tests/${draft.id}/post-draft` : "/api/tests", { ...toApi(f), accessKeys: keysText, confirmHigh: confirmHigh() });
        await keep.clear();
        window.location.href = `/app/tests/${r.id}`;
        return;
      }
      const all = toApi(f);
      const fields: Record<string, unknown> = {};
      for (const k of touched) for (const a of API_FIELDS[k]) fields[a] = all[a];
      const r = await api<{ offered: number; notReinvited?: string[]; resent?: string[]; closedApps?: string[]; spotClosed?: string[]; spots?: number }>(`/api/tests/${edit.id}/edit`, {
        version, fields, confirmHigh: confirmHigh(), seenAt: edit.seenAt, confirmed: changes != null, ...(changes != null && boxAt ? { boxAt } : {}),
        keysAdd: parseKeys(keysText), keysRemove,
      });
      await keep.clear();
      const q = (k: string, v?: string[]) => (v?.length ? `&${k}=${encodeURIComponent(v.join(", "))}` : "");
      window.location.href = `/app/tests/${edit.id}?saved=1&offered=${r.offered ?? 0}${q("closed", r.closedApps)}${q("resent", r.resent)}${q("skipped", r.notReinvited)}${r.spotClosed?.length ? `${q("spotclosed", r.spotClosed)}&spots=${r.spots}` : ""}`;
    } catch (err) {
      if (err instanceof ApiError && err.code === "changed") {
        // The blue stop (what changed since Edit opened), and any red mistakes with it. Fields saved elsewhere take their new value here.
        setChanges((c) => (c ? mergeChanges(c, (err.data.changes as Change[]) ?? []) : (err.data.changes as Change[])));
        if (typeof err.data.now === "string") setBoxAt(err.data.now);
        setListingEdited(err.data.listingEdited === true);
        setErrs(Array.isArray(err.data.errors) ? (err.data.errors as string[]) : []);
        if (typeof err.data.version === "number") setVersion(err.data.version);
        if (err.data.criticalCounts) setCritCounts(countsOf(err.data.criticalCounts));
        // The In use / Free boxes and the open spots follow at once (not at the next 20-second refresh).
        if (edit) void api<{ keys: KeysData }>(`/api/tests/${edit.id}/listing`).then((r) => setKeysData(r.keys)).catch(() => null);
        if (err.data.current) applyElsewhere(err.data.current as Listing, typeof err.data.now === "string" ? err.data.now : new Date().toISOString(), err.data.keys ? { free: (err.data.keys as { free: string[] }).free } : null);
      }
      else if (err instanceof ApiError && !isFieldError(err)) {
        // A refusal (e.g. "Confirm your email first."): blue, under the button.
        setChanges(null);
        setRefusal(err.message);
      } else {
        setChanges(null);
        setErrs(err instanceof ApiError && Array.isArray(err.data.errors) ? (err.data.errors as string[]) : [(err as Error).message]);
        if (err instanceof ApiError && Array.isArray(err.data.critical)) setCritical(err.data.critical as string[]);
        if (err instanceof ApiError && err.data.criticalCounts) setCritCounts(countsOf(err.data.criticalCounts));
      }
    } finally {
      setBusy(false);
    }
  }

  // (Owner) Every box with a range says it next to it and is checked as soon as it's left (FieldChecks).
  const text = (k: keyof F, label: string, opts: { req?: boolean; ph?: string; type?: string; cls?: string; attrs?: Record<string, string>; hint?: string; max?: number; disabled?: boolean; after?: React.ReactNode } = {}) => (
    <div>
      <label className={"label" + (opts.req ? " req" : "")} htmlFor={k}>{label}{opts.after}</label>
      <div className="flex flex-wrap items-center gap-2">
        <input id={k} type={opts.type ?? "text"} disabled={opts.disabled} className={"input " + (opts.cls ?? "") + (bad(k) ? " field-bad" : "")} placeholder={opts.ph} value={f[k] as string} maxLength={opts.max}
          onChange={(e) => set({ [k]: e.target.value } as Partial<F>)} onBlur={() => leave(k)} {...(opts.req ? { "data-required": "" } : {})} {...opts.attrs} />
        {opts.hint && <span className="text-xs text-slate-500">{opts.hint}</span>}
        {opts.max && <span className="ml-auto text-xs text-slate-500" aria-hidden>{(f[k] as string).length}/{opts.max}</span>}
      </div>
      {note(k)}
    </div>
  );
  /** The blue note under a field changed in another tab or device (an expand arrow only when it runs over two lines). */
  const note = (k: string) => {
    const n = notes[k];
    if (!n) return null;
    return <ExpandNote key={n.at + n.lines.join()} label={`Changed in another tab or device at ${clock(n.at)}`} lines={n.lines} />;
  };
  const tomorrow = useLocalMin(24 * 60, true), in3 = useLocalMin(3 * 24 * 60, true), monthOut = useLocalMin(30 * 24 * 60, true);
  const minOpen = edit ? tomorrow : in3;
  const limit = spotsLimit ?? LIMITS.spots.max;
  const redLine = (t: string) => (t ? <p className="err-field mt-1" role="alert">{t}</p> : null);
  const hasMore = errs.length > 0 || critical.length > 0;

  return (
    <form className="space-y-4" onSubmit={submit} {...(edit ? { "data-red-and-blue": "" } : {})} noValidate>
      <p className="note"><span className="text-punch-400">*</span> marks the fields you have to fill in.</p>
      <div className="panel">
        <h2>What are testers trying?</h2>
        {text("productName", "Product", { req: true, ph: "Harbor Run", max: LIMITS.productName, attrs: { "data-required-msg": "Enter the product name." } })}
        {text("title", "Name of this test", { req: true, ph: "First 3 levels", max: LIMITS.testName, attrs: { "data-required-msg": "Give the test a title." } })}
        <div>
          <label className="label req" htmlFor="description">What should testers do?{left("description")}</label>
          <textarea id="description" rows={4} disabled={fieldLocked("description")} className={"input" + (bad("description") ? " field-bad" : "")} value={f.description} maxLength={LIMITS.whatToDo} data-required="" data-required-msg="Say what testers should do." onBlur={() => leave("description")} onChange={(e) => set({ description: e.target.value })} />
          <p className="mt-1 text-right text-xs text-slate-500" data-steps-count="">{f.description.length.toLocaleString("en-US")} / {LIMITS.whatToDo.toLocaleString("en-US")}</p>
          {lockNote("description")}
          {note("description")}
        </div>
        {/* (Batch 14) The build link is a limited field with its own 3 changes. */}
        {text("buildUrl", "Link to the product or build", { ph: "https://…", after: left("buildUrl"), disabled: fieldLocked("buildUrl") })}
        {lockNote("buildUrl")}
        {/* The full app's Categories: a row of tick boxes, at least one. */}
        <fieldset className={"space-y-2 " + (bad("categories") ? "rounded-xl p-2 ring-1 ring-rose-400" : "")}>
          <legend className="label req">Categories</legend>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((o) => (
              <label key={o} className="flex cursor-pointer items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-slate-300 has-[:checked]:border-indigo-400/60 has-[:checked]:bg-indigo-500/15 has-[:checked]:text-white">
                <input type="checkbox" name="categories" value={o} checked={f.categories.includes(o)} onChange={(e) => set({ categories: e.target.checked ? [...f.categories, o] : f.categories.filter((x) => x !== o) })} /> {o}
              </label>
            ))}
          </div>
          {note("categories")}
        </fieldset>
        {/* (Owner, Oct 28 afternoon) Required languages and devices are limited fields: each locks after its own 3rd change since testers joined. */}
        <fieldset disabled={fieldLocked("languages")} data-locked={fieldLocked("languages") ? "" : undefined} className={lockedKey("languages") ? "rounded-xl p-2 ring-1 ring-rose-400" : ""}>
          <Choices label="Language requirements (any one)" aside={left("languages")} options={LANGUAGES} value={f.languages} onChange={(languages) => set({ languages })} />
          {lockNote("languages")}
          {note("languages")}
        </fieldset>
        <fieldset disabled={fieldLocked("devices")} data-locked={fieldLocked("devices") ? "" : undefined} className={lockedKey("devices") ? "rounded-xl p-2 ring-1 ring-rose-400" : ""}>
          <Choices label="Technology requirements: devices, platforms or skills (any one; none ticked = any)" aside={left("devices")} options={DEVICES} value={f.devices} onChange={(devices) => set({ devices })} />
          {lockNote("devices")}
          {note("devices")}
        </fieldset>
        {/* (4) Mature (18+): ticking it shows the required "why" at once. */}
        <div className="space-y-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink-200">
            <input type="checkbox" checked={f.mature} onChange={(e) => set({ mature: e.target.checked })} /> Mature (18+) content
          </label>
          <p className="text-xs text-slate-500">Tick this if your test has mature content: saying why is required. No graphic content: no sexual content involving minors, no illegal content, no real-world gore. Graphic content must be marked Mature.</p>
          {f.mature && (
            <div>
              <label className="label req" htmlFor="matureWhy">Why is this test mature?</label>
              <textarea id="matureWhy" rows={2} className={"input" + (bad("matureWhy") ? " field-bad" : "")} maxLength={LIMITS.matureWhy} value={f.matureWhy} placeholder="e.g. Violence in the boss fights; testers must be 18 or older"
                data-required="" data-required-msg="Say why this test is mature (18+): it's required for mature content." onBlur={() => leave("matureWhy")} onChange={(e) => set({ matureWhy: e.target.value })} />
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
        <fieldset className="space-y-2">
          {/* (Batch 14) Parts and prices: ONE limited counter for the part ticks, prices, Required and Free ticks, the live rate and call length. */}
          <legend className="label req">Parts and prices{left("parts")}</legend>
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
                      <input id={part.price} className={"input w-24 py-1" + (bad(part.price) ? " field-bad" : "")} inputMode="decimal" disabled={!on || free || pl} placeholder={part.ph} value={free ? "" : price}
                        onChange={(e) => set({ [part.price]: e.target.value } as Partial<F>)} aria-label={`Price for the ${part.title.toLowerCase()}`}
                        data-min={part.min} data-max={part.max} data-zero-ok="" data-msg={part.msg} />
                      {part.unit}
                    </label>
                    <span className="text-xs text-slate-500">{part.min}–{Number(part.max).toLocaleString("en-US")}{part.unit}</span>
                    {part.key && on && (() => {
                      const cents = toCents(price);
                      const savedSame = !!edit && toCents(base[part.price] as string) === cents && base[part.on];
                      return cents != null && cents > HIGH_PART_CENTS && !savedSame ? (
                        <label className="flex items-center gap-1.5 text-xs text-amber-200" data-high-tick={part.key}>
                          <input type="checkbox" checked={!!high[part.key]} onChange={(e) => setHigh({ ...high, [part.key]: e.target.checked })} /> {HIGH_PART_TICK}
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
          <p className="text-xs text-slate-500">Any cents. Free makes a part unpaid. Otherwise $1 to $1,000 for the written answers or a recording, and $10 to $200 an hour for a live call (each call request sets its own length). A written or recording price over $200 needs a tick.</p>
          {note("parts")}
        </fieldset>
        {f.written && (
          <div className={lockedKey("questions") ? "rounded-xl p-2 ring-1 ring-rose-400" : ""}>
            <label className="label req" htmlFor="questions">Your questions (one per line){left("questions")}</label>
            <textarea id="questions" rows={4} disabled={fieldLocked("questions")} className="input" value={f.questions} onChange={(e) => set({ questions: e.target.value })} placeholder={"What did you like?\nWhere did you get stuck?"} />
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
                      <input type="checkbox" disabled={fieldLocked("questions")} checked={f.optionalQs.includes(q)} onChange={(e) => set({ optionalQs: e.target.checked ? [...f.optionalQs, q] : f.optionalQs.filter((x) => x !== q) })} /> Not required
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {lockNote("questions")}
            {note("questions")}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Who and how long</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            {text("spots", "Number of tester spots", { req: true, type: "number", cls: "max-w-[8rem]", hint: `1–${limit}`, attrs: { "data-min": "1", "data-max": String(limit), "data-whole": "", "data-msg": spotsLimit != null ? `You can take up to ${limit} testers per test right now.` : `Spots must be a whole number from 1 to ${limit}.` } })}
            {spotsLimit != null && <p className="mt-1 text-xs text-slate-500">{limitHint(spotsLimit)}</p>}
          </div>
          <div>
            {text("openUntil", "Open until (every tester's deadline)", { req: true, type: "date", cls: "max-w-[12rem]", hint: edit ? "only later, up to 30 days from today" : "3 to 30 days from today", attrs: { min: minOpen, max: monthOut, "data-msg": edit ? "Open until must be a date in the future." : "Set Open until 3 to 30 days from today: it's every tester's deadline too.", "data-max-msg": "Open until can be at most 30 days from today." } })}
            {showOn("openUntil") && redLine(ouLine)}
          </div>
        </div>
        {edit && testersIn > 0 && <p className="note">{testersIn} tester{testersIn === 1 ? " is" : "s are"} in: spots can&apos;t go below that.</p>}
        <div>
          <label className="label" htmlFor="joinMode">How testers join{!perks && <> <span className="text-xs font-normal text-slate-400">Approved only:</span> <SubscribersTag /></>}</label>
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
        {/* (Owner, Oct 29, batch 13 section 5) The NDA in its own card, as in the full app; the 3-change limit and the Switch / Keep offer stay. */}
        <section className="space-y-3 rounded-xl border border-white/10 p-3" data-nda-card="">
          <h3 className="flex items-center gap-2 font-semibold text-white"><ShieldCheck className="h-5 w-5 text-emerald-300" /> <label htmlFor="ndaText">Keep it confidential? (NDA, optional)</label>{left("ndaText")}</h3>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-400">
            <li>An NDA stops testers sharing your build or what they saw. They must accept it before joining.</li>
            <li>With or without one, <strong className="text-slate-200">you can always use the feedback you receive</strong> to improve your product.</li>
            <li>Testers can never show work from a test under an NDA as excerpts on their profile; without one, they can only with your permission.</li>
          </ul>
          {/* (Batch 13 section 9) 1,000 characters; an older, longer NDA stays as it is until a Save changes it. */}
          <textarea id="ndaText" rows={4} disabled={fieldLocked("ndaText")} className={"input" + (f.ndaText.length > LIMITS.nda && f.ndaText !== base.ndaText ? " field-bad" : "")} value={f.ndaText} onChange={(e) => set({ ndaText: e.target.value })} placeholder="Leave blank for no NDA. If filled, testers must accept it before joining." />
          <p className={`text-right text-xs ${f.ndaText.length > LIMITS.nda && f.ndaText !== base.ndaText ? "text-rose-300" : "text-slate-500"}`} data-nda-count="">{f.ndaText.length.toLocaleString("en-US")} / {LIMITS.nda.toLocaleString("en-US")}</p>
          {f.ndaText.trim() && <NdaBox label="How testers see it" text={f.ndaText} />}
          {lockNote("ndaText")}
          {note("ndaText")}
        </section>
        {edit ? (
          <KeyBoxes data={keysData} removed={keysRemove} onRemove={(v, on) => { setKeysRemove((r) => (on ? [...r, v] : r.filter((x) => x !== v))); leave("keys"); }}
            typed={keysText} onType={(t) => setKeysText(t)} onBlur={() => leave("keys")} openSpots={openN} line={keysBad ? keyLine : ""} note={note("keys")} />
        ) : (
          <div>
            <label className="label" htmlFor="accessKeys">Access keys (one per line; each joining tester gets one)</label>
            <textarea id="accessKeys" rows={3} className={"input font-mono" + (keysBad ? " field-bad" : "")} value={keysText} onBlur={() => leave("keys")} onChange={(e) => setKeysText(e.target.value)} placeholder={"KEY-1111\nKEY-2222"} />
            <p className="mt-1 text-xs text-slate-500">Optional. With keys, there must be at least as many keys as spots.</p>
            {keysBad && redLine(keyLine)}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {edit && edit.testersIn > 0 && <p className="note">Testers already working keep their contract; each is offered these new terms and can switch. Work they&apos;ve already sent keeps its price.</p>}
        {/* (Owner, Oct 28) Above the button: "Fix the N mistakes above…". */}
        {hasMore && (
          <>
            <p className="err-field">Fix the {errs.length === 1 ? "mistake" : `${errs.length} mistakes`} above, then press {edit ? "Save" : "Post the test"} again.</p>
            <ul className="err-field list-disc pl-5">
              {errs.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </>
        )}
        <div className="flex flex-wrap items-center">
          <button className="btn" disabled={busy || nothingChanged} aria-disabled={nothingChanged} title={nothingChanged ? "Nothing has changed yet" : undefined}>{busy ? "Saving…" : edit ? "Save" : "Post the test"}</button>
          {keep.restored && <NotSentTag />}
        </div>
        {saved && <p className="ok">{saved}</p>}
        {locked && pressed && lockedNow.map((f) => <p key={f} className="err-field" role="alert" data-critical-limit={f}>{criticalLine(f)}</p>)}
        <Err text={refusal} />
        {draft && (
          <ConfirmButton className="btn-secondary px-3 py-1.5 text-sm text-rose-200" title="Delete this draft?" confirmLabel="Delete the draft"
            body={<p>The draft and its details are deleted. Nobody has joined it, so nothing else changes. This can&apos;t be undone.</p>}
            onConfirm={() => void api(`/api/tests/${draft.id}/delete-draft`, {}).then(async () => { await keep.clear(); window.location.href = "/app"; }).catch((e) => setRefusal((e as Error).message))}>
            Delete the draft
          </ConfirmButton>
        )}
        <ChangesBox changes={changes} tail={listingEdited ? "Press Save again to save your changes (fields you didn't touch keep the newer values)." : "Press Save again to save."} />
      </div>
    </form>
  );
}
