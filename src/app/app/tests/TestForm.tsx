"use client";
import { useState } from "react";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { mergeChanges, useLiveAppend } from "@/lib/live";
import { Choices } from "@/components/Choices";
import { api, ApiError } from "@/lib/client";
import { CATEGORIES, DEVICES, LANGUAGES } from "@/lib/options";
import type { Listing } from "@/lib/rules";

// Post and Edit share this form. Prices are typed in dollars ("7.50"; "0" for free). Edit sends only the fields the
// user touched plus the version it loaded; if the test changed since, Save stops once and lists what changed.

type F = {
  title: string; description: string; buildUrl: string; category: string; devices: string[]; languages: string[];
  spots: string; deadlineDays: string; written: boolean; writtenPrice: string; recording: boolean; recordingPrice: string;
  live: boolean; liveRate: string; liveMinutes: string; questions: string; openUntil: string; joinMode: string;
};

const dollars = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));
export function toForm(l: Listing): F {
  return {
    title: l.title, description: l.description, buildUrl: l.buildUrl, category: l.category, devices: l.devices, languages: l.languages,
    spots: String(l.spots), deadlineDays: String(l.deadlineDays), written: l.writtenCents != null, writtenPrice: dollars(l.writtenCents),
    recording: l.recordingCents != null, recordingPrice: dollars(l.recordingCents), live: l.liveRateCents != null,
    liveRate: dollars(l.liveRateCents), liveMinutes: String(l.liveMinutes ?? 30), questions: l.questions.join("\n"),
    openUntil: l.openUntil ? l.openUntil.slice(0, 10) : "",
    joinMode: l.joinMode ?? "anyone",
  };
}

/** Form values → API fields (prices in dollars; the server turns them into cents). */
function toApi(f: F): Record<string, unknown> {
  return {
    title: f.title, description: f.description, buildUrl: f.buildUrl, category: f.category, devices: f.devices, languages: f.languages,
    spots: f.spots, deadlineDays: f.deadlineDays, writtenCents: f.written ? f.writtenPrice || "" : null,
    recordingCents: f.recording ? f.recordingPrice || "" : null, liveRateCents: f.live ? f.liveRate || "" : null,
    liveMinutes: f.live ? f.liveMinutes : null, questions: f.questions.split("\n").map((q) => q.trim()).filter(Boolean), openUntil: f.openUntil, joinMode: f.joinMode,
  };
}
// Which API fields each form field feeds.
const API_FIELDS: Record<keyof F, string[]> = {
  title: ["title"], description: ["description"], buildUrl: ["buildUrl"], category: ["category"], devices: ["devices"], languages: ["languages"],
  spots: ["spots"], deadlineDays: ["deadlineDays"], written: ["writtenCents"], writtenPrice: ["writtenCents"], recording: ["recordingCents"],
  recordingPrice: ["recordingCents"], live: ["liveRateCents", "liveMinutes"], liveRate: ["liveRateCents"], liveMinutes: ["liveMinutes"], questions: ["questions"], openUntil: ["openUntil"], joinMode: ["joinMode"],
};

export function TestForm({ init, edit }: { init: Listing; edit?: { id: string; version: number; testersIn: number; draft: boolean; seenAt?: string } }) {
  const [f, setF] = useState<F>(toForm(init));
  const [touched, setTouched] = useState<Set<keyof F>>(new Set());
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<string[]>([]);
  const [changes, setChanges] = useState<Change[] | null>(null);
  useLiveAppend(changes != null, (added) => setChanges((c) => (c ? mergeChanges(c, added) : c)));
  const [saved, setSaved] = useState("");
  const set = (p: Partial<F>) => {
    setF((o) => ({ ...o, ...p }));
    setTouched((t) => new Set([...t, ...(Object.keys(p) as (keyof F)[])]));
    setSaved("");
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrs([]);
    try {
      if (!edit) {
        const r = await api<{ id: string }>("/api/tests", toApi(f));
        window.location.href = `/app/tests/${r.id}`;
        return;
      }
      const all = toApi(f);
      const fields: Record<string, unknown> = {};
      for (const k of touched) for (const a of API_FIELDS[k]) fields[a] = all[a];
      const r = await api<{ offered: number }>(`/api/tests/${edit.id}/edit`, { version: edit.version, fields, seenAt: edit.seenAt, confirmed: changes != null });
      window.location.href = `/app/tests/${edit.id}?saved=1&offered=${r.offered ?? 0}`;
    } catch (err) {
      if (err instanceof ApiError && err.code === "changed") setChanges(err.data.changes as Change[]);
      else {
        setChanges(null);
        setErrs(err instanceof ApiError && Array.isArray(err.data.errors) ? (err.data.errors as string[]) : [(err as Error).message]);
      }
    } finally {
      setBusy(false);
    }
  }

  // Mark the field a mistake is about (red at the field).
  const FIELD_WORDS: Partial<Record<keyof F, RegExp>> = { title: /title/i, writtenPrice: /written answers price/i, recordingPrice: /recording price/i, liveRate: /live call rate/i, liveMinutes: /call lasts/i, spots: /spots/i, deadlineDays: /deadline/i, openUntil: /open until/i, buildUrl: /build link/i };
  const bad = (k: keyof F) => !!FIELD_WORDS[k] && errs.some((e) => FIELD_WORDS[k]!.test(e));
  const text = (k: keyof F, label: string, opts: { req?: boolean; ph?: string; type?: string; cls?: string } = {}) => (
    <div>
      <label className={"label" + (opts.req ? " req" : "")} htmlFor={k}>{label}</label>
      <input id={k} type={opts.type ?? "text"} className={"input " + (opts.cls ?? "") + (bad(k) ? " field-bad" : "")} placeholder={opts.ph} value={f[k] as string} onChange={(e) => set({ [k]: e.target.value } as Partial<F>)} />
    </div>
  );

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
        <div>
          <label className="label" htmlFor="category">Category</label>
          <select id="category" className="input max-w-xs" value={f.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="">Choose…</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="panel">
        <h2>Feedback and prices</h2>
        <p className="note">Every term is fixed in each tester&apos;s contract when they join. Edits change the listing for new testers only.</p>
        <label className="block text-sm"><input type="checkbox" checked={f.written} onChange={(e) => set({ written: e.target.checked })} /> Written answers</label>
        {f.written && (
          <div className="ml-6 grid gap-3 sm:grid-cols-2">
            {text("writtenPrice", "Price for written answers ($, 0 for free)", { req: true, ph: "10.00", cls: "max-w-[10rem]" })}
            <div className="sm:col-span-2">
              <label className="label req" htmlFor="questions">Questions (one per line)</label>
              <textarea id="questions" rows={4} className="input" value={f.questions} onChange={(e) => set({ questions: e.target.value })} placeholder={"What did you like?\nWhere did you get stuck?"} />
            </div>
          </div>
        )}
        <label className="block text-sm"><input type="checkbox" checked={f.recording} onChange={(e) => set({ recording: e.target.checked })} /> Screen recording</label>
        {f.recording && <div className="ml-6">{text("recordingPrice", "Price for a recording ($, 0 for free)", { req: true, ph: "15.00", cls: "max-w-[10rem]" })}</div>}
        <label className="block text-sm"><input type="checkbox" checked={f.live} onChange={(e) => set({ live: e.target.checked })} /> Live call</label>
        {f.live && (
          <div className="ml-6 grid gap-3 sm:grid-cols-2">
            {text("liveRate", "Rate per hour ($, 0 for free)", { req: true, ph: "30.00", cls: "max-w-[10rem]" })}
            {text("liveMinutes", "Call length (minutes)", { req: true, type: "number", cls: "max-w-[8rem]" })}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Who and how long</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {text("spots", "Spots (testers)", { req: true, type: "number", cls: "max-w-[8rem]" })}
          {text("deadlineDays", "Days each tester has from joining", { req: true, type: "number", cls: "max-w-[8rem]" })}
          {text("openUntil", "Open until (no new testers or work after it; blank = no end)", { type: "date", cls: "max-w-[12rem]" })}
        </div>
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
        <button className="btn" disabled={busy}>{busy ? "Saving…" : edit ? "Save" : "Post the test"}</button>
        {saved && <p className="ok">{saved}</p>}
        <ChangesBox changes={changes} tail="Press Save again to save your changes (fields you didn't touch keep the newer values)." />
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
