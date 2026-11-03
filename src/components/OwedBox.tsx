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
import { CANCEL_CHECK, OVER_PAY_TICK_LINE, OWED_BANK_WAITING, OWED_HOW, PAY_TICK_CENTS, RESERVE_EXPIRED, reservedAddedLine, reservedLine } from "@/lib/rules";
import { refusalLine } from "@/lib/pressLabels";

/**
 * (Owner, Nov 3) The lines a stop carries replace the box's (the bank changed a disputed amount: the bullet reads the new amount, like the button); a stop without
 * lines keeps the box's own.
 */
export function linesAfterStop<L>(owed: L[], data: Record<string, unknown>): L[] {
  return Array.isArray(data.lines) ? (data.lines as L[]) : owed;
}

/** (Owner, Nov 3) Lines shown before "Show all". */
const OWED_FOLD = 4;

/** (Batch 35 §117) `waiting`: locked by a bank check (`checkId`, the check "Cancel this check" cancels); the button doesn't pay it. */
type Line = { id: string; retry: boolean; amountCents: number; until: string | null; text: string; /** (§131) the line with the names uncut: its hover */ full?: string; waiting?: boolean; checkId?: string | null; /** (§125) a charge that came in after the one payment was made: charged right after it */ after?: string; /** (§133) part of Pay what you owe's one payment reversed: what that payment covered (the bank doesn't say which), each with its hover */ covers?: { text: string; full: string }[] };

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
      <Err text={err} press={CANCEL_CHECK} />
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
export function OwedBox({ onHold, owed: drawn, chargeback = false, review = false, verifyFirst = false, reservedCents = 0, reserveExpired = false, ranOut = "" }: { /** (§125) "Your bank check ran out on Nov 5: nothing was charged. Pay again or change your card." */ ranOut?: string | null; onHold: boolean; owed: Line[]; chargeback?: boolean; review?: boolean; /** (Batch 16 section 41) a chargeback hold with no verified card yet: Pay waits for step 1 */ verifyFirst?: boolean; /** (Batch 23 section 6) a chargeback hold: what is reserved on the card already, and whether the last reservation lapsed */ reservedCents?: number; reserveExpired?: boolean }) {
  const [err, setErr] = useState("");
  const [failing, setFailing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [changes, setChanges] = useState<Change[] | null>(null);
  // (Owner, Nov 3) The lines of the last stop, until the page's next redraw brings its own.
  const [stopLines, setStopLines] = useState<{ base: Line[]; lines: Line[] } | null>(null);
  const owed = stopLines && stopLines.base === drawn ? stopLines.lines : drawn;
  // (Batch 35 §40, §41) Paid: the page redraws in place; until it has, the button stays greyed with the result line.
  const fin = useFinished(() => setBusy(false));
  const done = fin.line;
  const [bankNote, setBankNote] = useState("");
  // (Batch 17 §11) The bank's check opens inline, under Pay what you owe (one after another when several need it).
  const bank = useBankCheck();
  const [allLines, setAllLines] = useState(false);
  // One check covers every debt it paid: its Cancel sits next to the first of them (shown even while the list is folded).
  const cancelAt = (o: Line, i: number) => !!(o.waiting && o.checkId && owed.findIndex((x) => x.checkId === o.checkId) === i);
  const retry = owed.filter((o) => o.retry);
  const seenTotal = retry.reduce((s, o) => s + o.amountCents, 0);
  // What the page / the stop box showed last: every press (the second too) is checked against it.
  const [total, setTotal] = useState(seenTotal);
  const [shownIds, setShownIds] = useState(retry.map((o) => o.id));
  // (Owner, Nov 3) What each line showed (a chargeback's amount can change under it): the stop then names the change.
  const [shownAmounts, setShownAmounts] = useState<Record<string, number>>(() => Object.fromEntries(retry.map((o) => [o.id, o.amountCents])));
  // (Owner, Oct 29, batch 28 §8) Pay what you owe reserves once: with a reservation in place the button is disabled, and what was added since is charged after the lift.
  const reservedOnce = chargeback && reservedCents > 0;
  // (Owner, Nov 3, §150) Over $200 (the amount on the button) the tick "I confirm this payment is over $200." shows next to it, and the button waits for it. It stays
  // ticked through live redraws while the amount stays over $200, and clears when it drops to $200 or less.
  const over = !reservedOnce && (changes ? total : seenTotal) > PAY_TICK_CENTS;
  const [over200, setOver200] = useState(false);
  if (!over && over200) setOver200(false);
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
      {/* (Owner, Nov 3, batch 35 §145, §148) No daily retries and no new-card charge: only the press charges what's owed (a chargeback hold only reserves it, so not there). */}
      {onHold && !chargeback && <p className="text-xs" data-owed-how="">{OWED_HOW}</p>}
      {/* (Owner, Oct 29, batch 23 section 6) A chargeback hold: Pay what you owe reserves the money; the team's Approve takes it. */}
      {chargeback && reserveExpired && <p data-reserve-expired="">{RESERVE_EXPIRED}</p>}
      {reservedOnce && <p data-reserved="">{reservedAddedLine(reservedCents, seenTotal)}</p>}
      {onHold && review && <p data-hold-review="">After you pay what you owe, the team will review your account before your tests resume.</p>}
      {owed.length > 0 && (
        <div className={allLines ? "max-h-64 overflow-y-auto pr-1" : undefined} data-owed-lines={allLines ? "all" : "first"}>
        <ul className="list-disc pl-5">
          {owed.map((o, i) => !allLines && i >= OWED_FOLD && !cancelAt(o, i) ? null : (
            <li key={o.id} data-owed-line={o.id} data-waiting={o.waiting ? "" : undefined} title={o.full}>
              {allLines ? (o.full ?? o.text) : o.text}
              {o.waiting && !o.after && <> · <b>{OWED_BANK_WAITING}</b></>}
              {o.after && <> · <b data-owed-after="">{o.after}</b></>}
              {/* One check covers every debt it paid: its Cancel sits next to the first of them. */}
              {cancelAt(o, i) && o.checkId && <> <CancelCheck id={o.checkId} /></>}
              {/* (Owner, Nov 3, §133) Part of a payment that paid for several items: what it covered, underneath (the bank gives only an amount, so none is named). */}
              {o.covers && o.covers.length > 0 && (
                <div className="mt-1 text-xs" data-owed-covers={o.id}>
                  That payment covered:
                  <ul className="list-[circle] pl-5">{o.covers.map((x, j) => <li key={j} title={x.full}>{allLines ? (x.full ?? x.text) : x.text}</li>)}</ul>
                </div>
              )}
            </li>
          ))}
        </ul>
        </div>
      )}
      {/* (Owner, Nov 3) A long list folds to its first lines; Show all opens every line with the names uncut, scrolling inside the box. */}
      {owed.length > OWED_FOLD && (
        <button type="button" className="text-xs underline" data-owed-toggle="" onClick={() => setAllLines(!allLines)}>
          {allLines ? "Show fewer" : `Show all ${owed.length} lines`}
        </button>
      )}
      {retry.length > 0 && <div className="flex flex-wrap items-center gap-2">
      {over && (
        <label className="flex max-w-xs items-start gap-2 text-sm" data-over-tick="">
          <input type="checkbox" className="mt-1" checked={over200} disabled={busy} onChange={(e) => setOver200(e.target.checked)} /> {OVER_PAY_TICK_LINE}
        </label>
      )}
      <button
        className="btn"
        disabled={busy || verifyFirst || reservedOnce || (over && !over200)}
        aria-disabled={verifyFirst || reservedOnce}
        onClick={async () => {
          setBusy(true);
          setErr("");
          setFailing([]);
          try {
            const r = await api<{ stillFailing: string[]; lifted: boolean; confirm?: BankAction[]; reservedCents?: number }>("/api/payments/owed", { seenTotalCents: total, seenIds: shownIds, seenAmounts: shownAmounts, confirmed: changes != null, over200: over && over200 });
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
              const next = linesAfterStop(drawn, e.data);
              if (next !== drawn) {
                setStopLines({ base: drawn, lines: next });
                setShownAmounts(Object.fromEntries(next.filter((o) => o.retry).map((o) => [o.id, o.amountCents])));
              }
            } else setErr(errOf(e));
            if (!(e instanceof ApiError && e.code === "nothing_owed")) setBusy(false);
          }
        }}
      >
        {reservedOnce ? `${money(changes ? total : seenTotal)} is charged after the team approves` : `Pay what you owe (${money(changes ? total : seenTotal)})`}
      </button></div>}
      {bank.view}
      {/* (Owner, Oct 28, batch 16 section 41) The chargeback steps in order: the card first. */}
      {verifyFirst && <p className="text-xs" data-verify-first="">Verify your card first (step 1): then you can pay what you owe.</p>}
      <ChangesBox changes={changes} tail={over && !over200 ? `Tick “${OVER_PAY_TICK_LINE}” and press again to go ahead.` : undefined} />
      {/* (§156) The bank's check ended without the payment: named like any refusal ("Your Pay didn't go through: Your bank didn't confirm …"). */}
      {bankNote && <p className="info" data-bank-not-confirmed="">{refusalLine("Pay what you owe", bankNote)}</p>}
      {done && <p className="ok">{done}</p>}
      {failing.length > 0 && (
        <p className="err">
          Still declined: {failing.join("; ")}. Your tests stay paused until everything is paid. <a href="/app/payments#card">Update your card</a> and try again.
        </p>
      )}
      {chargeback && <p>Pay what you owe reserves the money on your card: nothing is taken until the team approves lifting your hold, and your tests resume then.</p>}
      <Err text={err} press="Pay what you owe" />
    </div>
  );
}
