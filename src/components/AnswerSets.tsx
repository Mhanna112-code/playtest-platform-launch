import { Formatted } from "@/components/Formatted";
import { ScrollText } from "@/components/ScrollText";
import { fmtDate } from "@/lib/format";
import type { PrevSet, SetItem } from "@/lib/answerSets";

/** (Owner, Oct 29, batch 13 section 8) One set of written answers, each under the question it answered (in full). */
export function SetView({ items }: { items: SetItem[] }) {
  return (
    <>
      {items.map((it, i) => (
        <div key={i} className="text-sm" data-set-item="">
          <div className="font-medium text-ink-200"><ScrollText text={it.question} label="Question" />{!it.required && <span className="ml-1 font-normal text-ink-500">· not required</span>}</div>
          {it.answer.trim() ? <Formatted text={it.answer} /> : <p className="text-slate-500">(no answer)</p>}
        </div>
      ))}
    </>
  );
}

/** "Previous questions and answers (until <date>)": a read-only fold per earlier set, newest first. */
export function PrevSetFolds({ sets }: { sets: PrevSet[] }) {
  if (!sets.length) return null;
  return (
    <div className="space-y-2" data-prev-sets="">
      {sets.map((s, i) => (
        <details key={i} className="rounded-lg border border-white/[0.08] p-2 text-sm" data-prev-set={s.until}>
          <summary className="cursor-pointer text-slate-300">Previous questions and answers (until {fmtDate(new Date(s.until))})</summary>
          <div className="mt-2 max-h-[24rem] space-y-2 overflow-y-auto pr-1"><SetView items={s.items} /></div>
        </details>
      ))}
    </div>
  );
}
