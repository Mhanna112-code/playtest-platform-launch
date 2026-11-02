import { CharacterCount } from "@/components/CharacterCount";
import { KEY_MAX_LENGTH } from "@/lib/keys";

/** Keys have a per-line limit, rather than a limit on the whole box. */
export function KeyCounts({ value }: { value: string }) {
  const keys = value.split("\n").map((s) => s.trim()).filter(Boolean);
  return <div className="max-h-24 overflow-y-auto" data-key-counts="">{keys.map((key, i) => <div key={i} className="flex justify-end gap-2 text-xs"><span className="text-slate-500">Key {i + 1}</span><CharacterCount value={key} max={KEY_MAX_LENGTH} /></div>)}</div>;
}
