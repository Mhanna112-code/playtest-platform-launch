"use client";
import { Err } from "@/components/Err";
import { useState } from "react";
import { useFinished } from "@/lib/usePress";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { api, ApiError, errOf } from "@/lib/client";
import { mergeChanges } from "@/lib/live";
import { money } from "@/lib/format";
import { type BankAction } from "@/lib/bankConfirm";
import { useBankCheck } from "@/components/BankCheck";
import { CANCEL_CHECK, OWED_BANK_WAITING, RESERVE_EXPIRED, reservedAddedLine, reservedLine } from "@/lib/rules";

/** (Batch 35 §117) `waiting`: locked by a bank check (`checkId`, the check "Cancel this check" cancels); the button doesn't pay it. */
type Line = { id: string; retry: boolean; amountCents: number; until: string | null; text: string; /** (§131) the line with the names uncut: its hover */ full?: string; waiting?: boolean; checkId?: string | null; /** (§125) a charge that came in after the one payment was made: charged right after it */ after?: string };

/** (Owner, Nov 2, batch 35 §117 rule 3) "Cancel this check": the bank's check is cancelled and what it covered can be paid at once (the page redraws). */
function CancelCheck({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fin = useFinished(() => setBusy(false));
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className="btn-secondary px-2 py-0.5 text-xs" disabled={busy} data-cancel-check={id} onClick={async () => {
        setBusy(true);
        setErr("");
        try {
          const r = await api<{ line: string }>("/api/payments/owed", { cancelCheck: id });
          fin.finish(r.line);
        } catch (e) {
          setErr(errOf(e));
          setBusy(false);
        }
      }}>{CANCEL_CHECK}</button>
      {fin.line && <span className="ok">{fin.line}</span>}
      <Err text={err} />
    </span>
  );
}

/**
 * (Owner, Oct 27) Failed payments (each listed) and reversed payments (a chargeback adds its amount); one button pays them all. It stops once if the total
 * changed since the page loaded; the second press pays at once, with the result right under the button.
 * (Owner, Oct 29, batch 10) The page polls (AutoRefresh): the amount and the lines follow `owed` live, and the page drops the box when nothing is owed. A press
 * still checks what was last confirmed (the page load or the last stop box), so a press after a change stops once with the new lines.
 * (Batch 23 section 6) During a chargeback hold the box reserves rather than pays: Pay what you owe puts the amount on hold on the card ("Reserved $X: it's taken when
 * the team approves lifting your hold."), the team's Approve takes it, and it's released if they don't approve or after about 7 days.
 */
export function OwedBox({ onHold, owed, chargeback = false, review = false, retryLine = "", verifyFirst = false, reservedCents = 0, reserveExpired = false, ranOut = "" }: { /** (§125) "Your bank check ran out on Nov 5: nothing was charged. Pay again or change your card." */ ranOut?: string | null; onHold: boolean; owed: Line[]; chargeback?: boolean; review?: boolean; /** (Batch 11) "Last try: ... · next try: ..." of the automatic retries */ retryLine?: string; /** (Batch 16 section 41) a chargeback hold with no verified card yet: Pay waits for step 1 */ verifyFirst?: boolean; /** (Batch 23 section 6) a chargeback hold: what is reserved on the card already, and whether the last reservation lapsed */ reservedCents?: number; reserveExpired?: boolean }) {
  const [err, setErr] = useState("");
  const [failing, setFailing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [changes, setChanges] = useState<Change[] | null>(null);
  // (Batch 35 §40, §41) Paid: the page redraws in place; until it has, the button stays greyed with the result line.
  const fin = useFinished(() => setBusy(false));
  const done = fin.line;
  const [bankNote, setBankNote] = useState("");
  // (Batch 17 §11) The bank's check opens inline, under Pay what you owe (one after another when several need it).
  const bank = useBankCheck();
  const retry = owed.filter((o) => o.retry);
  const seenTotal = retry.reduce((s, o) => s + o.amountCents, 0);
  // What the page / the stop box showed last: every press (the second too) is checked against it.
  const [total, setTotal] = useState(seenTotal);
  const [shownIds, setShownIds] = useState(retry.map((o) => o.id));
  // (Owner, Oct 29, batch 28 §8) Pay what you owe reserves once: with a reservation in place the button is disabled, and what was added since is charged after the lift.
  const reservedOnce = chargeback && reservedCents > 0;
  return (
    <div id="owed" className="space-y-2 rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100">
      {onHold && chargeback ? (
        <p><b>Your tests are paused.</b> No new testers, invites or calls, and Pay waits. Testers can&apos;t send work until then (they can still charge for work you haven&apos;t reviewed: it&apos;s added here and paid with what you owe, as one payment); their deadlines move on by the pause.</p>
      ) : onHold ? (
        <p><b>Your tests are paused.</b> No new testers, invites or calls, and Pay waits, until you pay what you owe. Testers can&apos;t send work until then (they can still charge for work you haven&apos;t reviewed: it&apos;s added here and paid with what you owe, as one payment); their deadlines move on by the pause.</p>
      ) : (
        <p><b>A payment failed.</b> Pay {money(seenTotal)} to keep your tests running.</p>
      )}
      {ranOut && <p data-check-ran-out="">{ranOut}</p>}
      {retryLine && <p className="text-xs" data-retry-line="">{retryLine}</p>}
      {/* (Owner, Oct 29, batch 23 section 6) A chargeback hold: Pay what you owe reserves the money; the team's Approve takes it. */}
      {chargeback && reserveExpired && <p data-reserve-expired="">{RESERVE_EXPIRED}</p>}
      {reservedOnce && <p data-reserved="">{reservedAddedLine(reservedCents, seenTotal)}</p>}
      {onHold && review && <p data-hold-review="">After you pay what you owe, the team will review your account before your tests resume.</p>}
      {owed.length > 0 && (
        <ul className="list-disc pl-5">
          {owed.map((o, i) => (
            <li key={o.id} data-owed-line={o.id} data-waiting={o.waiting ? "" : undefined} title={o.full}>
              {o.text}
              {o.waiting && !o.after && <> · <b>{OWED_BANK_WAITING}</b></>}
              {o.after && <> · <b data-owed-after="">{o.after}</b></>}
              {/* One check covers every debt it paid: its Cancel sits next to the first of them. */}
              {o.waiting && o.checkId && owed.findIndex((x) => x.checkId === o.checkId) === i && <> <CancelCheck id={o.checkId} /></>}
            </li>
          ))}
        </ul>
      )}
      {retry.length > 0 && <button
        className="btn"
        disabled={busy || verifyFirst || reservedOnce}
        aria-disabled={verifyFirst || reservedOnce}
        onClick={async () => {
          setBusy(true);
          setErr("");
          setFailing([]);
          try {
            const r = await api<{ stillFailing: string[]; lifted: boolean; confirm?: BankAction[]; reservedCents?: number }>("/api/payments/owed", { seenTotalCents: total, seenIds: shownIds, confirmed: changes != null });
            setChanges(null);
            // (Batch 11) Payments the bank wants confirmed: one check each, inline under the button; any it refused stay owed (nothing was charged for them).
            let refused = "";
            setBankNote("");
            for (const a of r.confirm ?? []) {
              try { await bank.check(a); } catch (e) { refused = (e as Error).message; }
            }
            if (refused) {
              setBankNote(refused);
              setBusy(false);
              return;
            }
            if (r.stillFailing.length) {
              setFailing(r.stillFailing);
              setBusy(false);
            } else {
              fin.finish(chargeback ? reservedLine(changes ? total : seenTotal) : `Paid ${money(total)}, thank you`);
            }
          } catch (e) {
            if (e instanceof ApiError && e.code === "nothing_owed") {
              // Paid meanwhile (another tab): nothing is charged; the page redraws without the box.
              setErr(errOf(e));
              fin.finish();
            } else if (e instanceof ApiError && e.code === "stop_once") {
              setChanges((c) => (c ? mergeChanges(c, e.data.changes as Change[]) : (e.data.changes as Change[])));
              if (typeof e.data.totalCents === "number") setTotal(e.data.totalCents);
              if (Array.isArray(e.data.ids)) setShownIds(e.data.ids as string[]);
            } else setErr(errOf(e));
            if (!(e instanceof ApiError && e.code === "nothing_owed")) setBusy(false);
          }
        }}
      >
        {reservedOnce ? `${money(changes ? total : seenTotal)} is charged after the team approves` : `Pay what you owe (${money(changes ? total : seenTotal)})`}
      </button>}
      {bank.view}
      {/* (Owner, Oct 28, batch 16 section 41) The chargeback steps in order: the card first. */}
      {verifyFirst && <p className="text-xs" data-verify-first="">Verify your card first (step 1): then you can pay what you owe.</p>}
      <ChangesBox changes={changes} />
      {bankNote && <p className="info" data-bank-not-confirmed="">{bankNote}</p>}
      {done && <p className="ok">{done}</p>}
      {failing.length > 0 && (
        <p className="err">
          Still declined: {failing.join("; ")}. Your tests stay paused until everything is paid. <a href="/app/payments#card">Update your card</a> and try again.
        </p>
      )}
      {chargeback && <p>Pay what you owe reserves the money on your card: nothing is taken until the team approves lifting your hold, and your tests resume then.</p>}
      <Err text={err} />
    </div>
  );
}
