import type { ReactNode } from "react";

/** (Batch 20 section 1) More than this many questions sit in a scroll box; this many or fewer show without one. */
export const QUESTION_BOX_AFTER = 3;
/** About 3 questions tall: read-only lists (each question at most 3 lines), and the tester's answer form (a question with its answer box). */
const HEIGHT = { list: "max-h-48", form: "max-h-[34rem]" } as const;

/**
 * (Owner, Oct 28, batch 20 section 1) More than 3 questions: every question inside a scroll box about 3 questions tall (no "+N more"); 3 or fewer show without a
 * box. Phones: the same box, full width. Plain markup (no state), usable from server and client components. Each question inside keeps its own clamp.
 */
export function QuestionBox({ count, children, size = "list", as: Tag = "div", className = "space-y-1" }: { count: number; children: ReactNode; size?: keyof typeof HEIGHT; as?: "div" | "ul" | "ol" | "span"; className?: string }) {
  if (count <= QUESTION_BOX_AFTER) return <Tag className={`block ${className}`}>{children}</Tag>;
  return (
    <Tag className={`relative block w-full overflow-y-auto pr-1 ${HEIGHT[size]} ${className}`} data-question-box={count} role="region" aria-label={`${count} questions`} tabIndex={0}>
      {children}
    </Tag>
  );
}

/** (Batch 20 section 1) A red field inside a question box: the box scrolls to that field's question (its `data-question` wrapper), then the page brings the box into view. */
export function scrollQuestionBoxTo(el: HTMLElement) {
  const box = el.closest<HTMLElement>("[data-question-box]");
  if (!box) return false;
  const q = el.closest<HTMLElement>("[data-question]") ?? el;
  const top = q.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
  box.scrollTop = Math.max(0, top - 4);
  box.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  return true;
}

/**
 * (Owner, Oct 28, batch 20 section 11) A list of past calls (the tester's Call history, the developer's "Calls (N)"): more than 3 sit in a plain scroll box about 3
 * calls tall, newest first, every call inside with its controls; 3 or fewer show without a box. A bell link to a call scrolls the box to it (jumpTo / HashJump).
 */
export const pastCallsBox = (count: number, size: "tester" | "developer") => (count > 3 ? `${size === "developer" ? "max-h-[27rem]" : "max-h-[16rem]"} overflow-y-auto pr-1` : "");
