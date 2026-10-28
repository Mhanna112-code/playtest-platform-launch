"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client";
import { ChangesBox } from "@/components/ChangesBox";
import { stopBox, type StopBox } from "@/lib/topStop";

/**
 * "No thanks" on a dashboard invitation. (Batch 16 section 32) An invite that closed meanwhile is refused with the reason, then the card goes. (Batch 17 section 4) An
 * invite re-sent on a new listing stops once (blue, with the new listing); the next press says no thanks to it.
 */
export function NoThanks({ inviteId }: { inviteId: string }) {
  const [why, setWhy] = useState("");
  const [box, setBox] = useState<StopBox | null>(null);
  const press = () => api(`/api/invites/${inviteId}`, box ? { confirmed: true, boxAt: box.now } : {}).then(() => window.location.reload()).catch((e) => {
    const sb = stopBox(e);
    if (sb) return setBox(sb);
    setBox(null);
    if (e instanceof ApiError && (e.code === "invite_closed" || e.code === "gone")) {
      setWhy(e.message);
      setTimeout(() => window.location.reload(), 4000);
    } else window.location.reload();
  });
  return (
    <>
      <button className="btn-ghost" onClick={() => void press()}>
        No thanks
      </button>
      {why && <p className="basis-full text-sm text-slate-300" role="status" data-invite-refused="">{why}</p>}
      <ChangesBox changes={box?.changes ?? null} tail={box?.tail} press="No thanks" />
    </>
  );
}
