"use client";
import { useState } from "react";
import { BellRing } from "lucide-react";
import { Err } from "@/components/Err";
import { api, errOf } from "@/lib/client";

const OPTIONS: [string, string][] = [
  ["each", "Email me each notification"],
  ["daily", "One summary a day"],
  ["weekly", "One summary a week"],
  ["monthly", "One summary a month"],
  ["off", "Don't email me (the bell keeps everything)"],
];

/** How you're notified (the full app's fold on the notifications page): the email setting. */
export function AlertSettings({ emailPref }: { emailPref: string }) {
  const [pref, setPref] = useState(emailPref);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <details className="card" open={!!err}>
      <summary className="flex cursor-pointer items-center gap-2 font-semibold text-white"><BellRing className="h-5 w-5 text-volt-300" /> How you&apos;re notified</summary>
      <form
        className="mt-4 space-y-4 text-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr("");
          setSaved(false);
          try {
            await api("/api/account/notify", { emailPref: pref });
            setSaved(true);
          } catch (x) {
            setErr(errOf(x));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="space-y-1.5">
          <legend className="label">Email</legend>
          {OPTIONS.map(([v, l]) => (
            <label key={v} className="flex items-center gap-2 text-slate-300"><input type="radio" name="emailPref" value={v} checked={pref === v} onChange={() => { setPref(v); setSaved(false); }} /> {l}</label>
          ))}
          <p className="text-xs text-slate-500">Receipts always send. The bell keeps everything, whatever you choose.</p>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn" disabled={busy}>Save</button>
          {saved && <span className="text-emerald-300" role="status">Your alert settings are saved.</span>}
        </div>
        <Err text={err} />
      </form>
    </details>
  );
}
