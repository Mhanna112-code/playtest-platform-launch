"use client";
import { AnswersBox } from "@/components/AnswersBox";
import { AnswerWithAttachments, SetView } from "@/components/AnswerSets";
import { AttachmentList } from "@/components/AttachmentList";
import type { SetItem } from "@/lib/answerSets";

export type DisputedWork =
  | { kind: "submission"; part: "written" | "recording"; setUntil: string | null; items: SetItem[]; notes: string; files: { id: string; filename: string; contentType: string; sizeBytes: number }[] }
  | { kind: "call"; when: string; length: string; rate: string };

/**
 * (Owner, Oct 30, batch 15 section 8) "See the work" on each dispute row (open and decided): the disputed piece exactly as the developer's piece view shows it (the same
 * components): written answers under the questions they answered in batch 10's scroll box, with "Sent for the questions until <date>"; attachments; recordings that play;
 * for a call, its time, length and rate. Admins don't get the developer's test page: this fold is their view.
 */
export function DisputeWork({ work }: { work: DisputedWork | null }) {
  if (!work) return null;
  return (
    <details className="rounded-lg border border-white/10 p-2 text-sm" data-dispute-work="">
      <summary className="fold-chevron cursor-pointer text-slate-300">See the work</summary>
      <div className="mt-2">
        {work.kind === "call" ? (
          <p className="text-slate-300" data-dispute-call="">Live call · {work.when} · {work.length} · {work.rate}</p>
        ) : (
          <AnswersBox>
            {work.part === "written" && work.setUntil && <p className="note" data-set-until="">Sent for the questions until {new Date(work.setUntil).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>}
            {work.part === "written" && <SetView items={work.items} attachments={work.files.map((f) => ({ id: f.id, filename: f.filename, contentType: f.contentType, size: f.sizeBytes }))} />}
            {work.notes && <div className="text-sm"><p className="font-medium text-ink-200">Notes</p><AnswerWithAttachments text={work.notes} attachments={work.files.map((f) => ({ id: f.id, filename: f.filename, contentType: f.contentType, size: f.sizeBytes }))} /></div>}
            <AttachmentList items={work.files} />
          </AnswersBox>
        )}
      </div>
    </details>
  );
}
