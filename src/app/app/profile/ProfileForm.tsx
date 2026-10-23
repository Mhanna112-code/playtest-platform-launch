"use client";
import { Err } from "@/components/Err";
import { useState } from "react";
import { Choices } from "@/components/Choices";
import { api, errOf } from "@/lib/client";
import { CATEGORIES, DEVICES, LANGUAGES } from "@/lib/options";

type Init = { name: string; pronoun: string; isDeveloper: boolean; isTester: boolean; devices: string[]; categories: string[]; languages: string[]; bio: string; emailPref?: string };

export function ProfileForm({ init, first }: { init: Init; first?: boolean }) {
  const [v, setV] = useState(init);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (p: Partial<Init>) => setV((o) => ({ ...o, ...p }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/profile", v);
      if (first) window.location.href = "/app";
      else setMsg({ ok: true, text: "Saved." });
    } catch (err) {
      setMsg({ ok: false, text: errOf(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={save}>
      <div>
        <label className="label req" htmlFor="name">Your name</label>
        <input id="name" className="input max-w-sm" value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ana Silva" />
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
      <fieldset>
        <legend className="label req">I&apos;m here to</legend>
        <label className="mr-4 text-sm"><input type="checkbox" checked={v.isDeveloper} onChange={(e) => set({ isDeveloper: e.target.checked })} /> post tests for my app, game or product (developer)</label>
        <label className="text-sm"><input type="checkbox" checked={v.isTester} onChange={(e) => set({ isTester: e.target.checked })} /> test apps, games and more, and get paid (tester)</label>
      </fieldset>
      {v.isTester && (
        <>
          <Choices label="Devices you play on" required options={DEVICES} value={v.devices} onChange={(devices) => set({ devices })} />
          <Choices label="Languages you can test in" required options={LANGUAGES} value={v.languages} onChange={(languages) => set({ languages })} />
          <Choices label="What you like to test" options={CATEGORIES} value={v.categories} onChange={(categories) => set({ categories })} />
          <div>
            <label className="label" htmlFor="bio">About you as a tester</label>
            <textarea id="bio" className="input" rows={3} value={v.bio} onChange={(e) => set({ bio: e.target.value })} />
          </div>
        </>
      )}
      {!first && (
        <div>
          <label className="label" htmlFor="emailPref">Email settings</label>
          <select id="emailPref" className="input max-w-xs" value={v.emailPref ?? "each"} onChange={(e) => set({ emailPref: e.target.value })}>
            <option value="each">Each update</option>
            <option value="daily">Daily summary</option>
            <option value="weekly">Weekly summary</option>
            <option value="monthly">Monthly summary</option>
            <option value="off">Off</option>
          </select>
          <p className="note">Sign-in links and payment receipts always send. The bell keeps everything.</p>
        </div>
      )}
      <button className="btn" disabled={busy}>{busy ? "Saving…" : first ? "Continue" : "Save"}</button>
      {msg && (msg.ok ? <p className="ok">{msg.text}</p> : <Err text={msg.text} />)}
    </form>
  );
}
