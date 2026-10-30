"use client";
import { useState } from "react";
import Link from "next/link";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Err } from "@/components/Err";
import { announceAuth } from "@/components/SessionWatch";
import { api, errOf } from "@/lib/client";

export type DeleteLine = { key: string; text: string };

/**
 * (Design doc 9; owner, Oct 28) Delete account. A tester's confirm pop-up is a thorough warning with their real numbers (pay already sent stays in Stripe, pay waiting for
 * payout setup, delayed payments, unpaid work, what leaving means). (Owner, Oct 29, batch 12 section 1) A developer can always delete: their pop-up lists, with counts, the
 * work waiting for their review, the parts testers can still charge and the open disputes, then what happens to them.
 */
export function DeleteAccount({ testerLines, devLines = [], subscriptionLine = "", both = false, owes = false }: { both?: boolean; owes?: boolean; testerLines?: DeleteLine[]; devLines?: DeleteLine[]; /** (Batch 8) Shown when a subscription would end now. */ subscriptionLine?: string }) {
  const [err, setErr] = useState("");
  return (
    <section className="card space-y-2" id="delete-account">
      <h2 className="font-semibold text-white">Delete account</h2>
      <p className="text-sm text-slate-400">{both && <>This deletes your whole account: both your developer side and your tester side. </>}Your tests stop, your invites and applications are cancelled, and you leave the tests you are in. History stays{owes ? ", and anything you owe (a payment hold, a chargeback) stays with it" : ""}. This can&apos;t be undone.</p>
      <ConfirmButton className="btn-danger px-3 py-1.5 text-sm" title="Delete your account?" confirmLabel="Delete my account"
        body={
          <>
            {both && <p>This deletes your whole account: both your developer side and your tester side.</p>}
            {testerLines && testerLines.length > 0 && (
              <ul className="list-disc space-y-1 pl-5" data-delete-warning="">
                {testerLines.map((l) => (
                  <li key={l.key} data-delete-line={l.key}>
                    {l.text}
                    {l.key === "waiting" && <> <Link href="/app/payments#payout" className="underline">Set up payouts</Link></>}
                  </li>
                ))}
              </ul>
            )}
            {devLines.length > 0 && (
              <ul className="list-disc space-y-1 pl-5" data-dev-delete-warning="">
                {devLines.map((l) => <li key={l.key} data-delete-line={l.key}>{l.text}</li>)}
              </ul>
            )}
            {subscriptionLine && <p data-delete-line="subscription">{subscriptionLine}</p>}
            <p>Every open tab of your account is signed out and told the account no longer exists.</p>
            {!testerLines?.length && <p className="font-medium text-white">This can&apos;t be undone.</p>}
          </>
        }
        onConfirm={() => api("/api/account/delete", { confirmed: true }).then(() => { announceAuth("out"); window.location.href = "/login?gone=1"; }).catch((e) => setErr(errOf(e)))}>
        Delete account
      </ConfirmButton>
      <Err text={err} />
    </section>
  );
}
