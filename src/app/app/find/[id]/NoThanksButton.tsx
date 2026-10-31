"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";

/**
 * The invitation card's "No thanks": through the page's stop-once gate (box under the button), then back to the dashboard. (Batch 17 section 4) As Join and
 * Accept (batch 16 section 32): an invite re-sent on a new listing stops once (blue, with the new listing); a closed one is refused with the reason, then the card goes.
 */
export function NoThanksButton({ inviteId, seenAt }: { inviteId: string; seenAt: string }) {
  const router = useRouter();
  const { press, changes, error, busy, errData } = usePress(seenAt);
  useEffect(() => {
    if (errData.code !== "invite_closed" && errData.code !== "gone") return;
    const t = setTimeout(() => router.refresh(), 4000);
    return () => clearTimeout(t);
  }, [errData, router]);
  return (
    <>
      <button className="btn-secondary px-3 py-1.5 text-sm" disabled={busy} onClick={async () => { if (await press(`/api/invites/${inviteId}`, {})) window.location.href = "/app"; }}>
        No thanks
      </button>
      <ChangesBox changes={changes} error={error} press="No thanks" side="tester" seeIt="#listing" alertsWhere="join" />
    </>
  );
}
