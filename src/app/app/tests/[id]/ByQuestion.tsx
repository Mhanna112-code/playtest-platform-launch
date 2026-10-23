import { HelpCircle, MessageSquareText } from "lucide-react";
import { fmtDateTime, money } from "@/lib/format";
import type { QuestionBlock } from "@/lib/byQuestion";

const STATUS = { paid: "border-emerald-400/40 text-emerald-200", rejected: "border-rose-400/40 text-rose-200", waiting: "border-amber-300/40 text-amber-200" } as const;

/** The full app's "By question" fold under the testers: each question with everyone's answer, side by side. */
export function ByQuestion({ blocks }: { blocks: QuestionBlock[] }) {
  return (
    <details id="by-question" className="scroll-mt-24 rounded-xl border border-white/[0.08] p-3">
      <summary className="fold-chevron cursor-pointer font-medium text-white">By question</summary>
      <div className="mt-3 space-y-4">
        {blocks.length === 0 && <p className="card py-10 text-center text-slate-400">No answers yet.</p>}
        {blocks.map((b) => {
          const Icon = b.title === "Other notes" ? MessageSquareText : HelpCircle;
          return (
            <section key={b.title} className="card space-y-3">
              <h3 className="flex flex-wrap items-center gap-2 font-semibold text-white">
                <Icon className={`h-5 w-5 ${b.title === "Other notes" ? "text-slate-300" : "text-indigo-300"}`} /> {b.title}
                {b.notRequired && <span data-not-required="" className="badge border-white/15 text-xs font-normal text-slate-400">not required</span>}
                <span className="text-sm font-normal text-slate-500">{b.answers.length} answer{b.answers.length === 1 ? "" : "s"}</span>
              </h3>
              <ul className="divide-y divide-white/5">
                {b.answers.map((a) => (
                  <li key={a.contractId} className="flex gap-3 py-2.5 text-sm">
                    <span className="w-32 shrink-0 space-y-1">
                      <a href={`#tester-${a.contractId}`} className="block text-slate-400 no-underline hover:text-white">{a.tester}</a>
                      <span className="block text-xs text-slate-500">{fmtDateTime(a.sentAt)}</span>
                      <span className={`badge text-xs ${STATUS[a.status]}`}>{a.status === "paid" ? `Paid ${money(a.paidCents)}` : a.status === "rejected" ? "Rejected" : "Not reviewed yet"}</span>
                    </span>
                    <p className="min-w-0 whitespace-pre-wrap break-words text-slate-200">{a.text}</p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </details>
  );
}
