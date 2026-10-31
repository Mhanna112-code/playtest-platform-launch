"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { FIND_SEARCH_LABEL, FIND_SEARCH_MAX, TEST_STATES, stateKey, type TestState } from "@/lib/findSearch";
import { PICK_CHIP } from "@/components/Choices";

/** The page's address with `changes` applied (empty values dropped), keeping the chips' and filters' other params. */
function hrefWith(params: Record<string, string | undefined>, changes: Record<string, string>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...changes })) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `/app/find?${s}` : "/app/find";
}

/**
 * (Owner, Oct 28, batch 17 section 8) "Search tests or developers" at the top of Find tests: the list is searched on the server as you type (after a short
 * pause), together with the category chips and the filters below. Clearing the box brings the full list back. Full width on phones.
 */
export function FindSearch({ params }: { params: Record<string, string | undefined> }) {
  const router = useRouter();
  const [q, setQ] = useState(params.q ?? "");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => router.replace(hrefWith(params, { q: q.trim() }), { scroll: false }), 300);
    return () => clearTimeout(t);
    // Only typing reloads the list (the params arrive with that reload).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  return (
    <div className="flex w-full items-center gap-2 sm:max-w-md" data-find-search="">
      <label htmlFor="findSearch" className="sr-only">{FIND_SEARCH_LABEL}</label>
      <span className="relative w-full">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
        <input id="findSearch" type="search" className="input w-full pl-9" placeholder={FIND_SEARCH_LABEL} value={q} maxLength={FIND_SEARCH_MAX} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      </span>
    </div>
  );
}

/** (Batch 17 section 8) The admin's tick boxes for the tests' states, above the list (none ticked = every state). */
export function StateTicks({ params, ticked }: { params: Record<string, string | undefined>; ticked: TestState[] }) {
  const router = useRouter();
  const flip = (s: TestState) => {
    const next = ticked.includes(s) ? ticked.filter((x) => x !== s) : [...ticked, s];
    router.replace(hrefWith(params, { states: TEST_STATES.filter((x) => next.includes(x)).map(stateKey).join(",") }), { scroll: false });
  };
  return (
    <fieldset className="flex flex-wrap items-center gap-2" data-state-ticks="">
      <legend className="sr-only">States</legend>
      {TEST_STATES.map((s) => (
        <label key={s} className={PICK_CHIP}>
          <input type="checkbox" checked={ticked.includes(s)} onChange={() => flip(s)} /> {s}
        </label>
      ))}
    </fieldset>
  );
}
