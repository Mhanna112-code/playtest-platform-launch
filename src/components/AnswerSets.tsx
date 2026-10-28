import { Formatted } from "@/components/Formatted";
import { ScrollText } from "@/components/ScrollText";
import { fmtDate } from "@/lib/format";
import { versionsOf, type PrevSet, type SetItem } from "@/lib/answerSets";

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
// (Owner, Oct 30, batch 15 section 14) The tester's sets say whether each version was sent or a draft: "Sent <date>" first, then "Draft (not sent)", each a read-only
// fold. The developer's sets (`developer`) only ever hold what was sent.
export function PrevSetFolds({ sets, sentPart = true, developer = false }: { sets: PrevSet[]; sentPart?: boolean; developer?: boolean }) {
  if (!sets.length) return null;
  return (
    <div className="space-y-2" data-prev-sets="">
      {sets.map((s, i) => {
        const versions = developer ? [{ kind: "sent" as const, items: s.items }] : versionsOf(s, sentPart);
        return (
          <details key={i} className="rounded-lg border border-white/[0.08] p-2 text-sm" data-prev-set={s.until}>
            <summary className="cursor-pointer text-slate-300">Previous questions and answers (until {fmtDate(new Date(s.until))})</summary>
            <div className="mt-2 space-y-2">
              {versions.map((v, j) => (
                <details key={j} open={versions.length === 1} className="rounded-md border border-white/[0.06] p-2" data-prev-version={v.kind}>
                  <summary className="cursor-pointer text-xs font-medium text-slate-300">{v.kind === "sent" ? `Sent${v.at ? ` ${fmtDate(new Date(v.at))}` : ""}` : "Draft (not sent)"}</summary>
                  <div className="mt-2 max-h-[24rem] space-y-2 overflow-y-auto pr-1"><SetView items={v.items} /></div>
                </details>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}
