"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { LongList } from "@/components/LongList";
import { wasLine } from "@/lib/editMerge";

/**
 * (Owner, Oct 28, batch 16 section 19) What another tab or device changed in one field, named as on the form ("Spots: 4 → 5"; long text: "Instructions:"
 * then the text it replaced) and, when this tab had typed something different and unsaved, "What you typed (not saved):" in full with a Copy button.
 * `lines` are plain lines (the keys: "Added: …").
 */
export type NoteItem = { name?: string; before?: string | string[]; after?: string | string[]; typed?: string | string[]; lines?: string[] };

/** Short values stay on one line ("Spots: 4 → 5"); long text folds (3 lines, then Show more, opening a scroll box about 8 lines tall). */
const isShort = (s: string) => s.length <= 80 && !s.includes("\n");

export function FoldText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 240 || text.split("\n").length > 3;
  return (
    <div data-fold-text={long ? (open ? "open" : "closed") : "short"}>
      <div className={`whitespace-pre-wrap break-words ${long ? (open ? "max-h-48 overflow-y-auto pr-1" : "line-clamp-3") : ""}`}>{text}</div>
      {long && (
        <button type="button" className="btn-ghost mt-0.5 !px-2 !py-0.5 text-xs" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/** A list (the questions): 3, then "+N more". */
function ShortList({ items }: { items: string[] }) {
  const [all, setAll] = useState(false);
  if (!items.length) return <span>none</span>;
  const shown = all ? items : items.slice(0, 3);
  return (
    <div>
      <ul className={`list-disc pl-5 ${all ? "max-h-48 overflow-y-auto pr-1" : ""}`}>{shown.map((q, i) => <li key={i} className="break-words">{q}</li>)}</ul>
      {items.length > 3 && (
        <button type="button" className="btn-ghost mt-0.5 !px-2 !py-0.5 text-xs" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `+${items.length - 3} more`}
        </button>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn-ghost !px-2 !py-0.5 text-xs" data-copy-typed="" onClick={() => void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 2000); }).catch(() => {})}>
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {done ? "Copied" : "Copy"}
    </button>
  );
}

function Value({ label, value, copy }: { label: string; value: string | string[]; copy?: boolean }) {
  const text = Array.isArray(value) ? value.join("\n") : value;
  const head = (
    <span className="flex flex-wrap items-center gap-2">
      <b>{label}</b>
      {copy && <CopyButton text={text} />}
    </span>
  );
  if (Array.isArray(value)) return <div data-note-value={label}>{head}<ShortList items={value} /></div>;
  return <div data-note-value={label}>{head}<FoldText text={value || "empty"} /></div>;
}

/** "Spots: 4 → 5" when both values are short; null when the field's old value needs its own block. */
export function shortLine(it: NoteItem) {
  if (!it.name || it.before === undefined || it.after === undefined || Array.isArray(it.before) || Array.isArray(it.after)) return null;
  if (!isShort(it.before) || !isShort(it.after)) return null;
  return `${it.name}: ${it.before || "empty"} → ${it.after || "empty"}`;
}

/** One field's (or the keys') details: used under the field and in Save's stop-once box. */
export function NoteItems({ items, inlineFirst = false }: { items: NoteItem[]; inlineFirst?: boolean }) {
  return (
    <div className="space-y-1">
      {items.map((it, i) => {
        if (inlineFirst && i === 0 && !it.lines && it.typed === undefined && shortLine(it)) return null; // already on the heading's line
        const line = shortLine(it);
        return (
          <div key={i} className="space-y-0.5" data-note-item="">
            {it.lines && <LongList as="div" className="space-y-0.5">{it.lines.map((l) => <p key={l}>{l}</p>)}</LongList>}
            {line && <p data-note-short="">{line}</p>}
            {/* Long text (steps, questions, NDA): "<Field>:" then the text it replaced (the new one is in the box). */}
            {!line && it.before !== undefined && <Value label={`${it.name ?? "Before"}:`} value={it.before} />}
            {it.typed !== undefined && <Value label="What you typed (not saved):" value={it.typed} copy />}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The blue note under a field another tab or device changed. (Owner, Oct 28, batch 16 section 19) "Changed in another tab or device at 7:16 AM: Spots: 4 → 5"
 * on one line for a short value; long text: "Instructions:" then the text it replaced, folded.
 */
export function FieldNote({ label, items }: { label: string; items: NoteItem[] }) {
  const first = items[0];
  const inline = items.length === 1 && first && !first.lines && first.typed === undefined ? shortLine(first) : null;
  return (
    <div className="info mt-1.5 space-y-1 !p-2 text-xs" role="status" data-field-note="">
      <p className="font-medium">{inline ? `${label}: ${inline}` : `${label}:`}</p>
      <NoteItems items={items} inlineFirst={!!inline} />
    </div>
  );
}

/** (Owner, Oct 29, batch 23 section 5) One field's "Use theirs": the other tab's saved value replaces what you typed (and the note goes). */
function UseTheirs({ field, onUse }: { field: string; onUse: () => void }) {
  return <button type="button" className="btn-ghost !px-2 !py-0.5 text-xs" data-use-theirs={field} onClick={onUse}>Use theirs</button>;
}

export type TheirsItem = { field: string; name: string; value: string | string[]; onUse: () => void };

/**
 * (Owner, Oct 29, batch 23 section 5) Under a field you typed in that another tab or device saved: your text stays, and this blue note shows what was saved there
 * ("Saved in another tab or device at 3:54 PM: Spots: 5" on one line for a short value; long text folded, 3 lines then Show more), each with "Use theirs".
 */
export function TheirsNote({ heading, items }: { heading: string; items: TheirsItem[] }) {
  const first = items[0];
  const short = (it: TheirsItem) => !Array.isArray(it.value) && isShort(it.value);
  const inline = items.length === 1 && first && short(first) ? `${first.name}: ${(first.value as string) || "empty"}` : null;
  return (
    <div className="info mt-1.5 space-y-1 !p-2 text-xs" role="status" data-field-note="" data-theirs-note="">
      <p className="flex flex-wrap items-center gap-2 font-medium">
        <span>{inline ? `${heading}: ${inline}` : `${heading}:`}</span>
        {inline && <UseTheirs field={first.field} onUse={first.onUse} />}
      </p>
      {!inline && items.map((it) => (
        <div key={it.field} className="space-y-0.5" data-theirs-item={it.field}>
          {short(it) ? <p>{it.name}: {(it.value as string) || "empty"}</p> : <Value label={`${it.name}:`} value={it.value} />}
          <UseTheirs field={it.field} onUse={it.onUse} />
        </div>
      ))}
    </div>
  );
}

/**
 * (Owner, Oct 29, batch 23 section 5) A note with lines from different causes, each under its own heading: "Changed in another tab or device at 3:54 PM:" heads your own
 * saves elsewhere; "Updated at 3:54 PM:" heads what other people caused (a tester joining and given a key). A note with both shows both.
 */
export function GroupNote({ groups }: { groups: { heading: string; lines: string[] }[] }) {
  const shown = groups.filter((g) => g.lines.length);
  if (!shown.length) return null;
  return (
    <div className="info mt-1.5 space-y-1 !p-2 text-xs" role="status" data-field-note="" data-group-note="">
      {shown.map((g) => (
        <div key={g.heading} className="space-y-0.5" data-note-group={g.heading}>
          <p className="font-medium">{g.heading}:</p>
          <LongList as="div" className="space-y-0.5">{g.lines.map((l) => <p key={l}>{l}</p>)}</LongList>
        </div>
      ))}
    </div>
  );
}

export type WasItem = { field: string; /** the field's short name, when the place holds more than one field (the parts and prices) */ name?: string; time: string; was: string | null };

/**
 * (Owner, Oct 31, batch 35 §26) Under a field this tab hasn't touched that took another tab's saved value (it already shows their value: no "Use theirs"): "Changed
 * in another tab at 11:43 PM: was “Harbor Run”" (lib/editMerge.ts wasLine), live; long text folds. It goes when the field is edited or on Save.
 */
export function WasNote({ items }: { items: WasItem[] }) {
  if (!items.length) return null;
  return (
    <div className="info mt-1.5 space-y-1 !p-2 text-xs" role="status" data-field-note="" data-was-note="">
      {items.map((it) => {
        const line = wasLine(it.time, it.was, it.name);
        return it.was == null || isShort(it.was) ? (
          <p key={it.field} className="font-medium" data-was-field={it.field}>{line}</p>
        ) : (
          <div key={it.field} data-was-field={it.field}>
            <p className="font-medium">{wasLine(it.time, null, it.name).replace(/ empty$/, "")}</p>
            <FoldText text={`“${it.was}”`} />
          </div>
        );
      })}
    </div>
  );
}
