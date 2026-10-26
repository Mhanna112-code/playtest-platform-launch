"use client";
import { useState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Err } from "@/components/Err";
import { announceAuth } from "@/components/SessionWatch";
import { api, errOf } from "@/lib/client";

/** (Design doc 9) Delete account: its tests stop, invites and applications are cancelled, history stays, and what is owed is never cleared. */
export function DeleteAccount() {
  const [err, setErr] = useState("");
  return (
    <section className="card space-y-2" id="delete-account">
      <h2 className="font-semibold text-white">Delete account</h2>
      <p className="text-sm text-slate-400">Your tests stop, your invites and applications are cancelled, and you leave the tests you are in. History stays, and anything you owe (a payment hold, a chargeback) stays with it. This can&apos;t be undone.</p>
      <ConfirmButton className="btn-danger px-3 py-1.5 text-sm" title="Delete your account?" confirmLabel="Delete my account"
        body={<><p>Every open tab of your account is signed out and told the account no longer exists.</p><p className="font-medium text-white">This can&apos;t be undone.</p></>}
        onConfirm={() => api("/api/account/delete", { confirmed: true }).then(() => { announceAuth("out"); window.location.href = "/login?gone=1"; }).catch((e) => setErr(errOf(e)))}>
        Delete account
      </ConfirmButton>
      <Err text={err} />
    </section>
  );
}
