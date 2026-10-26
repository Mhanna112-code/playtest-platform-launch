"use client";
import { LogOut } from "lucide-react";
import { api } from "@/lib/client";
import { announceAuth } from "@/components/SessionWatch";

/** The full app's log-out icon button. */
export function SignOut() {
  return (
    <button
      className="nav-link"
      title="Log out"
      aria-label="Log out"
      onClick={async () => {
        await api("/api/auth/logout", {}).catch(() => null);
        announceAuth("out");
        window.location.href = "/";
      }}
    >
      <LogOut className="h-4 w-4" />
    </button>
  );
}
