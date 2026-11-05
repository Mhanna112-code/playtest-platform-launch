"use client";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { rowShown, useTesterFilter } from "./TesterFilter";
import { OwnPanel, ResizeBox } from "@/components/Panel";
import { BIG_PANEL_TALLEST, LIST_PANEL } from "@/components/ScrollList";

/** The tester rows in a panel about 6 rows tall, with a search box above them (find a tester by name). Rows carry data-tester-name. */
export function RowsBox({ children, many, id = "tester-rows" }: { children: React.ReactNode; many: boolean; /** (§237) the panel's id */ id?: string }) {
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  // (Batch 35 §140) A circle pressed at the top of the list shows only that tester.
  const chosen = useTesterFilter();
  useEffect(() => {
    const needle = q.trim().toLowerCase();
    box.current?.querySelectorAll<HTMLElement>("[data-tester-name]").forEach((el) => {
      el.hidden = (!!needle && !(el.dataset.testerName ?? "").toLowerCase().includes(needle)) || !rowShown(el.dataset.testerId ?? "", chosen);
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
      {/* (Owner, Nov 5, §237) The rows in the draggable panel (ResizeBox, 36rem at first; was a fixed scroll box). The panels inside keep their own scroll and grip
          as before (OwnPanel: a part's sent work and its Pay box §139, the Had calls §209), so nothing inside changes. */}
      <ResizeBox id={id} label="Testers" defaultMax={LIST_PANEL.testerRows} tallest={BIG_PANEL_TALLEST}>
        <OwnPanel><div ref={box} className="space-y-3" data-tester-rows="">{children}</div></OwnPanel>
      </ResizeBox>
    </div>
  );
}
