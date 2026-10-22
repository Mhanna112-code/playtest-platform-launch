"use client";
import { api } from "@/lib/client";

export function NoThanks({ inviteId }: { inviteId: string }) {
  return (
    <button className="btn-ghost" onClick={() => api(`/api/invites/${inviteId}`, {}).then(() => window.location.reload()).catch(() => window.location.reload())}>
      No thanks
    </button>
  );
}
