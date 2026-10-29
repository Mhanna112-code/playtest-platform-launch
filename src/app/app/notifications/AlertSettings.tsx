"use client";
import { useState } from "react";
import { BellRing } from "lucide-react";
import { Err } from "@/components/Err";
import { api, errOf } from "@/lib/client";

const FREQUENCY: [string, string][] = [
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
];

/** How you're notified (the full app's fold on the notifications page): the email setting. */
export function AlertSettings({ emailPref }: { emailPref: string }) {
  const [pref, setPref] = useState(emailPref === "off" ? "off" : ["weekly", "monthly"].includes(emailPref) ? emailPref : "daily");
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
          <label className="flex items-center gap-2 text-slate-300"><input type="radio" name="emailOn" checked={pref === "off"} onChange={() => { setPref("off"); setSaved(false); }} /> Off (the bell keeps everything)</label>
          <label className="flex items-center gap-2 text-slate-300"><input type="radio" name="emailOn" checked={pref !== "off"} onChange={() => { setPref("daily"); setSaved(false); }} /> On: one email listing everything new</label>
          {pref !== "off" && (
            <div className="ml-6 flex flex-wrap gap-4" role="radiogroup" aria-label="How often">
              {FREQUENCY.map(([v, l]) => (
                <label key={v} className="flex items-center gap-2 text-slate-300"><input type="radio" name="emailPref" value={v} checked={pref === v} onChange={() => { setPref(v); setSaved(false); }} /> {l}</label>
              ))}
            </div>
          )}
          {/* (Owner, Oct 29, batch 28 §18) Payment lines are emailed the same evening whatever the setting, Off included. */}
          <p className="text-xs text-slate-500" data-payment-emails="">Payment updates are always emailed the same evening. That includes receipts, payments, failures, holds, retries, delays, payouts and chargebacks, even with email Off, Weekly or Monthly. Some account emails always send.</p>
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
