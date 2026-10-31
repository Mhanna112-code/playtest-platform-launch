"use client";
import { LogOut } from "lucide-react";
import { api } from "@/lib/client";
import { announceAuth } from "@/components/SessionWatch";
import { flushKept } from "@/lib/useKept";

/** (Batch 15 section 41, L6) Settings: "Sign out of all devices". */
export function SignOutAll() {
  return (
    <button
      className="btn-secondary"
      onClick={async () => {
        await flushKept().catch(() => null); // (Batch 35 §8) what was typed this moment is kept before signing out; (§16) only a form with unsent typing sends
        await api("/api/auth/logout", { everywhere: true }).catch(() => null);
        announceAuth("out");
        window.location.href = "/login";
      }}
    >
      <LogOut className="h-4 w-4" /> Sign out of all devices
    </button>
  );
}

/** The full app's log-out icon button. */
export function SignOut() {
  return (
    <button
      className="nav-link"
      title="Log out"
      aria-label="Log out"
      onClick={async () => {
        await flushKept().catch(() => null); // (Batch 35 §8) what was typed this moment is kept before signing out; (§16) only a form with unsent typing sends
        await api("/api/auth/logout", {}).catch(() => null);
        announceAuth("out");
        window.location.href = "/login"; // (Owner, Oct 27) every tab and window goes to the sign-in page
      }}
    >
      <LogOut className="h-4 w-4" />
    </button>
  );
}
