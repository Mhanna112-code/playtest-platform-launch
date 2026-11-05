import { Cut } from "@/components/Cut";
import { HelpCircle, MessageSquareText } from "lucide-react";
import { fmtDateTimeIn, money } from "@/lib/format";
import type { QuestionBlock } from "@/lib/byQuestion";
import { AnswerWithAttachments } from "@/components/AnswerSets";
import { AnswerText, QuestionText } from "@/components/QA";
import { Fold, ResizeBox } from "@/components/Panel";
import { ANYTHING_ELSE_TITLE } from "@/lib/additions";
import { QuestionSearch } from "./QuestionSearch";

const STATUS = { paid: "border-emerald-400/40 text-emerald-200", rejected: "border-rose-400/40 text-rose-200", waiting: "border-amber-300/40 text-amber-200" } as const;

/** (§152) A short, stable key for a question's text (its fold and its answers panel keep their state by it, even when other questions are added or removed). */
export function questionKey(title: string) {
  let h = 5381;
  for (let i = 0; i < title.length; i++) h = ((h * 33) ^ title.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * The full app's "By question" fold under the testers: each question with everyone's answer, side by side. (Owner, Nov 3, batch 35 §152) A "Search questions" box
 * above the list; the list in the draggable panel; each question its own fold (closed at first, kept open or closed through the live redraws): closed, the question,
 * "required" and "N answers"; open, its answers in a panel of their own.
 */
export function ByQuestion({ testId, blocks, timeZone }: { testId: string; timeZone?: string | null; blocks: QuestionBlock[] }) {
  return (
    <details id="by-question" className="scroll-mt-24 rounded-xl border border-white/[0.08] p-3">
      <summary className="fold-chevron cursor-pointer font-medium text-white">By question</summary>
      <div className="mt-3 space-y-4">
        {blocks.length === 0 && <p className="card py-10 text-center text-slate-400">No answers yet.</p>}
        {blocks.length > 0 && <QuestionSearch testId={testId} items={blocks.map((b, n) => {
          const Icon = b.title === ANYTHING_ELSE_TITLE ? MessageSquareText : HelpCircle;
          const key = questionKey(b.title);
          return {
            key, title: b.title, node: (
              <section className="rounded-lg border border-white/10 p-2" data-question-block={key}>
                <Fold id={`bq-${testId}-${key}`} defaultOpen={false} summaryClassName="!text-base" summary={
                  <span className="inline-flex min-w-0 max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 align-middle font-semibold text-white">
                    <Icon className={`h-5 w-5 shrink-0 ${b.title === ANYTHING_ELSE_TITLE ? "text-slate-300" : "text-indigo-300"}`} /> {/* (Owner, Nov 4, §182) The question's first 2 lines in the title; a longer one gets Show more inside, opening the whole question (the shared fold). */}
                    {/* (Owner, Nov 5, §223; was §187's title with its own Show more) The question cut at 2 lines; its whole text is the first box inside. */}
                    <span className="line-clamp-2 min-w-0 flex-1 basis-40 [overflow-wrap:anywhere]" data-question-title="">{b.title}</span>
                    {/* (Batch 26 section 14) Not required is the default: only a Required question is marked. */}
                    {b.required && <span data-required="" className="badge border-white/15 text-xs font-normal text-slate-400">required</span>}
                    <span className="text-sm font-normal text-slate-500">{b.answers.length} answer{b.answers.length === 1 ? "" : "s"}</span>
                  </span>
                }>
                  {/* (§223) The question whole, in the one look for questions (components/QA.tsx); Anything else isn't a question. */}
                  {b.title !== ANYTHING_ELSE_TITLE && <div className="mb-2" data-set-question=""><QuestionText id={`bq-${testId}-${key}-question`} label={`Question ${n + 1}`} required={b.required}>{b.title}</QuestionText></div>}
                  <ResizeBox id={`by-question-${testId}-${key}`} label={`Answers to “${b.title.slice(0, 60)}”`}>
                    <ul className="divide-y divide-white/5">
                      {b.answers.map((a) => (
                        <li key={a.contractId} className="flex flex-col gap-1.5 py-2.5 text-sm sm:flex-row sm:gap-3">
                          <span className="space-y-1 sm:w-32 sm:shrink-0">
                            <a href={`#tester-${a.contractId}`} className="block text-slate-400 no-underline hover:text-white"><Cut text={a.tester} /></a>
                            <span className="block text-xs text-slate-500">{fmtDateTimeIn(a.sentAt, timeZone)}</span>
                            <span className={`badge text-xs ${STATUS[a.status]}`}>{a.status === "paid" ? `Paid ${money(a.paidCents)}` : a.status === "rejected" ? "Rejected" : "Not reviewed yet"}</span>
                          </span>
                          {/* (§223; was §182's Show more) Each answer in its own box with the accent border (the tester's name above it on a phone, beside it wider). */}
                          <div className="min-w-0 flex-1" data-set-answer=""><AnswerText id={`bq-${testId}-${key}-${a.contractId}`} name={`${a.tester}'s answer`}><AnswerWithAttachments text={a.text} attachments={a.attachments ?? []} /></AnswerText></div>
                        </li>
                      ))}
                    </ul>
                  </ResizeBox>
                </Fold>
              </section>
            ),
          };
        })} />}
      </div>
    </details>
  );
}
