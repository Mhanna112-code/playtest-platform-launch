"use client";
import { api } from "@/lib/client";

export function SignOut() {
  return (
    <button
      className="text-sm text-slate-600 hover:underline"
      onClick={async () => {
        await api("/api/auth/logout", {}).catch(() => null);
        window.location.href = "/";
      }}
    >
      Sign out
    </button>
  );
}
