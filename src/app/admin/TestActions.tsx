"use client";
import { AdminButton } from "./AdminButton";

/**
 * (Owner, Oct 29, batch 22 section 5; batch 34 §1) A test's own admin actions on its page's admin box: Pause or Lift the pause (only the team's own pause can be
 * lifted here), Stop (close), Allow 3 more changes of the locked fields when a field is locked, and while the test is paused (any cause) its closing date with Extend
 * and Close now. Every press sends when this box was read (`seen`): another admin's change to the test since then stops it once; one no longer possible is refused
 * naming who and when.
 */
export function TestActions({ id, seen, adminPaused, stopped, critical, closure }: { id: string; seen: string; adminPaused: boolean; stopped: boolean; critical: number; closure: string | null }) {
  if (stopped) return null;
  const extra = { since: seen };
  return (
    <div className="space-y-2 text-sm" data-test-actions={id}>
      <div className="flex flex-wrap items-center gap-2">
        {adminPaused ? <AdminButton key="lift" action="unpause-test" id={id} label="Lift the pause" extra={extra} /> : <AdminButton key="pause" action="pause-test" id={id} label="Pause" fields={[{ name: "note", label: "Why" }]} extra={extra} />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <AdminButton action="stop-test" id={id} label="Stop (close)" danger fields={[{ name: "note", label: "Why" }]} extra={extra} />
      </div>
      {critical > 0 && <div className="flex flex-wrap items-center gap-2"><AdminButton action="allow-critical-changes" id={id} label="Allow 3 more changes of the locked fields" extra={extra} /></div>}
      {closure && (
        <div className="space-y-1" data-test-closure="">
          <p data-closure-date=""><b>{closure}</b></p>
          <div className="flex flex-wrap items-center gap-2">
            <AdminButton action="extend-pause" id={id} label="Extend" fields={[{ name: "days", label: "Days to add", ph: "Days (7)" }]} extra={extra} />
            <AdminButton action="close-paused" id={id} label="Close now" danger extra={extra} />
          </div>
        </div>
      )}
    </div>
  );
}
