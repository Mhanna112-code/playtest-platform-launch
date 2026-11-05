import { Formatted } from "@/components/Formatted";
import { ANSWER_LINES, LongText, QUESTION_LINES } from "@/components/LongText";
import { fileSize, fmtDateIn } from "@/lib/format";
import { RecordingVideo } from "@/components/RecordingVideo";
import { versionsOf, type PrevSet, type SetItem } from "@/lib/answerSets";
import { markerPattern, refOf, resolveMarker, type AnswerAttachment } from "@/lib/answerAttachments";
import React, { type ReactNode } from "react";

/**
 * (Owner, Oct 29, batch 13 section 8) One set of written answers, each under the question it answered (in full). (Batch 26 section 15) The question is a small grey
 * label above its answer (a Required one marked), the answer in normal text indented under it, "(no answer)" in grey for an empty one; long ones keep their scroll
 * boxes. The same everywhere a set shows: the piece view, the tester's page, "Previous questions and answers" and the team's "See the work".
 */
export function SetView({ items, attachments = [] }: { items: SetItem[]; attachments?: AnswerAttachment[] }) {
  return (
    <>
      {items.map((it, i) => (
        <div key={i} className="space-y-0.5 text-sm" data-set-item="">
          {/* (Owner, Nov 4, §182) The shared long-text fold: the question's first 2 lines, the answer's first 3, each with Show more when there's more. */}
          <div className="flex items-start gap-0.5 text-xs text-slate-400" data-set-question=""><LongText inline className="flex-1" text={it.question} lines={QUESTION_LINES} label="Question" />{it.required && <span className="shrink-0" aria-label="required"> *</span>}</div>
          <div className="border-l border-white/10 pl-3" data-set-answer="">{it.answer.trim() ? <LongText text={it.answer} lines={ANSWER_LINES} label="Answer"><AnswerWithAttachments text={it.answer} attachments={attachments} /></LongText> : <p className="text-slate-500" data-no-answer="">(no answer)</p>}</div>
        </div>
      ))}
    </>
  );
}

/**
 * Render the stored marker in place while retaining plain text in the answer box. (Batch 35 §4) The short marker "[📎 map.png #k3f9]" is resolved against these
 * uploads by its tag; the old long form "[[attachment:<id>|map.png]]" by its id.
 */
export function AnswerWithAttachments({ text, attachments, onRemove }: { text: string; attachments: AnswerAttachment[]; onRemove?: (id: string) => void }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(markerPattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(<Formatted key={`text-${last}`} text={text.slice(last, index)} className="text-slate-200" />);
    const a = resolveMarker(refOf(match), attachments);
    if (a) parts.push(<span key={`file-${index}`} className="inline-flex max-w-full items-center align-middle gap-1">{a.contentType.startsWith("image/") ? <a href={`/api/recordings/${a.id}/file`} target="_blank" rel="noreferrer"><img src={`/api/recordings/${a.id}/file`} alt={a.filename} className="max-h-48 max-w-full rounded object-contain" /></a> : a.contentType.startsWith("video/") ? <RecordingVideo className="max-h-48 max-w-full" src={`/api/recordings/${a.id}/file`} /> : <a className="rounded border border-white/15 px-2 py-1 text-xs" href={`/api/recordings/${a.id}/file`} target="_blank" rel="noreferrer">{a.filename} · {fileSize(a.size)}</a>}{onRemove && <button type="button" aria-label={`Remove ${a.filename}`} className="btn-ghost px-1" onClick={() => onRemove(a.id)}>×</button>}</span>);
    else parts.push(<span key={`missing-${index}`} className="text-slate-400">[file]</span>);
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(<Formatted key="tail" text={text.slice(last)} className="text-slate-200" />);
  return <div className="space-y-1" data-answer-renderer="">{parts}</div>;
}

/** "Previous questions and answers (until <date>)": a read-only fold per earlier set, newest first. */
// (Owner, Oct 30, batch 15 section 14) The tester's sets say whether each version was sent or a draft: "Sent <date>" first, then "Draft (not sent)", each a read-only
// fold. The developer's sets (`developer`) only ever hold what was sent.
export function PrevSetFolds({ sets: all, sentPart = true, developer = false, attachments = [], timeZone, draftsOnly = false }: { timeZone?: string | null; sets: PrevSet[]; sentPart?: boolean; developer?: boolean; attachments?: AnswerAttachment[]; /** (batch 35 §136) only unsent drafts: what was sent shows once, in the part's own list */ draftsOnly?: boolean }) {
  const sets = draftsOnly ? all.flatMap((s) => { const v = versionsOf(s, sentPart).filter((x) => x.kind === "draft"); return v.length ? [{ ...s, versions: v }] : []; }) : all;
  if (!sets.length) return null;
  return (
    <div className="space-y-2" data-prev-sets="">
      {sets.map((s, i) => {
        const versions = developer ? [{ kind: "sent" as const, items: s.items }] : versionsOf(s, sentPart);
        return (
          <details key={i} className="rounded-lg border border-white/[0.08] p-2 text-sm" data-prev-set={s.until}>
            <summary className="cursor-pointer text-slate-300">Previous questions and answers (until {fmtDateIn(s.until, timeZone)})</summary>
            <div className="mt-2 space-y-2">
              {versions.map((v, j) => (
                <details key={j} open={versions.length === 1} className="rounded-md border border-white/[0.06] p-2" data-prev-version={v.kind}>
                  <summary className="cursor-pointer text-xs font-medium text-slate-300">{v.kind === "sent" ? `Sent${v.at ? ` ${fmtDateIn(v.at, timeZone)}` : ""}` : "Draft (not sent)"}</summary>
                  <div className="mt-2 max-h-[24rem] space-y-2 overflow-y-auto pr-1"><SetView items={v.items} attachments={attachments} /></div>
                </details>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}
