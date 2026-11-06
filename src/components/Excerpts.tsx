"use client";
import { useFinished } from "@/lib/usePress";
import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Err } from "@/components/Err";
import { FormMistakes } from "@/components/FormMistakes";
import { ConfirmButton } from "@/components/ConfirmButton";
import { api, errOf } from "@/lib/client";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { AnswerText, ValueText } from "@/components/QA";
import { allKept, deletedRange, deleteFrom, excerptOf, GAP, insertedRange, keptChars, restoreAt, runsOf, squash } from "@/lib/excerptTrim";
import { lockPick, lockText } from "@/lib/sendLock";

// (Owner, Oct 29, batch 13) Excerpt requests: the tester's picker, the developer's Allow / Deny, and the tester's Remove. None of them stops once: a press goes through
// whatever changed meanwhile, and is refused only when the request (or excerpt) no longer exists, or (a request, an Allow) when the test now has an NDA.
// (Owner, Oct 29, batch 29 section 12) Allow / Deny never stop for your own changes in another tab (the same decision made there is a plain refusal).

const MIN = 10, MAX = 500;

/** (§196) The trim box: about 5 lines, scrolling inside; (owner, Nov 5) no "Open the box taller" button: its corner drags it taller, up to the text boxes' height cap. */
export const TRIM_BOX_SHUT = "calc(5lh + 1rem)";
/** (§237) The answer above the trim box: its first height (about 6 lines; it was folded at 3 with Show more). */
export const EXCERPT_BOX_MAX = "9rem";

/**
 * "Show an excerpt on your profile" on a paid written part: pick one answer and trim it. (Batch 18 section 7) It always reads "From <test>": no "Don't name the product" tick.
 * (Owner, Nov 4, §196) The answer is shown read-only above the box (folded at 3 lines; Show more opens it in the 8-line scroll box, §182), and the box below starts
 * with the WHOLE answer and is delete-only: typing, pasting, dropping or an autocorrect replacement is refused (the text stays as it was); deleting works
 * (Backspace, Delete, cut, a selection deleted, word deletes, on phones too). What's kept is a mask over the answer (lib/excerptTrim): each change is compared
 * with the box's previous text and accepted only when it removed one stretch, so it doesn't depend on which events a phone sends. What's deleted is struck
 * through in the answer above, live. A part removed from the middle reads " … " in the excerpt ("Shown as:" says how it will read). "Use original answer"
 * puts the whole answer back; picking another answer starts again from its whole text. (Owner, Nov 5, §262) Typing back a deleted character (the very next
 * left-out character at the caret) restores it; any other typing is still refused. The counter counts the excerpt as it will be stored, ellipses included.
 */
export function ExcerptPicker({ submissionId, choices, defaultOpen = false }: { submissionId: string; choices: { index: number; question: string; text: string }[]; /** drawn open (tests) */ defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [index, setIndex] = useState(choices[0]?.index ?? 0);
  const original = choices.find((c) => c.index === index)?.text ?? "";
  const [kept, setKept] = useState(() => allKept(choices[0]?.text ?? ""));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  // (Batch 35 §40, §41) A press that went through redraws the page in place; its button stays greyed until it has.
  const fin = useFinished(() => setBusy(false));
  const pick = (i: number) => {
    setIndex(i);
    setKept(allKept(choices.find((c) => c.index === i)?.text ?? ""));
  };
  const shown = useMemo(() => keptChars(original, kept), [original, kept]);
  const excerpt = useMemo(() => excerptOf(original, kept), [original, kept]);
  const runs = useMemo(() => runsOf(original, kept), [original, kept]);
  const cut = kept.some((k) => !k);
  const n = excerpt.text.length;
  // (§196) Inserting is refused before it happens where the browser lets us (desktop browsers); every change is checked again in onChange, whatever was sent.
  // (Owner, Nov 5, §262) Except typing back a character deleted by accident: the very next left-out character of the answer at the caret is let through.
  const now = useRef({ original, kept });
  now.current = { original, kept };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const refuse = (e: InputEvent) => {
      if (e.inputType.startsWith("delete")) return;
      const restores = e.inputType === "insertText" && !!e.data && el.selectionStart === el.selectionEnd && !!restoreAt(now.current.original, now.current.kept, el.selectionStart, e.data);
      if (!restores) e.preventDefault();
    };
    el.addEventListener("beforeinput", refuse);
    return () => el.removeEventListener("beforeinput", refuse);
  }, [open]);
  const change = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target;
    const range = deletedRange(shown, el.value, el.selectionStart);
    if (range) {
      setKept(deleteFrom(kept, range.start, range.end));
      return;
    }
    // (§262) Typed back: the deleted characters, exactly, where they were.
    const typed = insertedRange(shown, el.value, el.selectionStart);
    const back = typed && restoreAt(original, kept, typed.at, typed.text);
    if (back) {
      setKept(back);
      return;
    }
    // Refused: the text stays as it was, the caret where the change began.
    let at = 0;
    while (at < shown.length && shown[at] === el.value[at]) at++;
    el.value = shown;
    el.setSelectionRange(at, at);
  };
  async function send() {
    setBusy(true);
    setErr("");
    try {
      await api("/api/excerpts", { action: "request", submissionId, index, text: excerpt.text });
      fin.finish();
    } catch (e) {
      setErr(errOf(e));
      setBusy(false);
    }
  }
  return (
    <div className="min-w-0 space-y-2" data-excerpt-picker="" data-mistakes-root="">
      {!open && <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>Show an excerpt on your profile</button>}
      {open && (
        <div className="min-w-0 space-y-2 rounded-lg border border-white/10 p-3 text-sm">
          <p className="font-medium text-white">Show an excerpt on your profile</p>
          <p className="text-slate-400">Pick one answer, then delete what you don&apos;t want to show: you can only leave words out (deleted something by accident? Type it back where it was). It&apos;s shown as a plain quote, and the developer allows or denies it.</p>
          <fieldset id={`excerpt-pick-${submissionId}`} className="space-y-1" data-field-group="" data-match="pick one of your answers">
            {choices.map((c) => (
              <label key={c.index} className="flex items-start gap-2">
                <input type="radio" name={`excerpt-${submissionId}`} checked={index === c.index} onChange={() => pick(c.index)} {...lockPick(busy)} />
                <span className="min-w-0 break-words">{c.question}</span>
              </label>
            ))}
          </fieldset>
          {/* (§196) The answer, read-only, with what's left out struck through. */}
          <div className="min-w-0" data-excerpt-original="">
            {/* (Owner, Nov 5, §237) In the shared draggable box: its own scroll, no Show more. (Owner, Nov 5, §256; was a box drawn here by hand) QA's answer box
                (AnswerText: its volt label and volt accent), so it reads as an answer like everywhere else. */}
            <AnswerText id={`excerpt-original-${submissionId}`} label={`Your answer${cut ? " (struck through: what you're leaving out)" : ""}`} name="Your answer" defaultMax={EXCERPT_BOX_MAX} textClassName="whitespace-pre-wrap">
              <div data-excerpt-original-text="">
                {runs.map((r, i) => r.kept ? <span key={i}>{r.text}</span> : <del key={i} className="rounded-sm bg-rose-400/20 text-rose-200/80 decoration-rose-300" data-excerpt-left-out="">{r.text}</del>)}
              </div>
            </AnswerText>
          </div>
          {/* (Owner, Nov 5, §261) While Ask the developer is going through, the excerpt is read-only, and the answer picks and Use original answer are disabled
              (each would change the excerpt on its way). */}
          {/* (§196) Its own limiter (data-typing-limit): it never takes more than the answer, so the paste note "Cut to the N-character limit." never shows here. */}
          <label className="label req" htmlFor={`excerpt-text-${submissionId}`}>The excerpt (delete what you don&apos;t want)</label>
          <textarea id={`excerpt-text-${submissionId}`} ref={box} className="input block min-w-0 max-w-full resize-y overflow-y-auto" style={{ height: TRIM_BOX_SHUT }}
            data-typing-limit="" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} data-excerpt-box="" data-match="an excerpt is|trim the excerpt"
            value={shown} onChange={change} onDrop={(e) => e.preventDefault()} {...lockText(busy)} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-ghost !px-2 !py-0.5 text-xs" disabled={!cut} {...lockPick(busy)} data-excerpt-restore="" onClick={() => setKept(allKept(original))}>Use original answer</button>
          </div>
          {/* (§196) How it will read, when that isn't just the box's text: " … " where a part of the middle was left out. */}
          {excerpt.text !== squash(shown) && (
            <div className="min-w-0 text-xs text-slate-400" data-excerpt-shown-as="">
              <p>Shown as:</p>
              {/* About 4 lines, scrolling inside (not folded: a fold's own "…" would look like a gap). Each gap's " … " stands out. (Owner, Nov 5, §237) In the
                  shared draggable box (6rem at first; was fixed at 4 lines). */}
              <ValueText id={`excerpt-shown-as-${submissionId}`} label="Shown as">
                <span data-excerpt-shown-text="">{excerpt.pieces.map((p, i) => <Fragment key={i}>{i > 0 && <b className="font-semibold text-amber-200" data-excerpt-gap="">{GAP}</b>}{p}</Fragment>)}</span>
              </ValueText>
            </div>
          )}
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
  // (§156) The box and a refusal name the button pressed: Allow or Deny.
  const [pressed, setPressed] = useState<"Allow" | "Deny">("Allow");
  const fin = useFinished(() => { setBusy(false); setBox(null); });
  const decide = async (decision: "allow" | "deny") => {
    setPressed(decision === "deny" ? "Deny" : "Allow");
    setBusy(true);
    setErr("");
    try {
      await api("/api/excerpts", { action: "decide", excerptId, decision, ...(seenAt ? { seenAt } : {}), ...(box ? { confirmed: true, boxAt: box.at } : {}) });
      fin.finish();
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
      {box && <ChangesBox changes={box.changes} press={pressed} />}
      <Err text={err} press={pressed} />
    </div>
  );
}

/** Remove (the tester's own list), with a confirm. (Batch 29 section 30) Only the tester removes an excerpt: the developer's Take down is gone. */
export function ExcerptRemove({ excerptId }: { excerptId: string }) {
  const label = "Remove", body = "It leaves your profile at once.";
  const [err, setErr] = useState("");
  const fin = useFinished();
  return (
    <span className="inline-flex flex-col gap-1">
      <ConfirmButton disabled={fin.done} className="btn-ghost !px-2 !py-0.5 text-xs" title={`${label} this excerpt?`} confirmLabel={label} body={<p>{body}</p>}
        onConfirm={() => api("/api/excerpts", { action: "remove", excerptId }).then(() => fin.finish()).catch((e) => setErr(errOf(e)))}>
        {label}
      </ConfirmButton>
      <Err text={err} press={label} />
    </span>
  );
}
