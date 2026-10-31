"use client";
import { useEffect, useRef, useState } from "react";
import { Choices } from "@/components/Choices";
import { FormMistakes } from "@/components/FormMistakes";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { api, ApiError, errOf } from "@/lib/client";
import { mergeChanges } from "@/lib/live";
import { DEVICES, LANGUAGES } from "@/lib/options";
import { DraftTag, useKept } from "@/lib/useKept";
import { PROFILE_DRAFT_FIELDS, type ProfileDraftField } from "@/lib/keptText";

type Init = { name: string; pronoun: string; isDeveloper: boolean; isTester: boolean; devices: string[]; categories: string[]; languages: string[]; bio: string };

/** (Batch 35 §10) The profile's draft: the fields that differ from the saved profile (never the first setup's sides). */
export function profileDraft(v: Init, saved: Init): Partial<Pick<Init, ProfileDraftField>> {
  return Object.fromEntries(PROFILE_DRAFT_FIELDS.filter((k) => JSON.stringify(v[k]) !== JSON.stringify(saved[k])).map((k) => [k, v[k]]));
}
/** (Batch 35 §10) A kept profile draft's fields, as the form takes them (anything of the wrong shape is left out). */
export function profileFromDraft(d: unknown): Partial<Pick<Init, ProfileDraftField>> {
  const f = d && typeof d === "object" && !Array.isArray(d) ? (d as { f?: unknown }).f : null;
  if (!f || typeof f !== "object" || Array.isArray(f)) return {};
  const out: Record<string, unknown> = {};
  for (const k of PROFILE_DRAFT_FIELDS) {
    const x = (f as Record<string, unknown>)[k];
    if (k === "devices" || k === "categories" || k === "languages" ? Array.isArray(x) && x.every((y) => typeof y === "string") : typeof x === "string") out[k] = x;
  }
  return out as Partial<Pick<Init, ProfileDraftField>>;
}

/** The profile form of the side in use: the developer's is the name; the tester's adds devices, languages and a bio. (Batch 16 section 10) A mistake is red at its box and listed under the button. */
export function ProfileForm({ init, first, admin = false, side = "tester", seenAt: seen0 }: { init: Init; first?: boolean; /** (Batch 20 section 16) an admin's first setup: Name and Pronoun only, then the admin console */ admin?: boolean; side?: "developer" | "tester"; /** (Batch 16 section 27) the page's load time */ seenAt?: string }) {
  const [v, setV] = useState(init);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // (Owner, Oct 28, batch 16 section 27) Saved in another tab or device: the page refreshes silently and the boxes not typed in take the saved values; the
  // first Save afterwards stops once (from the page's load time) listing what changed; the second saves what's here on top.
  const [seenAt] = useState(seen0 ?? "");
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [boxAt, setBoxAt] = useState("");
  const typed = useRef(new Set<keyof Init>());
  const set = (p: Partial<Init>) => {
    for (const k of Object.keys(p) as (keyof Init)[]) typed.current.add(k);
    setV((o) => ({ ...o, ...p }));
  };
  useEffect(() => {
    setV((o) => {
      const next = { ...o };
      for (const k of Object.keys(init) as (keyof Init)[]) if (!typed.current.has(k)) (next as Record<string, unknown>)[k] = init[k];
      return next;
    });
  }, [init]);
  const tester = first ? v.isTester : side === "tester";
  // (Batch 35 §10) The profile edits are kept as a draft per side (the fields that differ from the saved profile; the first setup keeps none): "Draft" after a
  // reload, and after a sign-in "Draft" with "Use saved" (back to the saved values). Save profile going through clears it; a stopped or refused Save keeps it.
  const draft = profileDraft(v, init);
  const keep = useKept(`profile:${side}`, { f: draft }, Object.keys(draft).length === 0, (d) => {
    const f = profileFromDraft(d);
    for (const k of Object.keys(f) as (keyof Init)[]) typed.current.add(k);
    setV((o) => ({ ...o, ...f }));
  }, !!first);
  const useSaved = () => {
    typed.current.clear();
    setV(init);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/profile", { ...v, ...(seenAt ? { seenAt, confirmed: changes != null, ...(changes != null && boxAt ? { boxAt } : {}) } : {}) });
      setChanges(null);
      typed.current.clear();
      if (!first) await keep.clear(); // (batch 35 §10) saved: the draft goes
      if (first) window.location.href = admin && !v.isDeveloper && !v.isTester ? "/admin" : "/app";
      else setMsg({ ok: true, text: "Your profile is saved." });
    } catch (err) {
      if (err instanceof ApiError && err.code === "stop_once") {
        setChanges((c) => (c ? mergeChanges(c, (err.data.changes as Change[]) ?? []) : ((err.data.changes as Change[]) ?? [])));
        if (typeof err.data.now === "string") setBoxAt(err.data.now);
      } else setMsg({ ok: false, text: errOf(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card space-y-5" onSubmit={save}>
      <div>
        <label className="label req" htmlFor="name">Name</label>
        <input id="name" className="input" data-required="" data-required-msg="Enter your name (others see it)." data-match="your name" value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ana Silva" />
      </div>
      <div>
        <label className="label" htmlFor="pronoun">Pronoun</label>
        <select id="pronoun" className="input max-w-[12rem]" value={v.pronoun} onChange={(e) => set({ pronoun: e.target.value })}>
          <option value="">Not set (others read “they”)</option>
          <option value="she">she / her</option>
          <option value="he">he / him</option>
          <option value="they">they / them</option>
        </select>
      </div>
      {first && !admin && (
        <fieldset id="sides" data-field-group="" data-match="developer, tester, or both">
          <legend className="label req">I&apos;m here to</legend>
          <label className="mr-4 text-sm"><input type="checkbox" checked={v.isDeveloper} onChange={(e) => set({ isDeveloper: e.target.checked })} /> post tests for my app, game or product (developer)</label>
          <label className="text-sm"><input type="checkbox" checked={v.isTester} onChange={(e) => set({ isTester: e.target.checked })} /> test apps, games and more, and get paid (tester)</label>
        </fieldset>
      )}
      {tester && (
        <>
          <div id="devices" data-field-group="" data-match="at least one device"><Choices label="Devices you use" required options={DEVICES} value={v.devices} onChange={(devices) => set({ devices })} /></div>
          <div id="languages" data-field-group="" data-match="at least one language"><Choices label="Languages you can test in" required options={LANGUAGES} value={v.languages} onChange={(languages) => set({ languages })} /></div>
          <div>
            <label className="label" htmlFor="bio">Bio (shown to developers)</label>
            <textarea id="bio" className="input min-h-24" maxLength={1000} value={v.bio} onChange={(e) => set({ bio: e.target.value })}
              placeholder="e.g. Gameplay-experience QA for 5 years; Castilian Spanish LQA; I play a lot of roguelikes on PC." />
          </div>
        </>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={busy}>{busy ? "Saving…" : first ? "Continue" : "Save profile"}</button>
        {keep.restored && Object.keys(draft).length > 0 && <DraftTag kind="saved" onUseSaved={useSaved} />}
        <span role="status" aria-live="polite">{msg?.ok && <span className="text-emerald-300">{msg.text}</span>}</span>
      </div>
      <ChangesBox changes={changes} press={first ? "Continue" : "Save profile"} />
      <FormMistakes text={msg && !msg.ok ? msg.text : ""} press={first ? "Continue" : "Save profile"} />
    </form>
  );
}
