import type { ReactNode } from "react";
import { AnswerWithAttachments } from "@/components/AnswerSets";
import { AttachmentList } from "@/components/AttachmentList";
import { Fold } from "@/components/Panel";
import { AnswerText, QuestionText } from "@/components/QA";
import { ANYTHING_ELSE_KEY, ANYTHING_ELSE_TITLE, NEW_QUESTION_TAG, addedCount, addedFiles, addedLabel, additionsOf, additionsUntil, isPastQuestion, writtenThreads, type QuestionThread } from "@/lib/additions";
import { markerIds } from "@/lib/answerAttachments";
import { fmtStampIn } from "@/lib/format";

type File = { id: string; filename: string; contentType: string; sizeBytes: number; part?: string; uploadedAt?: Date | string | null };
const asAttachment = (f: File) => ({ id: f.id, filename: f.filename, size: f.sizeBytes, contentType: f.contentType });

/** (Owner, Nov 3, batch 35 §167; was §136's plain "Added") The small heading above each addition, with when it was added: "Added · Nov 3, 2026, 11:29 PM". */
export function AddedLabel({ at, timeZone }: { at: string; timeZone?: string | null }) {
  return <p className="text-xs font-semibold text-emerald-300" data-added-label="" data-added-at={at}>{addedLabel(fmtStampIn(at, timeZone))}</p>;
}


/**
 * (Owner, Nov 3, batch 35 §136, §167) A sent piece, read wherever sent work is read: Needs you, the update row, the tester rows, the admin's "See the work" and the
 * tester's own page. Never an old and a new version side by side.
 * - Written answers (§167; replaces §136's one list): each question is its own fold, closed at first, titled with the question ("· 2 added" when it has additions;
 *   a "new question" tag on one that came with changed questions). Inside, indented one step: the answer, then each addition to it, oldest first, under
 *   "Added · <date>". (Owner, Nov 4, §188; replaces §167's notes block and last fold "Added (not about one question)") Then ONE fixed last fold, "Anything
 *   else", on every written part: the notes sent with the answers and the files sent first not placed in an answer (its original), then, oldest first, each
 *   addition made there (and the old ones with no question) and each changed-questions send's own notes and loose files, under "Added · <date>".
 *   `addTo`: the tester's own page puts its "Add to this answer" box at the end of a question's fold (none for a question no longer asked), and of Anything else.
 *   (Owner, Nov 5, §223; replaces §182 / §187's LongText fold and the title's own Show more here) Inside a fold: "Question N" and the question's whole text, then
 *   "Answer" and the answer, then each addition under its "Added · <date>", each in its own box that scrolls and drags taller, in the one look for questions and
 *   answers (components/QA.tsx). The fold's title is the question cut at 2 lines with no Show more (the box holds it whole).
 * - A recording: the recordings sent first, then each addition under "Added · <date>".
 * `id`: the place's prefix for the folds' ids (kept open or closed in this tab); `timeZone`: the viewer's, for the dates.
 * (Owner, Nov 5, §226) `until`: only what was sent up to then (the Testers list: the part as last paid); later additions, their files and the questions answered
 * later are left out. `newOnly` (Needs you): only what is new since `newOnly.since` (the last payment; null: never paid, so everything sent is new): the
 * questions answered or added to since then, each with only its new answer or additions; unchanged and still-unanswered questions are left out, and so are the
 * notes and the files sent first once it was paid (Anything else shows only when something new is in it).
 * (Owner, Nov 5, §234) `part`: "current" draws only the contract's current questions (`questions`) and Anything else (the answers panel, Needs you); "past" only
 * the questions no longer in the contract, read-only, with no Anything else and no Add (the "Past questions" box). Without it, every question (the team's view).
 */
export function SentWork({ id = "sent", kind, answers, questions = [], notes, additions, files, timeZone, addTo, until = null, newOnly, part }: {
  id?: string; kind: string; answers: unknown; questions?: string[]; notes: string; additions: unknown; files: File[]; timeZone?: string | null;
  addTo?: (q: { key: string; question: string }) => ReactNode;
  /** (§226) only what was sent up to this time */ until?: Date | string | null; /** (§226) only what is new since this time (null: everything sent) */ newOnly?: { since: Date | string | null };
  /** (§234) only the current questions (and Anything else), or only the past ones */ part?: "current" | "past";
}) {
  const upTo = until ? new Date(until).getTime() : null, after = newOnly?.since ? new Date(newOnly.since).getTime() : null;
  const isNew = (at: string | undefined) => after == null || (!!at && new Date(at).getTime() > after);
  const everything = additionsOf(additions);
  // (§226) The additions this view draws: up to `until`; the files of the ones left out are left out too (never shown as files sent first).
  const shown = additionsUntil(additions, upTo == null ? null : new Date(upTo));
  const adds = additionsOf(shown);
  const uploaded = files.filter((f) => f.uploadedAt !== null);
  const later = addedFiles(everything);
  const first = after == null ? uploaded.filter((f) => !later.has(f.id)) : [];
  const all = uploaded.map(asAttachment);
  const byId = (ids: string[]) => uploaded.filter((f) => ids.includes(f.id));
  // (§223) An answer, an addition or a note in its own box (`panel`: its unique id, which keeps its dragged height).
  const answerBox = (text: string, panel: string, label: ReactNode, name: string) => <AnswerText id={panel} label={label} name={name}><AnswerWithAttachments text={text} attachments={all} /></AnswerText>;
  const addedText = (a: { at: string; text: string; files: string[] }, i: number, panel = `${id}-add-${i}`) => (
    <div key={i} className="space-y-1" data-addition={i}>
      {a.text.trim() !== "" ? answerBox(a.text, panel, <AddedLabel at={a.at} timeZone={timeZone} />, "Added") : <AddedLabel at={a.at} timeZone={timeZone} />}
      <AttachmentList items={byId(a.files)} inlineText={[a.text]} />
    </div>
  );
  if (kind === "recording") {
    return (
      // (Owner, Nov 5, §239; replaces §182's notes block) Recordings carry no notes: an old recording's stored notes are never shown.
      <div className="space-y-2" data-sent-work="recording">
        <AttachmentList items={first} />
        {adds.map((a, i) => isNew(a.at) && (
          <div key={i} className="space-y-1 border-t border-white/10 pt-2" data-addition={i}>
            <AddedLabel at={a.at} timeZone={timeZone} />
            <AttachmentList items={byId(a.files)} />
          </div>
        ))}
      </div>
    );
  }
  const { threads, other } = writtenThreads(answers, questions, shown);
  const writtenFiles = first.filter((f) => f.part !== "recording");
  // (§226) Only the new (newOnly): an answer sent since then (never paid: every answer; paid: a question that came with changed questions since), or an addition
  // since then. A question with neither (unchanged, or still unanswered) is left out.
  const freshAnswer = (t: QuestionThread) => !newOnly || (!!t.answer.trim() && (after == null || (t.fresh && isNew(t.at))));
  const showThread = (t: QuestionThread) => !newOnly || freshAnswer(t) || t.adds.some((a) => isNew(a.at));
  const fold = (t: QuestionThread, n: number) => {
    const newAdds = t.adds.map((a, i) => ({ a, i })).filter(({ a }) => isNew(a.at));
    return (
      <Fold key={t.key} id={`${id}-q-${t.key}`} defaultOpen={false} jumpOpen={false} className="rounded-lg border border-white/10 px-2 py-1.5" summaryClassName="flex items-start gap-1 !text-sm"
        // The tags go under the question when the line is narrow (a phone), never squeezing it.
        summary={<span className="flex min-w-0 flex-1 flex-wrap items-start gap-x-1">
          {/* (Owner, Nov 5, §223; was §187's title with its own Show more) The title: the question cut at 2 lines; its whole text is the first box inside. */}
          <span className="line-clamp-2 min-w-0 flex-1 basis-40 text-slate-200 [overflow-wrap:anywhere]" data-question-title="">{t.question}{t.required && <span aria-label="required"> *</span>}</span>
          {(t.fresh || newAdds.length > 0) && <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
            {t.fresh && <span className="badge border-sky-300/40 text-sky-200" data-new-question="">{NEW_QUESTION_TAG}</span>}
            {newAdds.length > 0 && <span className="text-emerald-300" data-added-count={newAdds.length}>{addedCount(newAdds.length)}</span>}
          </span>}
        </span>}>
        {/* (Owner, Nov 4, §187) One step in: 8px on a phone (each level of a stack at most 8px there). */}
        <div className="space-y-2 border-l border-white/10 pl-2 sm:pl-3" data-question-body={t.key}>
          {/* (§223) The question, whole, in its box; then the answer in its own ("(no answer)" in grey only while nothing was added to it, §222). */}
          <div data-set-question=""><QuestionText id={`${id}-q-${t.key}-question`} label={`Question ${n}`} required={t.required}>{t.question}</QuestionText></div>
          {freshAnswer(t) && (t.answer.trim() || !t.adds.length) && (
            <div data-set-answer="">{t.answer.trim() ? answerBox(t.answer, `${id}-q-${t.key}-answer`, "Answer", "Answer") : <AnswerText id={`${id}-q-${t.key}-answer`} empty />}</div>
          )}
          {newAdds.map(({ a, i }) => addedText(a, i, `${id}-q-${t.key}-add-${i}`))}
          {addTo?.({ key: t.key, question: t.question })}
        </div>
      </Fold>
    );
  };
  const others = other.map((o, i) => ({ o, i })).filter(({ o }) => isNew(o.kind === "add" ? o.add.at : o.set.at));
  // (§234) The current panel leaves the past questions out (they're in the Past questions box); the box draws only them.
  const inPart = (t: QuestionThread) => !part || (part === "past") === isPastQuestion(t.question, questions);
  const hiddenPast = part === "current" && threads.some((t) => !inPart(t) && showThread(t));
  const elseCount = others.length;
  const elseShown = part !== "past" && (!newOnly || elseCount > 0 || (after == null && (!!notes.trim() || writtenFiles.length > 0)));
  const drawn = threads.filter((t) => inPart(t) && showThread(t));
  return (
    <div className="space-y-2" data-sent-work="written">
      {drawn.map((t, n) => fold(t, n + 1))}
      {/* (§234) Needs you never shows a past question: what was sent to one is read in the Testers list's Past questions box. */}
      {newOnly && hiddenPast && <p className="note" data-past-elsewhere="">Answers to past questions are in the Testers list, under Past questions.</p>}
      {newOnly && !drawn.length && !hiddenPast && !elseShown && <p className="note" data-nothing-new="">Nothing new since you paid.</p>}
      {/* (Owner, Nov 4, §188) The fixed last spot: Anything else, a fold like a question's, after the last question. */}
      {elseShown && <Fold id={`${id}-q-${ANYTHING_ELSE_KEY}`} defaultOpen={false} jumpOpen={false} className="rounded-lg border border-white/10 px-2 py-1.5" summaryClassName="flex items-start gap-1 !text-sm"
        summary={<span className="flex min-w-0 flex-1 flex-wrap items-start gap-x-1">
          <span className="min-w-0 flex-1 basis-40 text-slate-200" data-question-title="" data-else-title="">{ANYTHING_ELSE_TITLE}</span>
          {elseCount > 0 && <span className="shrink-0 whitespace-nowrap text-emerald-300" data-added-count={elseCount}>{addedCount(elseCount)}</span>}
        </span>}>
        <div className="space-y-2 border-l border-white/10 pl-2 sm:pl-3" data-question-body={ANYTHING_ELSE_KEY} data-anything-else="">
          {after == null && (notes.trim() ? <div data-set-answer="" data-else-original="">{answerBox(notes, `${id}-notes`, "Notes", ANYTHING_ELSE_TITLE)}</div>
            : !writtenFiles.length && <p className="text-sm text-slate-500" data-no-answer="">(nothing)</p>)}
          <AttachmentList items={writtenFiles} inlineText={threads.filter((t) => !t.fresh).map((t) => t.answer)} inlineIds={[...markerIds(notes, uploaded)]} />
          {others.map(({ o, i }) => o.kind === "add" ? addedText(o.add, i, `${id}-else-${i}`) : (
            <div key={i} className="space-y-1" data-set-extra={i}>
              {o.set.notes ? answerBox(o.set.notes, `${id}-extra-${i}-notes`, <AddedLabel at={o.set.at} timeZone={timeZone} />, ANYTHING_ELSE_TITLE) : <AddedLabel at={o.set.at} timeZone={timeZone} />}
              <AttachmentList items={byId(o.set.files)} inlineText={[...o.set.texts, o.set.notes]} />
            </div>
          ))}
          {addTo?.({ key: ANYTHING_ELSE_KEY, question: ANYTHING_ELSE_TITLE })}
        </div>
      </Fold>}
    </div>
  );
}
