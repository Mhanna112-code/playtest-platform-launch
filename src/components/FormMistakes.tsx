"use client";
import { useEffect, useRef, useState } from "react";
import { Err } from "@/components/Err";
import { MistakeList, focusFirstMistake, markServerMistakes } from "@/components/FieldChecks";
import { FIELD } from "@/lib/client";

/**
 * (Owner, Oct 28, batch 16 section 10) Where a form showed `<Err text={err} />`: a red server mistake (errOf: the FIELD mark) goes to its field (the box
 * whose data-match pattern fits it, or `find`), red with the same text until that field is fixed; the page goes to the first red field; under the button,
 * MistakeList: "Fix the mistake above, then press <press> again." with one linked bullet per red field. A refusal (blue) shows as before.
 */
export function FormMistakes({ text, press, find }: { text: string; press: string; find?: (msg: string) => Element | null | undefined }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [orphans, setOrphans] = useState<string[]>([]);
  const red = text.startsWith(FIELD);
  useEffect(() => {
    if (!red) {
      setOrphans([]);
      return;
    }
    const root = ref.current?.closest("[data-mistakes-root], form") ?? null;
    setOrphans(markServerMistakes(root, [text.slice(1)], find));
    focusFirstMistake(root);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <>
      <span ref={ref} hidden />
      {!red && <Err text={text} />}
      <MistakeList press={press} orphans={orphans} />
    </>
  );
}
