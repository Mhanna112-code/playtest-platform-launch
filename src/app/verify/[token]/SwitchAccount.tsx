"use client";
import { api } from "@/lib/client";

/** (Owner, Nov 2) Confirmed an email while another account is signed in here: sign out, then log in with the confirmed one. */
export function SwitchAccount({ email }: { email: string }) {
  return (
    <button type="button" className="btn w-fit" data-verify-switch="" onClick={async () => {
      await api("/api/auth/logout", {}).catch(() => null);
      window.location.href = "/login";
    }}>Log out and log in as {email}</button>
  );
}
