"use client";
import { useState } from "react";
import { checkFields, useLocalMin } from "@/components/FieldChecks";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { Err } from "@/components/Err";
import { api, ApiError, isFieldError } from "@/lib/client";
import { mergeChanges, useLiveAppend } from "@/lib/live";

/**
 * "Open until <date> · Change" (the full app's fold in the test header). Saving goes through Edit's Save: the same
 * stop-once box and refusals. Once the date has passed it's plain text: it can't be changed any more (lean rule).
 */
export function OpenUntilFold({ testId, version, seenAt, openUntil, passed }: { testId: string; version: number; seenAt: string; openUntil: string; passed: boolean }) {
  const day = new Date(openUntil);
  const shown = day.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const [value, setValue] = useState(openUntil.slice(0, 10));
  const tomorrow = useLocalMin(24 * 60, true), yearOut = useLocalMin(366 * 24 * 60, true);
  const [busy, setBusy] = useState(false);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [refusal, setRefusal] = useState("");
  const [mistake, setMistake] = useState("");
  useLiveAppend(changes != null, (added) => setChanges((c) => (c ? mergeChanges(c, added) : c)));
  if (passed) return <p className="text-xs text-slate-400">Open until {shown} (passed)</p>;
  async function save() {
    if (!checkFields(document.getElementById("open-until"))) return;
    setBusy(true);
    setRefusal("");
    setMistake("");
    try {
      await api(`/api/tests/${testId}/edit`, { version, fields: { openUntil: value }, seenAt, confirmed: changes != null });
      window.location.reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === "changed") setChanges((e.data.changes as Change[]) ?? []);
      else if (e instanceof ApiError && isFieldError(e)) {
        setChanges(null);
        setMistake(e.message);
      } else {
        setChanges(null);
        setRefusal(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="text-xs text-slate-400" id="open-until">
      <summary className="cursor-pointer">Open until {shown} (new testers can join until then) · <span className="text-sky-300">Change</span></summary>
      <div className="mt-2 space-y-2">
        <input type="date" aria-label="Open until" min={tomorrow} max={yearOut} data-msg="Open until must be a date in the future." data-max-msg="Open until can be at most a year ahead." className={"input w-auto py-1 " + (mistake ? "field-bad" : "")} value={value} onChange={(e) => setValue(e.target.value)} />
        <span className="ml-2 text-xs text-slate-500">from tomorrow, up to a year ahead</span>
        <p>New testers can join until then. Testers already in keep their own deadlines, even past it.</p>
        <button className="btn-secondary px-3 py-1 text-xs" disabled={busy} onClick={save}>Save</button>
        {mistake && <p className="err-field">{mistake}</p>}
        <Err text={refusal} />
        <ChangesBox changes={changes} tail="Press Save again to save." />
      </div>
    </details>
  );
}
