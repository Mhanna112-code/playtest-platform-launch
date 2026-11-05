import type { ReactNode } from "react";
import { AnswerWithAttachments } from "@/components/AnswerSets";
import { AttachmentList } from "@/components/AttachmentList";
import { Fold } from "@/components/Panel";
import { ANSWER_LINES, LongText, QuestionTitle } from "@/components/LongText";
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
 * - A recording: the recordings sent first, then each addition under "Added · <date>".
 * `id`: the place's prefix for the folds' ids (kept open or closed in this tab); `timeZone`: the viewer's, for the dates.
 */
export function SentWork({ id = "sent", kind, answers, questions = [], notes, additions, files, timeZone, addTo }: {
  id?: string; kind: string; answers: unknown; questions?: string[]; notes: string; additions: unknown; files: File[]; timeZone?: string | null;
  addTo?: (q: { key: string; question: string }) => ReactNode;
}) {
  const adds = additionsOf(additions);
  const uploaded = files.filter((f) => f.uploadedAt !== null);
  const later = addedFiles(adds);
  const first = uploaded.filter((f) => !later.has(f.id));
  const all = uploaded.map(asAttachment);
  const byId = (ids: string[]) => uploaded.filter((f) => ids.includes(f.id));
  // (Owner, Nov 4, §182) Every answer, addition and note folds the same way (LongText): its first 3 lines, then Show more opening a scroll box about 8 lines tall.
  const answerFold = (text: string, panel: string, label: string) => <LongText text={text} lines={ANSWER_LINES} id={panel} label={label}><AnswerWithAttachments text={text} attachments={all} /></LongText>;
  const notesBlock = (text: string, panel = `${id}-notes`) => <div className="text-sm"><p className="font-medium text-ink-200">Notes</p>{answerFold(text, panel, "Notes")}</div>;
  const addedText = (a: { at: string; text: string; files: string[] }, i: number, panel = `${id}-add-${i}`) => (
    <div key={i} className="space-y-1" data-addition={i}>
      <AddedLabel at={a.at} timeZone={timeZone} />
      {a.text.trim() !== "" && <div className="text-sm [overflow-wrap:anywhere]">{answerFold(a.text, panel, "Added")}</div>}
      <AttachmentList items={byId(a.files)} inlineText={[a.text]} />
    </div>
  );
  if (kind === "recording") {
    return (
      <div className="space-y-2" data-sent-work="recording">
        {notes && notesBlock(notes)}
        <AttachmentList items={first} />
        {adds.map((a, i) => (
          <div key={i} className="space-y-1 border-t border-white/10 pt-2" data-addition={i}>
            <AddedLabel at={a.at} timeZone={timeZone} />
            <AttachmentList items={byId(a.files)} />
          </div>
        ))}
      </div>
    );
  }
  const { threads, other } = writtenThreads(answers, questions, additions);
  const writtenFiles = first.filter((f) => f.part !== "recording");
  const fold = (t: QuestionThread) => (
    <Fold key={t.key} id={`${id}-q-${t.key}`} defaultOpen={false} jumpOpen={false} className="rounded-lg border border-white/10 px-2 py-1.5" summaryClassName="flex items-start gap-1 !text-sm"
      // The tags go under the question when the line is narrow (a phone), never squeezing it.
      summary={<span className="flex min-w-0 flex-1 flex-wrap items-start gap-x-1">
        {/* (Owner, Nov 4, §187) A long question's Show more sits right after it in the title (not alone on a line under it). */}
        <QuestionTitle className="basis-40 text-slate-200" text={t.question}>{t.required && <span aria-label="required"> *</span>}</QuestionTitle>
        {(t.fresh || t.adds.length > 0) && <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
          {t.fresh && <span className="badge border-sky-300/40 text-sky-200" data-new-question="">{NEW_QUESTION_TAG}</span>}
          {t.adds.length > 0 && <span className="text-emerald-300" data-added-count={t.adds.length}>{addedCount(t.adds.length)}</span>}
        </span>}
      </span>}>
      {/* (Owner, Nov 4, §187) One step in: 8px on a phone (each level of a stack at most 8px there). */}
      <div className="space-y-2 border-l border-white/10 pl-2 sm:pl-3" data-question-body={t.key}>
        <div className="text-sm" data-set-answer="">{t.answer.trim() ? answerFold(t.answer, `${id}-q-${t.key}-answer`, "Answer") : <p className="text-slate-500" data-no-answer="">(no answer)</p>}</div>
        {t.adds.map((a, i) => addedText(a, i, `${id}-q-${t.key}-add-${i}`))}
        {addTo?.({ key: t.key, question: t.question })}
      </div>
    </Fold>
  );
  const elseCount = other.length;
  return (
    <div className="space-y-2" data-sent-work="written">
      {threads.map(fold)}
      {/* (Owner, Nov 4, §188) The fixed last spot: Anything else, a fold like a question's, after the last question. */}
      <Fold id={`${id}-q-${ANYTHING_ELSE_KEY}`} defaultOpen={false} jumpOpen={false} className="rounded-lg border border-white/10 px-2 py-1.5" summaryClassName="flex items-start gap-1 !text-sm"
        summary={<span className="flex min-w-0 flex-1 flex-wrap items-start gap-x-1">
          <span className="min-w-0 basis-40 text-slate-200" data-question-title="" data-else-title="">{ANYTHING_ELSE_TITLE}</span>
          {elseCount > 0 && <span className="shrink-0 whitespace-nowrap text-emerald-300" data-added-count={elseCount}>{addedCount(elseCount)}</span>}
        </span>}>
        <div className="space-y-2 border-l border-white/10 pl-2 sm:pl-3" data-question-body={ANYTHING_ELSE_KEY} data-anything-else="">
          {notes.trim() ? <div className="text-sm" data-set-answer="" data-else-original="">{answerFold(notes, `${id}-notes`, ANYTHING_ELSE_TITLE)}</div>
            : !writtenFiles.length && <p className="text-sm text-slate-500" data-no-answer="">(nothing)</p>}
          <AttachmentList items={writtenFiles} inlineText={threads.filter((t) => !t.fresh).map((t) => t.answer)} inlineIds={[...markerIds(notes, uploaded)]} />
          {other.map((o, i) => o.kind === "add" ? addedText(o.add, i, `${id}-else-${i}`) : (
            <div key={i} className="space-y-1" data-set-extra={i}>
              <AddedLabel at={o.set.at} timeZone={timeZone} />
              {o.set.notes && <div className="text-sm [overflow-wrap:anywhere]">{answerFold(o.set.notes, `${id}-extra-${i}-notes`, ANYTHING_ELSE_TITLE)}</div>}
              <AttachmentList items={byId(o.set.files)} inlineText={[...o.set.texts, o.set.notes]} />
            </div>
          ))}
          {addTo?.({ key: ANYTHING_ELSE_KEY, question: ANYTHING_ELSE_TITLE })}
        </div>
      </Fold>
    </div>
  );
}
