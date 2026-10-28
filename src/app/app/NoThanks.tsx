"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client";

/** "No thanks" on a dashboard invitation. (Batch 16 section 32) An invite that closed meanwhile is refused with the reason, then the card goes. */
export function NoThanks({ inviteId }: { inviteId: string }) {
  const [why, setWhy] = useState("");
  return (
    <>
      <button className="btn-ghost" onClick={() => api(`/api/invites/${inviteId}`, {}).then(() => window.location.reload()).catch((e) => {
        if (e instanceof ApiError && (e.code === "invite_closed" || e.code === "gone")) {
          setWhy(e.message);
          setTimeout(() => window.location.reload(), 4000);
        } else window.location.reload();
      })}>
        No thanks
      </button>
      {why && <p className="basis-full text-sm text-slate-300" role="status" data-invite-refused="">{why}</p>}
    </>
  );
}
