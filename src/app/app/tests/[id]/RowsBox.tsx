"use client";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

/** The tester rows in a scroll box about 6 rows tall, with a search box above them (find a tester by name). Rows carry data-tester-name. */
export function RowsBox({ children, many }: { children: React.ReactNode; many: boolean }) {
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const needle = q.trim().toLowerCase();
    box.current?.querySelectorAll<HTMLElement>("[data-tester-name]").forEach((el) => {
      el.hidden = !!needle && !(el.dataset.testerName ?? "").toLowerCase().includes(needle);
    });
  });
  return (
    <div className="space-y-2">
      {many && (
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input type="search" className="input pl-9" placeholder="Find a tester by name" aria-label="Find a tester by name" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      )}
      <div ref={box} className="max-h-[36rem] space-y-3 overflow-y-auto pr-1" data-tester-rows="">{children}</div>
    </div>
  );
}
