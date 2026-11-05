import type { ReactNode } from "react";
import { AnswerWithAttachments } from "@/components/AnswerSets";
import { AttachmentList } from "@/components/AttachmentList";
import { Fold } from "@/components/Panel";
import { AnswerText, QuestionText } from "@/components/QA";
import { ANSWER_LINES, LongText } from "@/components/LongText";
import { ANYTHING_ELSE_KEY, ANYTHING_ELSE_TITLE, NEW_QUESTION_TAG, addedCount, addedFiles, addedLabel, additionsOf, writtenThreads, type QuestionThread } from "@/lib/additions";
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
 * later are left out. `since`: only what is new after then (Needs you): the questions answered or added to after it, each with only its new answer or additions;
 * unchanged and still-unanswered questions, the notes and the files sent first are left out (Anything else shows only when something new is in it).
 */
export function SentWork({ id = "sent", kind, answers, questions = [], notes, additions, files, timeZone, addTo, until = null, since = null }: {
  id?: string; kind: string; answers: unknown; questions?: string[]; notes: string; additions: unknown; files: File[]; timeZone?: string | null;
  addTo?: (q: { key: string; question: string }) => ReactNode;
  /** (§226) only what was sent up to this time */ until?: Date | string | null; /** (§226) only what is new after this time */ since?: Date | string | null;
}) {
  const upTo = until ? new Date(until).getTime() : null, after = since ? new Date(since).getTime() : null;
  const isNew = (at: string | undefined) => after == null || (!!at && new Date(at).getTime() > after);
  const everything = additionsOf(additions);
  // (§226) The additions this view draws: up to `until`; the files of the ones left out are left out too (never shown as files sent first).
  const shown = upTo == null ? additions : (Array.isArray(additions) ? additions : []).filter((x) => {
    const at = (x as { at?: unknown } | null)?.at;
    return typeof at === "string" && new Date(at).getTime() <= upTo;
  });
  const adds = additionsOf(shown);
  const uploaded = files.filter((f) => f.uploadedAt !== null);
  const later = addedFiles(everything);
  const first = after == null ? uploaded.filter((f) => !later.has(f.id)) : [];
  const all = uploaded.map(asAttachment);
  const byId = (ids: string[]) => uploaded.filter((f) => ids.includes(f.id));
  // (Owner, Nov 4, §182) A recording's notes fold with LongText: its first 3 lines, then Show more opening a scroll box about 8 lines tall.
  const notesBlock = (text: string, panel = `${id}-notes`) => (
    <div className="text-sm"><p className="font-medium text-ink-200">Notes</p><LongText text={text} lines={ANSWER_LINES} id={panel} label="Notes"><AnswerWithAttachments text={text} attachments={all} /></LongText></div>
  );
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
      <div className="space-y-2" data-sent-work="recording">
        {after == null && notes && notesBlock(notes)}
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
  // (§226) Only the new: a question answered after `since` (it came with changed questions, or its first answer), or added to after it.
  const freshAnswer = (t: QuestionThread) => t.fresh && !!t.answer.trim() && isNew(t.at);
  const showThread = (t: QuestionThread) => after == null || freshAnswer(t) || t.adds.some((a) => isNew(a.at));
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
          {(after == null || freshAnswer(t)) && (t.answer.trim() || !t.adds.length) && (
            <div data-set-answer="">{t.answer.trim() ? answerBox(t.answer, `${id}-q-${t.key}-answer`, "Answer", "Answer") : <AnswerText id={`${id}-q-${t.key}-answer`} empty />}</div>
          )}
          {newAdds.map(({ a, i }) => addedText(a, i, `${id}-q-${t.key}-add-${i}`))}
          {addTo?.({ key: t.key, question: t.question })}
        </div>
      </Fold>
    );
  };
  const others = other.map((o, i) => ({ o, i })).filter(({ o }) => isNew(o.kind === "add" ? o.add.at : o.set.at));
  const elseCount = others.length;
  const elseShown = after == null || elseCount > 0;
  return (
    <div className="space-y-2" data-sent-work="written">
      {threads.map((t, n) => showThread(t) && fold(t, n + 1))}
      {after != null && !threads.some(showThread) && !elseShown && <p className="note" data-nothing-new="">Nothing new since you paid.</p>}
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
