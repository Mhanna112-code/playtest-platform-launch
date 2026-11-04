import type { ReactNode } from "react";
import { ResizeBox } from "@/components/Panel";

/** About 4 rows of the dashboard's row cards; about 2 rows of the developer's test cards (one column of about 3 on phones). */
const HEIGHT = { rows: "max-h-[22rem]", lines: "max-h-56", cards: "max-h-[54rem] md:max-h-[38rem]", /** (batch 24 section 1) about 3 short rows (stacked on phones) */ three: "max-h-[21rem] sm:max-h-[13rem]" } as const;
/** (Batch 30 §16) A part's payment lines: more than this many sit in a panel. */
export const PAY_LINES_SHOWN = 4;

/**
 * (Owner, Nov 3, batch 35 §152) The call lists and the payment lists sit in the draggable panel (ResizeBox, §139). Each starts at its old height (these: the old
 * max-h, never past 60% of the screen, the grip's tallest), and the grip drags it shorter or taller.
 */
export const LIST_PANEL = {
  /** Call requests (was max-h-80) */ requests: "min(20rem, 60vh)",
  /** The developer's booked calls with one tester (was max-h-40, about 3 calls) */ booked: "min(10rem, 60vh)",
  /** The developer's whole list of testers' calls (was max-h-[200vh], about 2 screens; (owner, Nov 4, §181) it showed too many testers: now about 3–4 tester
   * cards at first, the rest scroll inside; the grip still drags it up to 2 screens) */ testersCalls: "min(28rem, 70vh)",
  /** The paused / restricted view's booked calls (was max-h-72) */ restricted: "min(18rem, 60vh)",
  /** The dashboards' calls (was ScrollList "lines", max-h-56) */ dashCalls: "min(14rem, 60vh)",
  /** The tester's booked calls on their session page (no box before: about 4 calls) */ testerBooked: "min(20rem, 60vh)",
  /** Past calls, more than 3 (was pastCallsBox: 27rem for the developer, 16rem for the tester) */ pastDeveloper: "min(27rem, 60vh)", pastTester: "min(16rem, 60vh)",
  /** A part's payment lines on the tester's session page (was max-h-28, about 4 lines) */ payLines: "7rem",
  /** A part's payments on the developer's test page (new; two lines each: the §139 panel's own height) */ devPayLines: "min(12rem, 40vh)",
  /** "By question"'s list of questions (no box before: about 8 closed questions) */ questions: "min(32rem, 60vh)",
  /** (Owner, Nov 4, §179) The tester's "Live call: N done" calls with their payment boxes, more than 3 (no box before; about 3 calls, as the developer's past calls) */
  liveTester: "min(27rem, 60vh)",
  /** (Owner, Nov 4, §182) The tester's own recordings on their session page, in "Your recording" (about one and a half recordings) */ ownRecordings: "min(24rem, 60vh)",
  /** (§182) The tester's own written answers, every question in one panel in "Your written answers" (about 10 closed questions) */ ownAnswers: "min(28rem, 60vh)",
} as const;
/** (§152) The testers' calls list on the developer's test page drags up to 2 screens (it was already that tall). */
export const TESTERS_CALLS_TALLEST = 2;
/** (Batch 20 section 11) Past calls: more than this many sit in a panel. (Owner, Nov 4, §179) The tester's "Live call: N done" calls too. */
export const PAST_CALLS_SHOWN = 3;

/** (§152) A list that is a panel only when it is long (`on`); otherwise just the list. */
export function PanelWhen({ on, id, label, defaultMax, children }: { on: boolean; id: string; label: string; defaultMax?: string; children: ReactNode }) {
  return on ? <ResizeBox id={id} label={label} defaultMax={defaultMax}>{children}</ResizeBox> : <>{children}</>;
}

/**
 * (Owner, Oct 29, batch 30 §16) A part's payment lines (the Pay, then each extra, newest last): more than 4 sit in a box about 4 lines tall (everything in it, no
 * "Show N more"); the lines under them (whether it can be paid more, the dispute) stay outside the box. (Owner, Nov 3, §152) The box is the draggable panel, kept
 * by the part's id (`paylines-<id>`).
 */
export function PayLinesBox({ id, count, children }: { /** the part (sent work or call) */ id: string; count: number; children: ReactNode }) {
  return count > PAY_LINES_SHOWN
    ? <ResizeBox id={`paylines-${id}`} label="Payments for this part" defaultMax={LIST_PANEL.payLines}><div className="space-y-2" data-pay-lines="panel">{children}</div></ResizeBox>
    : <>{children}</>;
}

/**
 * (Owner, Oct 28, batch 16 section 14) Every list panel on the dashboards and the developer profile's "Open tests": everything in the list (no "Show N more",
 * no pages, no cut-off), in a plain scroll box. A short list shows without a scroll bar (the box only scrolls when it overflows). The heading, filters, chips
 * and search boxes sit above it, outside the box, so they never scroll away. (Blue boxes keep LongList's "3 lines, then Show N more".)
 */
export function ScrollList({ children, className = "space-y-2", size = "rows", as: Tag = "ul", label }: { children: ReactNode; className?: string; size?: keyof typeof HEIGHT; as?: "ul" | "div"; label?: string }) {
  return (
    <Tag className={`${className} ${HEIGHT[size]} overflow-y-auto pr-1`} data-scroll-list={size} aria-label={label}>
      {children}
    </Tag>
  );
}
