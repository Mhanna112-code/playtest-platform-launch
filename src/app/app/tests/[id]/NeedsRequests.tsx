"use client";
import { callRequestsAnchor } from "@/components/CallRequestsPanel";
import { jumpTo } from "@/lib/markJump";

/**
 * (Owner, Nov 4, §181; replaces batch 16 section 35's rows) In a person's Needs you drop-down, ONE line for their call requests waiting for your answer: "2 call
 * requests ↓" (or "1 call request ↓"). It jumps to that person's drop-down in the Call requests box, opening the box and the drop-down before it scrolls there
 * (inside the panel too: jumpTo). No request buttons in Needs you: Accept / Decline are in the box.
 */
export function NeedsRequests({ contractId, count }: { contractId: string; count: number }) {
  const id = callRequestsAnchor(contractId);
  return (
    <p className="text-sm" data-needs-requests={contractId}>
      <a href={`#${id}`} onClick={(e) => { e.preventDefault(); jumpTo(id); }}>{count} call request{count === 1 ? "" : "s"} ↓</a>
    </p>
  );
}
