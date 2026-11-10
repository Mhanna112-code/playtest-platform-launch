import { FieldLabel, FieldValue } from "@/components/FieldLines";
import { AnswerText, QuestionTexts } from "@/components/QA";
import { AddedLabel, SentAnswer } from "@/components/SentWork";
import { fmtStampIn } from "@/lib/format";
import type { QuestionsChange } from "@/lib/questionHistory";

type File = { id: string; filename: string; contentType: string; sizeBytes: number; uploadedAt?: Date | string | null };

/** (Owner, Nov 5, §263) The entry's line: "Questions changed <date/time>". */
export const questionsChangedLine = (when: string) => `Questions changed ${when}`;
/** (§263) The label over an unsent draft in Then (the tester's side only). */
export const DRAFT_NOT_SENT = "Draft (not sent)";

/**
 * (Owner, Nov 5, batch 35 §263, final) One Terms history entry for a change of the tester's questions, like the other then → now entries: its line, then a
 * drop-down with Then (the questions as they were, each its own drop-down: the question box, then what this tester had for it at that moment, in answer boxes:
 * the sent answer and each addition, the unsent draft "Draft (not sent)" ((Owner, Nov 10, §371) under the sent answer when there are both), or "(no answer)")
 * and Now (the questions it changed to). Both lists are QA.tsx's
 * QuestionTexts ("Questions (N)", a draggable scroll panel). File markers are drawn as in the written answers (SentAnswer) from `files`: the part's uploads on
 * the developer's side; on the tester's side also their uploaded, unsent files (a draft's). The developer's entries are built without drafts.
 */
export function QuestionsChangedEntry({ id, change, files, timeZone }: { id: string; change: QuestionsChange; files: File[]; timeZone?: string | null }) {
  const when = fmtStampIn(change.at, timeZone);
  return (
    <li data-history-line="" data-questions-changed={change.at}>
      {questionsChangedLine(when)}
      <details className="ml-3 text-xs text-slate-400"><summary className="cursor-pointer">Then and now</summary>
        <div className="mt-1" data-history-then=""><FieldLabel>Then</FieldLabel><FieldValue><QuestionTexts id={`${id}-then`} items={change.then.map((q, i) => ({
          text: q.question, required: q.required,
          extra: q.sent || q.draft ? (
            <>
              {q.sent && <>
                {q.sent.answer.trim() ? <SentAnswer id={`${id}-then-${i}-answer`} label="Answer" name="Answer" text={q.sent.answer} files={files} /> : <AnswerText id={`${id}-then-${i}-answer`} empty />}
                {q.sent.adds.map((a, j) => a.text.trim()
                  ? <SentAnswer key={j} id={`${id}-then-${i}-add-${j}`} label={<AddedLabel at={a.at} timeZone={timeZone} />} name="Added" text={a.text} files={files} />
                  : <AddedLabel key={j} at={a.at} timeZone={timeZone} />)}
              </>}
              {q.draft && <div data-history-draft=""><SentAnswer id={`${id}-then-${i}-draft`} label={DRAFT_NOT_SENT} name={DRAFT_NOT_SENT} text={q.draft} files={files} /></div>}
            </>
          ) : <AnswerText id={`${id}-then-${i}-answer`} empty />,
        }))} /></FieldValue></div>
        <div className="mt-1" data-history-now=""><FieldLabel>Now</FieldLabel><FieldValue><QuestionTexts id={`${id}-now`} items={change.now.map((q) => ({ text: q.question, required: q.required }))} /></FieldValue></div>
      </details>
    </li>
  );
}
