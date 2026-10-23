"use client";
import { LogOut } from "lucide-react";
import { api } from "@/lib/client";

/** The full app's log-out icon button. */
export function SignOut() {
  return (
    <button
      className="nav-link"
      title="Log out"
      aria-label="Log out"
      onClick={async () => {
        await api("/api/auth/logout", {}).catch(() => null);
        window.location.href = "/";
      }}
    >
      <LogOut className="h-4 w-4" />
    </button>
  );
}
