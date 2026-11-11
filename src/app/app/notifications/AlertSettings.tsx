"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing } from "lucide-react";
import { Err } from "@/components/Err";
import { api, ApiError, errOf } from "@/lib/client";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { mergeChanges } from "@/lib/live";

const FREQUENCY: [string, string][] = [
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
];

/** How you're notified (the full app's fold on the notifications page): the email setting. */
export function AlertSettings({ emailPref, side = null, seenAt: seen0 }: { emailPref: string; side?: "developer" | "tester" | null; seenAt?: string }) {
  const router = useRouter();
  const dirty = useRef(false);
  const [pref, setPref] = useState(emailPref === "off" ? "off" : ["weekly", "monthly"].includes(emailPref) ? emailPref : "daily");
  useEffect(() => {
    if (!dirty.current) setPref(emailPref === "off" ? "off" : ["weekly", "monthly"].includes(emailPref) ? emailPref : "daily");
  }, [emailPref]);
  const choose = (value: string) => { dirty.current = true; setPref(value); setSaved(false); };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  // (Owner, Nov 3, batch 35 §157) Settings changed in another tab or device since the page opened: the first Save stops once with what changed (the box under
  // Save); the second goes ahead.
  const [seenAt, setSeenAt] = useState(seen0 ?? "");
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [boxAt, setBoxAt] = useState("");
  return (
    <details className="card" open={!!err || changes != null}>
      <summary className="flex cursor-pointer items-center gap-2 font-semibold text-white"><BellRing className="h-5 w-5 text-volt-300" /> How you&apos;re notified</summary>
      <form
        className="mt-4 space-y-4 text-sm"
        data-red-and-blue="" /* (§380 D2b) the box with any red note; nothing saved while red */
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr("");
          setSaved(false);
          try {
            const r = await api<{ at?: string }>("/api/account/notify", { emailPref: pref, ...(seenAt ? { seenAt, confirmed: changes != null, ...(changes != null && boxAt ? { boxAt } : {}) } : {}) });
            if (typeof r?.at === "string") setSeenAt(r.at);
            setChanges(null);
            setSaved(true);
            dirty.current = false;
            router.refresh();
          } catch (x) {
            if (x instanceof ApiError && x.code === "stop_once") {
              setChanges((c) => (c ? mergeChanges(c, (x.data.changes as Change[]) ?? []) : ((x.data.changes as Change[]) ?? [])));
              if (typeof x.data.now === "string") setBoxAt(x.data.now);
            } else {
              setChanges(null); // (§4 small fixes) a refusal replaces an older stop box: only the refusal shows
              setErr(errOf(x));
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="space-y-1.5">
          <legend className="label">Email</legend>
          <label className="flex items-center gap-2 text-slate-300"><input type="radio" name="emailOn" checked={pref === "off"} onChange={() => { choose("off"); }} /> Off (the bell keeps everything)</label>
          <label className="flex items-center gap-2 text-slate-300"><input type="radio" name="emailOn" checked={pref !== "off"} onChange={() => { choose("daily"); }} /> On: one email listing everything new</label>
          {pref !== "off" && (
            <div className="ml-6 flex flex-wrap gap-4" role="radiogroup" aria-label="How often">
              {FREQUENCY.map(([v, l]) => (
                <label key={v} className="flex items-center gap-2 text-slate-300"><input type="radio" name="emailPref" value={v} checked={pref === v} onChange={() => { choose(v); }} /> {l}</label>
              ))}
            </div>
          )}
          {/* (Owner, Oct 29, batch 28 §18) Payment lines are emailed the same evening whatever the setting, Off included. (Batch 34 §5) Only the side in use's kinds. */}
          <p className="text-xs text-slate-500" data-payment-emails="">Payment updates are always emailed the same evening, even with email Off, Weekly or Monthly{side === "developer" ? ": receipts, failures, holds, retries and chargebacks" : side === "tester" ? ": payments, delays and payouts" : ""}. Some account emails always send.</p>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn" disabled={busy}>Save</button>
          {saved && <span className="text-emerald-300" role="status">Your alert settings are saved.</span>}
        </div>
        <ChangesBox changes={changes} press="Save" />
        <Err text={err} press="Save" />
      </form>
    </details>
  );
}
