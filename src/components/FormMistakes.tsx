"use client";
import { useEffect, useRef, useState } from "react";
import { Err } from "@/components/Err";
import { MistakeList, focusFirstMistake, markServerMistakes } from "@/components/FieldChecks";
import { FIELD } from "@/lib/client";
import { useGoneOnNewVersion } from "@/lib/pageVersion";

/**
 * (Owner, Oct 28, batch 16 section 10) Where a form showed `<Err text={err} />`: a red server mistake (errOf: the FIELD mark) goes to its field (the box
 * whose data-match pattern fits it, or `find`), red with the same text until that field is fixed; the page goes to the first red field; under the button,
 * MistakeList: "Fix the mistake above, then press <press> again." with one linked bullet per red field. A refusal (blue) shows as before.
 */
export function FormMistakes({ text, press, find, top = false }: { text: string; press: string; find?: (msg: string) => Element | null | undefined; top?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [orphans, setOrphans] = useState<string[]>([]);
  const red = text.startsWith(FIELD);
  // (Batch 35 §60) The mistakes no field shows (under the button) go once the page redraws with a new version of itself.
  const gone = useGoneOnNewVersion(red && orphans.length ? orphans : null, text.slice(1));
  useEffect(() => {
    if (!red) {
      setOrphans([]);
      return;
    }
    const root = ref.current?.closest("[data-mistakes-root], form") ?? null;
    // (Batch 26 section 11) A refusal naming several fields (one per line, e.g. both sign-up ticks) marks each.
    setOrphans(markServerMistakes(root, text.slice(1).split("\n").filter(Boolean), find));
    focusFirstMistake(root);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <>
      <span ref={ref} hidden />
      {!red && <Err text={text} />}
      <MistakeList press={press} orphans={gone ? [] : orphans} top={top} />
    </>
  );
}
