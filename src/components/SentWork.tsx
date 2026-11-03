import { AnswerWithAttachments, SetView } from "@/components/AnswerSets";
import { AttachmentList } from "@/components/AttachmentList";
import { ADDED_LABEL, addedFiles, additionsOf } from "@/lib/additions";
import { itemsOf, type SetItem } from "@/lib/answerSets";
import { markerIds } from "@/lib/answerAttachments";

type File = { id: string; filename: string; contentType: string; sizeBytes: number; part?: string; uploadedAt?: Date | string | null };
const asAttachment = (f: File) => ({ id: f.id, filename: f.filename, size: f.sizeBytes, contentType: f.contentType });

/** The small "Added" heading above each addition (no time: the part's header line has the latest one). */
export function AddedLabel() {
  return <p className="text-xs font-semibold text-emerald-300" data-added-label="">{ADDED_LABEL}</p>;
}

/**
 * (Owner, Nov 3, batch 35 §136) A sent piece as ONE list: what was sent first, then each addition under it, headed "Added". Never an old and a new version side by
 * side. Used everywhere sent work is read: Needs you, the tester rows, the admin's "See the work" and the tester's own page.
 * Written answers: the answers under their questions, the notes and the files; an addition is more text (with its files) or the answers to changed questions.
 * A recording: the recordings sent first, then the ones added.
 */
export function SentWork({ kind, answers, questions = [], notes, additions, files }: { kind: string; answers: unknown; questions?: string[]; notes: string; additions: unknown; files: File[] }) {
  const adds = additionsOf(additions);
  const uploaded = files.filter((f) => f.uploadedAt !== null);
  const later = addedFiles(adds);
  const first = uploaded.filter((f) => !later.has(f.id));
  const all = uploaded.map(asAttachment);
  const byId = (ids: string[]) => uploaded.filter((f) => ids.includes(f.id));
  if (kind === "recording") {
    return (
      <div className="space-y-2" data-sent-work="recording">
        {notes && <div className="text-sm"><p className="font-medium text-ink-200">Notes</p><AnswerWithAttachments text={notes} attachments={all} /></div>}
        <AttachmentList items={first} />
        {adds.map((a, i) => (
          <div key={i} className="space-y-1 border-t border-white/10 pt-2" data-addition={i}>
            <AddedLabel />
            <AttachmentList items={byId(a.files)} />
          </div>
        ))}
      </div>
    );
  }
  const items: SetItem[] = itemsOf(answers, questions);
  const writtenFiles = first.filter((f) => f.part !== "recording");
  return (
    <div className="space-y-2" data-sent-work="written">
      <SetView items={items} attachments={all} />
      {notes && <div className="text-sm"><p className="font-medium text-ink-200">Notes</p><AnswerWithAttachments text={notes} attachments={all} /></div>}
      <AttachmentList items={writtenFiles} inlineText={items.map((it) => it.answer)} inlineIds={[...markerIds(notes, uploaded)]} />
      {adds.map((a, i) => (
        <div key={i} className="space-y-2 border-t border-white/10 pt-2" data-addition={i}>
          <AddedLabel />
          {a.items && <SetView items={a.items} attachments={all} />}
          {a.notes && <div className="text-sm"><p className="font-medium text-ink-200">Notes</p><AnswerWithAttachments text={a.notes} attachments={all} /></div>}
          {a.text != null && a.text.trim() !== "" && <div className="text-sm [overflow-wrap:anywhere]"><AnswerWithAttachments text={a.text} attachments={all} /></div>}
          <AttachmentList items={byId(a.files)} inlineText={[a.text ?? "", ...(a.items ?? []).map((x) => x.answer), a.notes ?? ""]} />
        </div>
      ))}
    </div>
  );
}
