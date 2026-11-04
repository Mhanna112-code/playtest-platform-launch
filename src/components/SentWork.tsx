import type { ReactNode } from "react";
import { AnswerWithAttachments } from "@/components/AnswerSets";
import { AttachmentList } from "@/components/AttachmentList";
import { Fold } from "@/components/Panel";
import { ScrollText } from "@/components/ScrollText";
import { ADDED_GENERAL, NEW_QUESTION_TAG, addedCount, addedFiles, addedLabel, additionsOf, writtenThreads, type QuestionThread } from "@/lib/additions";
import { markerIds } from "@/lib/answerAttachments";
import { fmtStampIn } from "@/lib/format";

type File = { id: string; filename: string; contentType: string; sizeBytes: number; part?: string; uploadedAt?: Date | string | null };
const asAttachment = (f: File) => ({ id: f.id, filename: f.filename, size: f.sizeBytes, contentType: f.contentType });

/** (Owner, Nov 3, batch 35 §167; was §136's plain "Added") The small heading above each addition, with when it was added: "Added · Nov 3, 2026, 11:29 PM". */
export function AddedLabel({ at, timeZone }: { at: string; timeZone?: string | null }) {
  return <p className="text-xs font-semibold text-emerald-300" data-added-label="" data-added-at={at}>{addedLabel(fmtStampIn(at, timeZone))}</p>;
}

/** (§167) A long question is cut to 2 lines in its fold's title; the whole question shows inside. */
const LONG_QUESTION = 120;

/**
 * (Owner, Nov 3, batch 35 §136, §167) A sent piece, read wherever sent work is read: Needs you, the update row, the tester rows, the admin's "See the work" and the
 * tester's own page. Never an old and a new version side by side.
 * - Written answers (§167; replaces §136's one list): each question is its own fold, closed at first, titled with the question ("· 2 added" when it has additions;
 *   a "new question" tag on one that came with changed questions). Inside, indented one step: the answer, then each addition to it, oldest first, under
 *   "Added · <date>". Then the notes, the files not placed in an answer, and a last fold "Added (not about one question)" for additions made before §167.
 *   `addTo`: the tester's own page puts its "Add to this answer" box at the end of a question's fold (none for a question no longer asked).
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
  const notesBlock = (text: string) => <div className="text-sm"><p className="font-medium text-ink-200">Notes</p><AnswerWithAttachments text={text} attachments={all} /></div>;
  const addedText = (a: { at: string; text: string; files: string[] }, i: number) => (
    <div key={i} className="space-y-1" data-addition={i}>
      <AddedLabel at={a.at} timeZone={timeZone} />
      {a.text.trim() !== "" && <div className="text-sm [overflow-wrap:anywhere]"><AnswerWithAttachments text={a.text} attachments={all} /></div>}
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
  const { threads, general, extras } = writtenThreads(answers, questions, additions);
  const writtenFiles = first.filter((f) => f.part !== "recording");
  const fold = (t: QuestionThread) => (
    <Fold key={t.key} id={`${id}-q-${t.key}`} defaultOpen={false} jumpOpen={false} className="rounded-lg border border-white/10 px-2 py-1.5" summaryClassName="flex items-start gap-1 !text-sm"
      // The tags go under the question when the line is narrow (a phone), never squeezing it.
      summary={<span className="flex min-w-0 flex-1 flex-wrap items-start gap-x-1">
        <span className="line-clamp-2 min-w-0 flex-1 basis-40 text-slate-200 [overflow-wrap:anywhere]" data-question-title="">{t.question}{t.required && <span aria-label="required"> *</span>}</span>
        {(t.fresh || t.adds.length > 0) && <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
          {t.fresh && <span className="badge border-sky-300/40 text-sky-200" data-new-question="">{NEW_QUESTION_TAG}</span>}
          {t.adds.length > 0 && <span className="text-emerald-300" data-added-count={t.adds.length}>{addedCount(t.adds.length)}</span>}
        </span>}
      </span>}>
      <div className="space-y-2 border-l border-white/10 pl-3" data-question-body={t.key}>
        {t.question.length > LONG_QUESTION && <div className="text-xs text-slate-400" data-set-question=""><ScrollText className="min-w-0" text={t.question} label="Question" /></div>}
        <div className="text-sm" data-set-answer="">{t.answer.trim() ? <AnswerWithAttachments text={t.answer} attachments={all} /> : <p className="text-slate-500" data-no-answer="">(no answer)</p>}</div>
        {t.adds.map(addedText)}
        {addTo?.({ key: t.key, question: t.question })}
      </div>
    </Fold>
  );
  return (
    <div className="space-y-2" data-sent-work="written">
      {threads.map(fold)}
      {notes && notesBlock(notes)}
      {extras.map((x, i) => (
        <div key={i} className="space-y-1" data-set-extra={i}>
          <AddedLabel at={x.at} timeZone={timeZone} />
          {x.notes && notesBlock(x.notes)}
          <AttachmentList items={byId(x.files)} inlineText={[...x.texts, x.notes]} />
        </div>
      ))}
      <AttachmentList items={writtenFiles} inlineText={threads.filter((t) => !t.fresh).map((t) => t.answer)} inlineIds={[...markerIds(notes, uploaded)]} />
      {general.length > 0 && (
        <Fold id={`${id}-q-general`} defaultOpen={false} jumpOpen={false} className="rounded-lg border border-white/10 px-2 py-1.5" summaryClassName="!text-sm"
          summary={<span className="text-slate-200" data-question-title="" data-general-title="">{ADDED_GENERAL}</span>}>
          <div className="space-y-2 border-l border-white/10 pl-3" data-question-body="general">
            {general.map((a, i) => addedText({ at: a.at, text: a.text ?? "", files: a.files }, i))}
          </div>
        </Fold>
      )}
    </div>
  );
}
