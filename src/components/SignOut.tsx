"use client";
import { api } from "@/lib/client";

export function SignOut() {
  return (
    <button
      className="nav-link"
      onClick={async () => {
        await api("/api/auth/logout", {}).catch(() => null);
        window.location.href = "/";
      }}
    >
      Sign out
    </button>
  );
}
