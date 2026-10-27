"use client";
import { useState } from "react";
import Link from "next/link";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Err } from "@/components/Err";
import { announceAuth } from "@/components/SessionWatch";
import { LongList } from "@/components/LongList";
import { api, errOf } from "@/lib/client";

export type DeleteLine = { key: string; text: string };
export type DeleteBlockerRow = { key: string; text: string; href: string };

/**
 * (Design doc 9; owner, Oct 28) Delete account. A tester's confirm pop-up is a thorough warning with their real numbers (pay already sent stays in Stripe, pay waiting for
 * payout setup, delayed payments, unpaid work, what leaving means). (DEFAULT) A developer can't delete while work waits for Pay or Reject, a dispute is open or a hold is on:
 * those are listed here with links, and the server refuses the press with the same list.
 */
export function DeleteAccount({ testerLines, blockers = [] }: { testerLines?: DeleteLine[]; blockers?: DeleteBlockerRow[] }) {
  const [err, setErr] = useState("");
  return (
    <section className="card space-y-2" id="delete-account">
      <h2 className="font-semibold text-white">Delete account</h2>
      <p className="text-sm text-slate-400">Your tests stop, your invites and applications are cancelled, and you leave the tests you are in. History stays, and anything you owe (a payment hold, a chargeback) stays with it. This can&apos;t be undone.</p>
      {blockers.length > 0 && (
        <div className="info space-y-1" data-delete-blockers="">
          <p className="font-medium">Pay or reject the work waiting for you first:</p>
          <LongList className="list-disc pl-5" tall="max-h-52">
            {blockers.map((b) => <li key={b.key} data-delete-blocker={b.key}><Link href={b.href} className="underline">{b.text}</Link></li>)}
          </LongList>
        </div>
      )}
      <ConfirmButton className="btn-danger px-3 py-1.5 text-sm" title="Delete your account?" confirmLabel="Delete my account"
        body={
          <>
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
