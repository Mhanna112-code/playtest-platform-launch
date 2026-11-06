"use client";
import { useEffect, useRef, useState } from "react";
import { rowShown, useTesterFilter } from "./TesterFilter";
import { hideUnmatched, noTestersMatch, useTesterSearch } from "./TesterSearch";
import { OwnPanel, ResizeBox } from "@/components/Panel";
import { BIG_PANEL_TALLEST, LIST_PANEL } from "@/components/ScrollList";

/**
 * The tester rows in a panel about 6 rows tall. Rows carry data-tester-name. (Owner, Nov 5, §274) Their name search is the "Search testers" box right below the
 * avatars (TesterListSearch; it was a "Find a tester by name" box here, shown from 7 testers): the rows follow it as you type, with the invite search's name match.
 */
export function RowsBox({ children, id = "tester-rows" }: { children: React.ReactNode; /** (§237) the panel's id */ id?: string }) {
  const q = useTesterSearch();
  const box = useRef<HTMLDivElement>(null);
  // (Batch 35 §140) A circle pressed at the top of the list shows only that tester.
  const chosen = useTesterFilter();
  const [left, setLeft] = useState(1);
  // After every render (a live redraw brings new rows): the same count again changes nothing, so this never loops.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setLeft(hideUnmatched(box.current, "[data-tester-name]", "testerName", q, (el) => rowShown(el.dataset.testerId ?? "", chosen)));
  });
  return (
    <div className="space-y-2">
      {q.trim() && left === 0 && <p className="note" data-tester-search-none="testers">{noTestersMatch(q)}</p>}
      {/* (Owner, Nov 5, §237) The rows in the draggable panel (ResizeBox, 36rem at first; was a fixed scroll box). The panels inside keep their own scroll and grip
          as before (OwnPanel: a part's sent work and its Pay box §139, the Had calls §209), so nothing inside changes. */}
      <ResizeBox id={id} label="Testers" defaultMax={LIST_PANEL.testerRows} tallest={BIG_PANEL_TALLEST}>
        <OwnPanel><div ref={box} className="space-y-3" data-tester-rows="">{children}</div></OwnPanel>
      </ResizeBox>
    </div>
  );
}
