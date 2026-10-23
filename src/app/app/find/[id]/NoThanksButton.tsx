"use client";
import { PressButton } from "@/components/PressButton";

/** The invitation card's "No thanks": through the page's stop-once gate (box under the button), then back to the dashboard. */
export function NoThanksButton({ inviteId, seenAt }: { inviteId: string; seenAt: string }) {
  return (
    <PressButton seenAt={seenAt} path={`/api/invites/${inviteId}`} body={{}} className="btn-secondary px-3 py-1.5 text-sm" onDone={() => (window.location.href = "/app")}>
      No thanks
    </PressButton>
  );
}
