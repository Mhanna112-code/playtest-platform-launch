import { money } from "@/lib/format";
import { QuestionList } from "@/components/QuestionList";
import { ScrollText } from "@/components/ScrollText";
import { qText } from "@/lib/questions";

export type ChangeEntry = {
  id: string;
  at: string;
  fields: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  effects: string;
  chose: { switched: { name: string; contractId: string; left: boolean }[]; kept: { name: string; contractId: string; left: boolean }[]; undecided: { name: string; contractId: string; left: boolean }[] };
};

const NAMES: Record<string, string> = {
  productName: "Product name", title: "Title", writtenCents: "Written answers", recordingCents: "Recording", liveRateCents: "Live call rate", liveMinutes: "Call length",
  writtenRequired: "Written answers required", recordingRequired: "Recording required", liveRequired: "Live call required", deadlineDays: "Deadline", questions: "Questions", ndaText: "NDA",
};

/** One field's value, as the offer box shows it. */
function Value({ field, v }: { field: string; v: unknown }) {
  if (field === "questions") return <QuestionList items={Array.isArray(v) ? (v as unknown[]).map((q) => qText(q as string)) : []} />;
  if (field === "ndaText") return typeof v === "string" && v ? <ScrollText text={v} lines={4} className="text-slate-300" /> : <span>none</span>;
  if (field.endsWith("Cents")) return <span>{v == null ? "not listed" : `${money(v as number)}${field === "liveRateCents" ? "/h" : ""}`}</span>;
  if (field.endsWith("Required")) return <span>{v ? "Required" : "Not required"}</span>;
  if (field === "liveMinutes") return <span>{v == null ? "none" : `${v} min`}</span>;
  if (field === "deadlineDays") return <span>{String(v)} days</span>;
  return <span>{v == null || v === "" ? "none" : `“${String(v)}”`}</span>;
}

const People = ({ list }: { list: ChangeEntry["chose"]["switched"] }) => (
  <>{list.map((p, i) => <span key={p.contractId}>{i > 0 && ", "}<a href={`#tester-${p.contractId}`}>{p.name}</a>{p.left && " (left)"}</span>)}</>
);

/**
 * (Owner, Oct 30, batch 15 section 43) The developer's "Contract changes" panel (folded, after Testers): one entry per Save that changed the terms or the names, newest
 * first: when and what, before → after (the offer box's displays), who switched / kept / hasn't decided, and the Save's effects on others. Scrolls when long.
 */
export function ContractChanges({ entries, fmt }: { entries: ChangeEntry[]; fmt: (iso: string) => string }) {
  if (!entries.length) return null;
  return (
    <details className="card scroll-mt-24" id="contract-changes" data-contract-changes="">
      <summary className="fold-chevron cursor-pointer font-semibold text-white">Contract changes ({entries.length})</summary>
      <ol className="mt-3 max-h-[40rem] space-y-3 overflow-y-auto pr-1 text-sm">
        {entries.map((e) => (
          <li key={e.id} className="space-y-2 rounded-lg border border-white/10 p-3" data-change={e.id}>
            <p className="font-medium text-white">{fmt(e.at)} · {e.fields.map((f) => NAMES[f] ?? f).join(", ")}</p>
            <ul className="space-y-1">
              {e.fields.map((f) => (
                <li key={f} className="grid gap-1 sm:grid-cols-[10rem_1fr]">
                  <span className="text-slate-400">{NAMES[f] ?? f}</span>
                  <span className="flex flex-wrap items-start gap-2 text-slate-200"><span className="text-slate-400 line-through decoration-white/30"><Value field={f} v={e.before[f]} /></span> → <Value field={f} v={e.after[f]} /></span>
                </li>
              ))}
            </ul>
            {(e.chose.switched.length > 0 || e.chose.kept.length > 0 || e.chose.undecided.length > 0) && (
              <p className="text-slate-300" data-chose="">
                {[
                  e.chose.switched.length ? <span key="s">Switched: <People list={e.chose.switched} /></span> : null,
                  e.chose.kept.length ? <span key="k">Kept: <People list={e.chose.kept} /></span> : null,
                  e.chose.undecided.length ? <span key="u">Not decided yet: <People list={e.chose.undecided} /></span> : null,
                ].filter(Boolean).flatMap((x, i) => (i ? [<span key={`d${i}`}> · </span>, x] : [x]))}
              </p>
            )}
            {e.effects && <p className="text-xs text-slate-400" data-effects="">{e.effects}</p>}
          </li>
        ))}
      </ol>
    </details>
  );
}
