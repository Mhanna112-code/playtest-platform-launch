"use client";
import { useState } from "react";
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
import type { Listing } from "@/lib/rules";

// Post and Edit share this form. Prices are typed in dollars ("7.50"; "0" for free). Edit sends only the fields the
// user touched plus the version it loaded; if the test changed since, Save stops once and lists what changed.

type F = {
  title: string; description: string; buildUrl: string; categories: string[]; devices: string[]; languages: string[];
  spots: string; deadlineDays: string; written: boolean; writtenPrice: string; recording: boolean; recordingPrice: string;
  live: boolean; liveRate: string; liveMinutes: string; writtenRequired: boolean; recordingRequired: boolean; liveRequired: boolean; questions: string; optionalQs: string[]; openUntil: string; joinMode: string;
};

const dollars = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));
export function toForm(l: Listing): F {
  return {
    title: l.title, description: l.description, buildUrl: l.buildUrl, categories: l.categories, devices: l.devices, languages: l.languages,
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
    title: f.title, description: f.description, buildUrl: f.buildUrl, categories: f.categories, devices: f.devices, languages: f.languages,
    spots: f.spots, deadlineDays: f.deadlineDays, writtenCents: f.written ? f.writtenPrice || "" : null,
    recordingCents: f.recording ? f.recordingPrice || "" : null, liveRateCents: f.live ? f.liveRate || "" : null,
    liveMinutes: null, writtenRequired: f.written && f.writtenRequired, recordingRequired: f.recording && f.recordingRequired, liveRequired: f.live && f.liveRequired, questions: f.questions.split("\n").map((q) => q.trim()).filter(Boolean).map((q) => (f.optionalQs.includes(q) ? NOT_REQUIRED + q : q)), openUntil: f.openUntil, joinMode: f.joinMode,
  };
}
// Which API fields each form field feeds.
const API_FIELDS: Record<keyof F, string[]> = {
  title: ["title"], description: ["description"], buildUrl: ["buildUrl"], categories: ["categories"], devices: ["devices"], languages: ["languages"],
  spots: ["spots"], deadlineDays: ["deadlineDays"], written: ["writtenCents"], writtenPrice: ["writtenCents"], recording: ["recordingCents"],
  recordingPrice: ["recordingCents"], live: ["liveRateCents", "liveMinutes"], liveRate: ["liveRateCents"], liveMinutes: ["liveMinutes"], writtenRequired: ["writtenRequired"], recordingRequired: ["recordingRequired"], liveRequired: ["liveRequired"], questions: ["questions"], optionalQs: ["questions"], openUntil: ["openUntil"], joinMode: ["joinMode"],
};

// The parts, as the full app's Parts and prices cards (prices-widget.tsx there), with lean's names and price limits.
const PARTS = [
  { on: "written", req: "writtenRequired", price: "writtenPrice", title: "Written report", help: "Answers to your questions", ph: "10.00", unit: "", min: "1", max: "1000", msg: "The written answers price must be from $1.00 to $1,000.00 (or Free)." },
  { on: "recording", req: "recordingRequired", price: "recordingPrice", title: "Recorded session", help: "Screen recording, thinking out loud", ph: "15.00", unit: "", min: "1", max: "1000", msg: "The recording price must be from $1.00 to $1,000.00 (or Free)." },
  { on: "live", req: "liveRequired", price: "liveRate", title: "Live session", help: "A call while you watch, billed by the minute", ph: "30.00", unit: "/h", min: "10", max: "200", msg: "The live call rate must be from $10 to $200 an hour (or Free)." },
] as const;

export function TestForm({ init, edit, spotsLimit }: { init: Listing; edit?: { id: string; version: number; testersIn: number; draft: boolean; seenAt?: string }; spotsLimit?: number }) {
  const [f, setF] = useState<F>(toForm(init));
  const [touched, setTouched] = useState<Set<keyof F>>(new Set());
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<string[]>([]);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [listingEdited, setListingEdited] = useState(false);
  // (Owner) When the box last updated: the next Save goes ahead only if nothing new happened since.
  const [boxAt, setBoxAt] = useState("");
  useLiveAppend(changes != null, (added) => {
    setChanges((c) => (c ? mergeChanges(c, added) : c));
    const newest = added.map((a) => a.at).sort().pop();
    if (newest) setBoxAt((b) => (b && b > newest ? b : newest));
  });
  const [saved, setSaved] = useState("");
  const [refusal, setRefusal] = useState("");
  // (NEXT-UI 10) The form typed and not sent is kept on the server ("Not sent yet"), for Post and for each Edit.
  const keep = useKept(edit ? `test:edit:${edit.id}` : "test:new", { f, touched: [...touched] }, touched.size === 0, (v) => {
    setF(v.f);
    setTouched(new Set(v.touched));
  });
  const set = (p: Partial<F>) => {
    setF((o) => ({ ...o, ...p }));
    setTouched((t) => new Set([...t, ...(Object.keys(p) as (keyof F)[])]));
    setSaved("");
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrs([]);
    setRefusal("");
    try {
      if (!edit) {
        const r = await api<{ id: string }>("/api/tests", toApi(f));
        await keep.clear();
        window.location.href = `/app/tests/${r.id}`;
        return;
      }
      const all = toApi(f);
      const fields: Record<string, unknown> = {};
      for (const k of touched) for (const a of API_FIELDS[k]) fields[a] = all[a];
      const r = await api<{ offered: number; notReinvited?: string[]; resent?: string[]; closedApps?: string[]; spotClosed?: string[]; spots?: number }>(`/api/tests/${edit.id}/edit`, { version: edit.version, fields, seenAt: edit.seenAt, confirmed: changes != null, ...(changes != null && boxAt ? { boxAt } : {}) });
      await keep.clear();
      const q = (k: string, v?: string[]) => (v?.length ? `&${k}=${encodeURIComponent(v.join(", "))}` : "");
      window.location.href = `/app/tests/${edit.id}?saved=1&offered=${r.offered ?? 0}${q("closed", r.closedApps)}${q("resent", r.resent)}${q("skipped", r.notReinvited)}${r.spotClosed?.length ? `${q("spotclosed", r.spotClosed)}&spots=${r.spots}` : ""}`;
    } catch (err) {
      if (err instanceof ApiError && err.code === "changed") {
        setChanges((c) => (c ? mergeChanges(c, (err.data.changes as Change[]) ?? []) : (err.data.changes as Change[])));
        if (typeof err.data.now === "string") setBoxAt(err.data.now);
        setListingEdited(err.data.listingEdited === true);
      }
      else if (err instanceof ApiError && !isFieldError(err)) {
        // A refusal (e.g. "Confirm your email first."): blue, under the button.
        setChanges(null);
        setRefusal(err.message);
      } else {
        setChanges(null);
        setErrs(err instanceof ApiError && Array.isArray(err.data.errors) ? (err.data.errors as string[]) : [(err as Error).message]);
      }
    } finally {
      setBusy(false);
    }
  }

  // Mark the field a mistake is about (red at the field).
  const FIELD_WORDS: Partial<Record<keyof F, RegExp>> = { title: /title/i, writtenPrice: /written answers price/i, recordingPrice: /recording price/i, liveRate: /live call rate/i, liveMinutes: /call lasts/i, spots: /spots|testers per test/i, deadlineDays: /deadline/i, openUntil: /open until/i, buildUrl: /build link/i, categories: /category/i };
  const bad = (k: keyof F) => !!FIELD_WORDS[k] && errs.some((e) => FIELD_WORDS[k]!.test(e));
  // (Owner) Every box with a range says it next to it and is checked as soon as it's left (FieldChecks).
  const text = (k: keyof F, label: string, opts: { req?: boolean; ph?: string; type?: string; cls?: string; attrs?: Record<string, string>; hint?: string } = {}) => (
    <div>
      <label className={"label" + (opts.req ? " req" : "")} htmlFor={k}>{label}</label>
      <div className="flex flex-wrap items-center gap-2">
        <input id={k} type={opts.type ?? "text"} className={"input " + (opts.cls ?? "") + (bad(k) ? " field-bad" : "")} placeholder={opts.ph} value={f[k] as string} onChange={(e) => set({ [k]: e.target.value } as Partial<F>)} {...opts.attrs} />
        {opts.hint && <span className="text-xs text-slate-500">{opts.hint}</span>}
      </div>
    </div>
  );
  const tomorrow = useLocalMin(24 * 60, true), yearOut = useLocalMin(366 * 24 * 60, true);
  const limit = spotsLimit ?? 50;

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="panel">
        <h2>What are testers trying?</h2>
        {text("title", "Title", { req: true, ph: "Harbor Run: first 3 levels" })}
        <div>
          <label className="label" htmlFor="description">What to do</label>
          <textarea id="description" rows={4} className="input" value={f.description} onChange={(e) => set({ description: e.target.value })} />
        </div>
        {text("buildUrl", "Build link", { ph: "https://…" })}
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
        </fieldset>
      </div>

      <div className="panel">
        <h2>Feedback and prices</h2>
        <p className="note">Every term is fixed in each tester&apos;s contract when they join. Edits change the listing for new testers only.</p>
        {/* The full app's Parts and prices: one card per part (tick, title, what it is, Required, price, Free). Required is
            a label only (NEWEST+10): part of the terms, it blocks nothing. */}
        <fieldset className="space-y-2">
          <legend className="label req">Parts and prices</legend>
          {PARTS.map((part) => {
            const on = f[part.on] as boolean;
            const price = f[part.price] as string;
            const free = on && /^0+(\.0+)?$/.test(price.trim());
            return (
              <div key={part.on} className={`space-y-1.5 rounded-xl border p-3 text-sm ${on ? "border-indigo-400/60 bg-indigo-500/10" : "border-white/10 bg-white/[0.03]"}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <label className="flex min-w-[11rem] flex-1 cursor-pointer gap-2">
                    <input type="checkbox" checked={on} onChange={(e) => set({ [part.on]: e.target.checked } as Partial<F>)} aria-label={`Include the ${part.title.toLowerCase()}`} />
                    <span><span className="block text-white">{part.title}</span><span className="text-xs text-slate-400">{part.help}</span></span>
                  </label>
                  <label className={`flex items-center gap-1.5 ${on ? "text-slate-200" : "text-slate-600"}`}>
                    <input type="checkbox" disabled={!on} checked={on && (f[part.req] as boolean)} onChange={(e) => set({ [part.req]: e.target.checked } as Partial<F>)} aria-label={`${part.title}: required`} /> Required
                  </label>
                  <span className="flex flex-wrap items-center gap-2">
                    <label className={`flex items-center gap-1 ${free || !on ? "text-slate-600" : "text-slate-300"}`}>
                      $
                      <input id={part.price} className={"input w-24 py-1" + (bad(part.price) ? " field-bad" : "")} inputMode="decimal" disabled={!on || free} placeholder={part.ph} value={free ? "" : price}
                        onChange={(e) => set({ [part.price]: e.target.value } as Partial<F>)} aria-label={`Price for the ${part.title.toLowerCase()}`}
                        data-min={part.min} data-max={part.max} data-zero-ok="" data-msg={part.msg} />
                      {part.unit}
                    </label>
                    <label className={`flex items-center gap-1 ${on ? "text-sky-200" : "text-slate-600"}`}>
                      <input type="checkbox" disabled={!on} checked={free} onChange={(e) => set({ [part.price]: e.target.checked ? "0" : "" } as Partial<F>)} aria-label={`${part.title}: free`} /> Free
                    </label>
                  </span>
                </div>
              </div>
            );
          })}
          <p className="text-xs text-slate-500">Any cents. Free makes a part unpaid. Otherwise from $1 to $1,000 for the written answers or a recording, and from $10 to $200 an hour for a live call (each call request sets its own length).</p>
        </fieldset>
        {f.written && (
          <div>
            <label className="label req" htmlFor="questions">Your questions (one per line)</label>
            <textarea id="questions" rows={4} className="input" value={f.questions} onChange={(e) => set({ questions: e.target.value })} placeholder={"What did you like?\nWhere did you get stuck?"} />
            {f.questions.split("\n").map((q) => q.trim()).filter(Boolean).length > 0 && (
              <ul className="mt-2 space-y-1">
                {f.questions.split("\n").map((q) => q.trim()).filter(Boolean).map((q) => (
                  <li key={q} className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm">
                    <span className="min-w-0 break-words text-ink-200">{q}</span>
                    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-ink-300">
                      <input type="checkbox" checked={f.optionalQs.includes(q)} onChange={(e) => set({ optionalQs: e.target.checked ? [...f.optionalQs, q] : f.optionalQs.filter((x) => x !== q) })} /> Not required
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Who and how long</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {text("spots", "Spots (testers)", { req: true, type: "number", cls: "max-w-[8rem]", hint: `1–${limit}`, attrs: { "data-min": "1", "data-max": String(limit), "data-whole": "", "data-msg": spotsLimit != null ? `You can take up to ${limit} testers per test right now.` : `Spots must be a whole number from 1 to ${limit}.` } })}
          {text("deadlineDays", "Days each tester has from joining", { req: true, type: "number", cls: "max-w-[8rem]", hint: "1–90 days", attrs: { "data-min": "1", "data-max": "90", "data-whole": "", "data-msg": "Testers' deadline must be from 1 to 90 days after they join." } })}
          {text("openUntil", "Open until (no new testers or work after it; blank = no end)", { type: "date", cls: "max-w-[12rem]", hint: "from tomorrow, up to a year ahead", attrs: { min: tomorrow, max: yearOut, "data-msg": "Open until must be a date in the future.", "data-max-msg": "Open until can be at most a year ahead." } })}
        </div>
        {spotsLimit != null && <p className="note">{limitHint(spotsLimit)}</p>}
        {edit && edit.testersIn > 0 && <p className="note">{edit.testersIn} tester{edit.testersIn === 1 ? " is" : "s are"} in: spots can&apos;t go below that.</p>}
        <div>
          <label className="label" htmlFor="joinMode">Who can join</label>
          <select id="joinMode" className="input max-w-xs" value={f.joinMode} onChange={(e) => set({ joinMode: e.target.value })}>
            <option value="anyone">Anyone (they press Join)</option>
            <option value="apply">Apply (you accept or decline)</option>
            <option value="invite">Invite only</option>
          </select>
        </div>
        <Choices label="Devices testers need (any one; none ticked = any device)" options={DEVICES} value={f.devices} onChange={(devices) => set({ devices })} />
        <Choices label="Languages testers need (any one)" options={LANGUAGES} value={f.languages} onChange={(languages) => set({ languages })} />
      </div>

      <div className="space-y-2">
        {edit && edit.testersIn > 0 && <p className="note">Testers already working keep their contract; each is offered these new terms and can switch. Work they&apos;ve already sent keeps its price.</p>}
        <div className="flex flex-wrap items-center"><button className="btn" disabled={busy}>{busy ? "Saving…" : edit ? "Save" : "Post the test"}</button>{keep.restored && <NotSentTag />}</div>
        {saved && <p className="ok">{saved}</p>}
        <Err text={refusal} />
        <ChangesBox changes={changes} tail={listingEdited ? "Press Save again to save your changes (fields you didn't touch keep the newer values)." : "Press Save again to save."} />
        {errs.length > 0 && <p className="err-field">Fix the {errs.length === 1 ? "mistake" : `${errs.length} mistakes`} above, then press {edit ? "Save" : "Post the test"} again.</p>}
        {errs.length > 0 && (
          <ul className="err-field list-disc pl-5">
            {errs.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
      </div>
    </form>
  );
}
