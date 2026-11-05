"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { wasLine } from "@/lib/editMerge";
import { QuestionTexts, textId, ValueText } from "@/components/QA";
import { qRequired, qText } from "@/lib/questions";

/**
 * (Owner, Oct 28, batch 16 section 19) What another tab or device changed in one field, named as on the form ("Spots: 4 → 5"; long text: "Instructions:"
 * then the text it replaced) and, when this tab had typed something different and unsaved, "What you typed (not saved):" in full with a Copy button.
 * `lines` are plain lines (the keys: "Added: …").
 */
export type NoteItem = { name?: string; before?: string | string[]; after?: string | string[]; typed?: string | string[]; lines?: string[] };

/** Short values stay on one line ("Spots: 4 → 5"); long text is in its box (FoldText). */
const NL = String.fromCharCode(10);
/**
 * (Owner, Nov 5, §243) The fields whose changes stay plain lines in these notes: Open until, categories, languages and the tech requirements (devices). Every other
 * field's value (and the keys' lines) is in the draggable box, however short.
 */
const PLAIN = /^(open ?until|categor|language|device|tech)/i;
export const plainField = (nameOrField?: string) => !!nameOrField && PLAIN.test(nameOrField.trim());
const isShort = (s: string) => s.length <= 80 && !s.includes("\n");

/**
 * (Owner, Nov 5, §237; was §182's LongText fold, 3 lines then Show more) A long value in the shared box for long text (QA's ValueText): drags taller, its own
 * scroll, no Show more. `label`: what the box holds, for screen readers; the box's id is made from the label and the text (the same note keeps its height).
 */
export function FoldText({ text, label = "Text" }: { text: string; label?: string }) {
  return <ValueText id={textId("note", `${label}|${text}`)} label={label}>{text}</ValueText>;
}

/** (Owner, Nov 5, §237; was 3 questions, then "+N more") The questions, each in its question box (QA's QuestionTexts), in order. */
function ShortList({ label, items }: { label: string; items: string[] }) {
  return <QuestionTexts id={textId("note-q", `${label}|${items.join("|")}`)} items={items.map((q) => ({ text: qText(q), required: qRequired(q) }))} />;
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
  if (Array.isArray(value)) return <div className="space-y-1" data-note-value={label}>{head}<ShortList label={label} items={value} /></div>;
  return <div className="space-y-1" data-note-value={label}>{head}<FoldText label={label.replace(/:$/, "")} text={value || "empty"} /></div>;
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
            {/* (Owner, Nov 5, §241) Every other-tab change in its draggable box too: the keys' lines ("Added: …"), and short changes ("Categories: a → b",
                selections, spots), not only long text. */}
            {it.lines && <ValueText id={textId("note-lines", it.lines.join("|"))} label={it.name ?? "Changes"}><span data-note-lines="">{it.lines.join(NL)}</span></ValueText>}
            {line && (plainField(it.name) ? <p data-note-short="">{line}</p> : <ValueText id={textId("note-short", line)} label={it.name ?? "Change"}><span data-note-short="">{line}</span></ValueText>)}
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
  const inline = items.length === 1 && first && !first.lines && first.typed === undefined && plainField(first.name) ? shortLine(first) : null; // (§243)
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
  const short = (it: TheirsItem) => !Array.isArray(it.value) && isShort(it.value) && (plainField(it.field) || plainField(it.name)); // (§243) otherwise in its box
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
          {/* (§243) The keys' lines in their box too. */}
          <ValueText id={textId("note-group", `${g.heading}|${g.lines.join("|")}`)} label={g.heading}><span data-note-group-lines="">{g.lines.join(NL)}</span></ValueText>
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
        return it.was == null || (isShort(it.was) && (plainField(it.field) || plainField(it.name))) ? (
          <p key={it.field} className="font-medium" data-was-field={it.field}>{line}</p>
        ) : (
          <div key={it.field} data-was-field={it.field}>
            <p className="font-medium">{wasLine(it.time, null, it.name).replace(/ empty$/, "")}</p>
            <FoldText label="What it replaced" text={`“${it.was}”`} />
          </div>
        );
      })}
    </div>
  );
}
