"use client";
import { useState } from "react";
import { Choices } from "@/components/Choices";
import { FormMistakes } from "@/components/FormMistakes";
import { api, errOf } from "@/lib/client";
import { DEVICES, LANGUAGES } from "@/lib/options";

type Init = { name: string; pronoun: string; isDeveloper: boolean; isTester: boolean; devices: string[]; categories: string[]; languages: string[]; bio: string };

/** The profile form of the side in use: the developer's is the name; the tester's adds devices, languages and a bio. (Batch 16 section 10) A mistake is red at its box and listed under the button. */
export function ProfileForm({ init, first, side = "tester" }: { init: Init; first?: boolean; side?: "developer" | "tester" }) {
  const [v, setV] = useState(init);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (p: Partial<Init>) => setV((o) => ({ ...o, ...p }));
  const tester = first ? v.isTester : side === "tester";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/profile", v);
      if (first) window.location.href = "/app";
      else setMsg({ ok: true, text: "Your profile is saved." });
    } catch (err) {
      setMsg({ ok: false, text: errOf(err) });
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
      {first && (
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
        <span role="status" aria-live="polite">{msg?.ok && <span className="text-emerald-300">{msg.text}</span>}</span>
      </div>
      <FormMistakes text={msg && !msg.ok ? msg.text : ""} press={first ? "Continue" : "Save profile"} />
    </form>
  );
}
