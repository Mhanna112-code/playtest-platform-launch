import { LineList } from "@/components/LineList";
import { KEY_MAX_LENGTH, KEY_TOO_LONG } from "@/lib/keys";

/**
 * Keys have a per-line limit, rather than a limit on the whole box. (Owner, Nov 3, batch 35 §141) Listed under the box as they're typed, like the questions:
 * each key with its count, a key typed twice marked, and a click on one puts the cursor on its line. `box`: the textarea's id (Post's box, or Edit's Free box).
 */
export function KeyCounts({ value, box = "accessKeys" }: { value: string; box?: string }) {
  return <LineList box={box} text={value} max={KEY_MAX_LENGTH} label="Key" mono overLine={KEY_TOO_LONG} data-key-counts="" />;
}
