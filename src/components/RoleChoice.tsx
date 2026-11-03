const ROLE = "flex cursor-pointer items-center gap-2 rounded-lg border border-slate-600 p-3 has-[:checked]:border-indigo-400";

/**
 * Sign-up's "I am a…" (developer, tester or both), as the full app asks it: on the email form and on Google's step. (Owner, Nov 3, batch 35 §134) Required: Sign
 * up or Continue without a pick is refused with "Choose developer, tester or both.", red at this choice (data-match) until one is picked.
 */
export function RoleChoice() {
  return (
    <fieldset>
      <legend className="label req">I am a…</legend>
      <div id="role" className="grid gap-3 rounded-lg sm:grid-cols-3" data-field-group="" data-match="developer, tester or both">
        <label className={ROLE}><input type="radio" name="role" value="developer" required /> Developer or maker</label>
        <label className={ROLE}><input type="radio" name="role" value="tester" required /> Tester</label>
        <label className={ROLE}><input type="radio" name="role" value="both" required /> Both</label>
      </div>
      <p className="mt-1.5 text-xs text-slate-500">One account either way: with both, switch sides from the button next to your name.</p>
    </fieldset>
  );
}
