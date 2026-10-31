"use client";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/client";
import type { AccountState } from "@/lib/server/accountState";
import { AdminButton } from "./AdminButton";
import { PreviewButton } from "./PreviewButton";
import { TeamCloseBox } from "./TeamCloseBox";

/**
 * (Batch 15 section 16; batch 17 §6) An account's Suspend (per side, a reason up to 1,000 characters, with Preview), Reinstate per suspended side and Delete: the same
 * buttons on the Accounts list and on a profile's admin view. Suspend and Reinstate send when the Preview (or else this view) was loaded; if another admin suspended,
 * reinstated or deleted that side since, the press is refused naming who and when, and the state shown here updates from the refusal.
 */
export function AccountActions({ initial }: { initial: AccountState }) {
  const [acct, setAcct] = useState(initial);
  // (Owner, Oct 30, batch 33 §7) A redraw after another admin's change (the page's live poll) brings a fresher state: it is shown at once. What this admin typed
  // stays: the boxes are keyed by the state they belong to, not the whole block, so only a button whose side changed starts afresh.
  useEffect(() => {
    setAcct((now) => (initial.at > now.at ? initial : now));
  }, [initial]);
  const [previewAt, setPreviewAt] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const seen = { since: previewAt ?? acct.at, from: previewAt ? "preview" : "page" };
  const refused = (e: unknown) => {
    const now = e instanceof ApiError ? (e.data as { account?: AccountState | null }).account : undefined;
    if (now) {
      setAcct(now);
      setPreviewAt(null); // the Preview described the old state
    }
    setMsg((e as Error).message);
  };
  // (Owner, Oct 30, batch 34 §1) Delete stopped once (another admin changed this account since the page loaded): the box is under Delete, and the state shown here
  // updates from the stop.
  const stopped = (data: Record<string, unknown>) => {
    const now = (data as { account?: AccountState | null }).account;
    if (now) {
      setAcct(now);
      setPreviewAt(null);
    }
    setMsg("");
  };
  const line = msg ? <p className="err" data-account-msg="">{msg}</p> : null;
  if (acct.deleted) {
    return (
      <div className="space-y-1" data-account-actions={acct.id} data-account-state="deleted">
        <p className="text-xs text-rose-300">{acct.deleted}</p>
        {line}
      </div>
    );
  }
  const open = (["developer", "tester"] as const).filter((s) => (s === "developer" ? acct.isDeveloper : acct.isTester) && !acct.suspended[s]);
  // (Owner, Oct 30, batch 35 §11) Suspend's draft belongs to the sides open when it was typed: when another admin suspended or reinstated a side since, the fresh
  // box (batch 33 §7) starts empty, never with the old state's side and Why.
  const openKey = open.join(",");
  const roles = (acct.isDeveloper ? 1 : 0) + (acct.isTester ? 1 : 0);
  return (
    <div className="space-y-1" data-account-actions={acct.id} data-account-state={acct.suspended.developer || acct.suspended.tester ? "suspended" : "normal"}>
      {/* (Owner, Oct 30, batch 15 section 16) Each suspended side has its own line and Reinstate. (Batch 33) A <div>, never a <p>: the button's mistake list is a <div>. */}
      {(["developer", "tester"] as const).filter((s) => acct.suspended[s]).map((s) => (
        <div key={s} className="flex flex-wrap items-center gap-2" data-suspended-side={s}>
          <b>Suspended ({s} side)</b> <span className="line-clamp-2 max-w-full break-words" title={acct.suspended[s]}>{acct.suspended[s]}</span>
          {/* (Owner, Oct 30, batch 34 §4) The developer side waits for a payment or chargeback hold to clear: a note instead of Reinstate (back on the live redraw). */}
          {s === "developer" && acct.held ? (
            <span className="note" data-reinstate-waits={acct.held}>{acct.held === "chargeback" ? "Reinstate waits for the chargeback hold: the team approves it first." : "Reinstate waits for the payment hold: they pay what they owe first."}</span>
          ) : (
            <AdminButton action="unsuspend" id={acct.id} label="Reinstate" extra={{ side: s, ...seen }} onRefused={refused} />
          )}
        </div>
      ))}
      {/* (Owner, Oct 29, batch 23 section 7) Top to bottom, full width (phones too): Preview and its effects, then the side choice and the reason box, then Suspend. */}
      {(open.length > 0 || roles === 0) && (
        <div key={`suspend:${open.join(",")}`} className="flex w-full max-w-xl flex-col items-start gap-2" data-suspend-block="">
          <PreviewButton id={acct.id} onLoaded={setPreviewAt} />
          {/* A one-role account just shows Suspend; an account with both roles chooses the side. */}
          {open.length > 0 && (roles === 2 && open.length === 2 ? (
            <AdminButton action="suspend" id={acct.id} label="Suspend" danger stacked extra={seen} onRefused={refused} choice={{ name: "side", label: "Side to suspend", options: [{ value: "developer", label: "Developer side" }, { value: "tester", label: "Tester side" }] }} fields={[{ name: "note", label: "Why" }]} draftFor={openKey} />
          ) : (
            <AdminButton action="suspend" id={acct.id} label={roles === 2 ? `Suspend the ${open[0]} side` : "Suspend"} danger stacked extra={{ side: open[0], ...seen }} onRefused={refused} fields={[{ name: "note", label: "Why" }]} draftFor={openKey} />
          ))}
          {roles === 0 && <AdminButton action="suspend" id={acct.id} label="Suspend" danger stacked extra={seen} onRefused={refused} fields={[{ name: "note", label: "Why" }]} draftFor={openKey} />}
        </div>
      )}
      {/* (Batch 30 §5) A developer's open reviews, closed at $0 by the team (Preview first, then the reason). */}
      {acct.isDeveloper && <TeamCloseBox id={acct.id} scope="developer" />}
      <div className="flex flex-wrap items-center gap-2">
        <AdminButton action="delete-account" id={acct.id} label="Delete account" danger extra={{ since: acct.at }} onRefused={refused} onStop={stopped} fields={[{ name: "note", label: "Why" }]} />
      </div>
      {line}
    </div>
  );
}
