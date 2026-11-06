import { Formatted } from "@/components/Formatted";
import { AnswerText, QuestionText } from "@/components/QA";
import { fileSize } from "@/lib/format";
import { RecordingVideo } from "@/components/RecordingVideo";
import type { SetItem } from "@/lib/answerSets";
import { markerPattern, refOf, resolveMarker, type AnswerAttachment } from "@/lib/answerAttachments";
import React, { type ReactNode } from "react";

/**
 * (Owner, Oct 29, batch 13 section 8) One set of written answers, each under the question it answered (in full). (Batch 26 section 15) The question is a small grey
 * label above its answer (a Required one marked), the answer in normal text indented under it, "(no answer)" in grey for an empty one; long ones keep their scroll
 * boxes. The same everywhere a set shows: the piece view, the tester's page, "Previous questions and answers" and the team's "See the work".
 * (Owner, Nov 5, §223; replaces §182's long-text folds here) The one look for questions and answers (components/QA.tsx): "Question N" and its text in a quiet
 * box ("Required" a small tag), then "Answer" and the answer in its own box with the accent border, each scrolling and dragging taller. `id`: unique on the page.
 */
export function SetView({ id = "set", items, attachments = [] }: { id?: string; items: SetItem[]; attachments?: AnswerAttachment[] }) {
  return (
    <>
      {items.map((it, i) => (
        <div key={i} className="space-y-1.5 text-sm" data-set-item="">
          <div data-set-question=""><QuestionText id={`${id}-${i}-question`} label={`Question ${i + 1}`} required={it.required}>{it.question}</QuestionText></div>
          <div data-set-answer="">
            <AnswerText id={`${id}-${i}-answer`} empty={!it.answer.trim()}><AnswerWithAttachments text={it.answer} attachments={attachments} /></AnswerText>
          </div>
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

// (Owner, Nov 5, §254) PrevSetFolds ("Previous questions and answers (until <date>)", a read-only fold per earlier set) is gone: its last place was the Past
// questions box, which now shows an answer sent in an earlier set that no thread holds as one more past question (SentWork's `earlier`).
