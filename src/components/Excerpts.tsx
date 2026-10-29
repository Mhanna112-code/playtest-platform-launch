"use client";
import { useState } from "react";
import { Err } from "@/components/Err";
import { FormMistakes } from "@/components/FormMistakes";
import { ConfirmButton } from "@/components/ConfirmButton";
import { api, errOf } from "@/lib/client";
import { ChangesBox, type Change } from "@/components/ChangesBox";

// (Owner, Oct 29, batch 13) Excerpt requests: the tester's picker, the developer's Allow / Deny, and Remove / Take down. None of them stops once: a press goes through
// whatever changed meanwhile, and is refused only when the request (or excerpt) no longer exists, or (a request, an Allow) when the test now has an NDA.
// (Owner, Oct 28, batch 16 section 21) The exception: a big change made in another tab (End early, Stop, a Pay, a call change) stops Allow / Deny once.

const MIN = 10, MAX = 500;

/** "Show an excerpt on your profile" on a paid written part: pick one answer and trim it. (Batch 18 section 7) It always reads "From <test>": no "Don't name the product" tick. */
export function ExcerptPicker({ submissionId, choices }: { submissionId: string; choices: { index: number; question: string; text: string }[] }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(choices[0]?.index ?? 0);
  const [text, setText] = useState((choices[0]?.text ?? "").slice(0, MAX));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pick = (i: number) => {
    setIndex(i);
    setText((choices.find((c) => c.index === i)?.text ?? "").slice(0, MAX));
  };
  const n = text.trim().length;
  async function send() {
    setBusy(true);
    setErr("");
    try {
      await api("/api/excerpts", { action: "request", submissionId, index, text });
      window.location.reload();
    } catch (e) {
      setErr(errOf(e));
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2" data-excerpt-picker="" data-mistakes-root="">
      {!open && <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>Show an excerpt on your profile</button>}
      {open && (
        <div className="space-y-2 rounded-lg border border-white/10 p-3 text-sm">
          <p className="font-medium text-white">Show an excerpt on your profile</p>
          <p className="text-slate-400">Pick one answer and trim it to the part you want to show. It&apos;s shown as a plain quote, and the developer allows or denies it.</p>
          <fieldset id={`excerpt-pick-${submissionId}`} className="space-y-1" data-field-group="" data-match="pick one of your answers">
            {choices.map((c) => (
              <label key={c.index} className="flex items-start gap-2">
                <input type="radio" name={`excerpt-${submissionId}`} checked={index === c.index} onChange={() => pick(c.index)} />
                <span className="min-w-0 break-words">{c.question}</span>
              </label>
            ))}
          </fieldset>
          <label className="label req" htmlFor={`excerpt-text-${submissionId}`}>The excerpt</label>
          <textarea id={`excerpt-text-${submissionId}`} rows={4} className="input" maxLength={MAX} data-match="an excerpt is|trim the excerpt" value={text} onChange={(e) => setText(e.target.value)} />
          <p className={`text-xs ${n < MIN || n > MAX ? "text-rose-300" : "text-slate-500"}`} data-excerpt-count="">{n} / {MAX} (at least {MIN})</p>
          <div className="flex gap-2">
            <button type="button" className="btn px-3 py-1.5 text-sm" disabled={busy || n < MIN || n > MAX} onClick={send}>{busy ? "Sending…" : "Ask the developer"}</button>
            <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      {/* (Batch 16 section 10) A mistake is red at its box and listed; a refusal stays blue. */}
      <FormMistakes text={err} press="Ask the developer" />
    </div>
  );
}

/** The developer's Allow and Deny on a pending request (Needs you, or the restricted dashboard box). */
export function ExcerptDecision({ excerptId, seenAt }: { excerptId: string; /** the test page's load time: a big change in another tab stops once */ seenAt?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [box, setBox] = useState<{ changes: Change[]; at: string } | null>(null);
  const decide = async (decision: "allow" | "deny") => {
    setBusy(true);
    setErr("");
    try {
      await api("/api/excerpts", { action: "decide", excerptId, decision, ...(seenAt ? { seenAt } : {}), ...(box ? { confirmed: true, boxAt: box.at } : {}) });
      window.location.reload();
    } catch (e) {
      const stop = (e as { code?: string; data?: { changes?: Change[] } }).code === "stop_once" ? (e as { data: { changes?: Change[] } }).data.changes ?? [] : null;
      if (stop) setBox({ changes: stop, at: new Date().toISOString() });
      else setErr(errOf(e));
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <button type="button" className="btn px-3 py-1 text-sm" disabled={busy} onClick={() => decide("allow")}>Allow</button>
        <button type="button" className="btn-secondary px-3 py-1 text-sm" disabled={busy} onClick={() => decide("deny")}>Deny</button>
      </div>
      {box && <ChangesBox changes={box.changes} press="Allow / Deny" />}
      <Err text={err} />
    </div>
  );
}

/** Remove (the tester's own list) or Take down (the developer, from the tester's row), with a confirm. */
export function ExcerptRemove({ excerptId, label = "Remove", body = "It leaves your profile at once." }: { excerptId: string; label?: string; body?: string }) {
  const [err, setErr] = useState("");
  return (
    <span className="inline-flex flex-col gap-1">
      <ConfirmButton className="btn-ghost !px-2 !py-0.5 text-xs" title={`${label} this excerpt?`} confirmLabel={label} body={<p>{body}</p>}
        onConfirm={() => api("/api/excerpts", { action: "remove", excerptId }).then(() => window.location.reload()).catch((e) => setErr(errOf(e)))}>
        {label}
      </ConfirmButton>
      <Err text={err} />
    </span>
  );
}
