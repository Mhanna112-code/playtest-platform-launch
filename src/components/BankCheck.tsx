"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { OwnPanel, ResizeBox } from "@/components/Panel";
import { bringInView } from "@/lib/markJump";
import { liveBeat } from "@/lib/liveSync";
import { checkPiOf, countBankCheck, finishPayment, leaveBeacon, peekBank, stripePopup, watchBank, type BankAction, type PeekAnswer, type PeekResult, type Simulate } from "@/lib/bankConfirm";
import { BANK_CANCEL, CANCEL_HINTS, NOTICE_HEAD, noticeLine } from "@/lib/bankNotice";
import { BANK_CHECK_TITLE, BANK_STAND_IN, BANK_STAND_IN_NOTE } from "@/lib/rules";

type Ended = { ok: true; value: unknown } | { ok: false; error: Error };
/** (§158) The open check's question; (§160) `since`: when its box opened (the press). */
export type Peek = (since: string) => Promise<PeekAnswer | PeekResult>;
/** (Owner, Nov 5, §207) How the box ends: the stand-in's answer, and `cancel` when the developer pressed the box's own Cancel (not the bank's answer). */
export type BankFinish = (s?: Simulate, cancel?: boolean) => Promise<unknown>;
/** (§160) What the blue notice shows: every change line once, in the order they arrived; what Complete still does; or that the check was cancelled. */
export type Notice = { lines: string[]; still: string; cancelled: string };
export const NO_NOTICE: Notice = { lines: [], still: "", cancelled: "" };

/** (§160) A peek's answer added to the notice: new lines appended (never twice), the latest "still" and cancelled line kept. */
export function addNews(n: Notice, r: PeekResult): Notice {
  const fresh = (r.changes ?? []).map(noticeLine).filter((l, i, all) => !n.lines.includes(l) && all.indexOf(l) === i);
  const still = r.still || n.still, cancelled = r.cancelled || n.cancelled;
  if (!fresh.length && still === n.still && cancelled === n.cancelled) return n;
  return { lines: [...n.lines, ...fresh], still, cancelled };
}

/** (Owner, Nov 4, §194) More change lines than this sit in a scroll box (about 4–5 lines tall) with their count above it. */
export const NOTICE_LINES_SHOWN = 4;
/** (§194) The scroll box's height at first: about 4–5 lines of the notice (its grip drags it taller or shorter). */
export const NOTICE_SCROLL_MAX = "8rem";
/** (§194) "12 changes" above the scroll box. */
export const noticeCount = (n: number) => `${n} ${n === 1 ? "change" : "changes"}`;
/** (§194) Whether a scroll box is scrolled to (within a few pixels of) its bottom. */
export const isAtBottom = (el: { scrollHeight: number; scrollTop: number; clientHeight: number }) => el.scrollHeight - el.scrollTop - el.clientHeight < 8;

/**
 * (Owner, Nov 3, §160; Nov 4: at the bottom) The blue notice INSIDE the bank check's box, at its bottom under the bank's frame and Cancel: what changed while the bank's page
 * was open that would have stopped the press ("While your bank's page was open: Ana Silva disputed the pay for her recording.", then "Complete still pays $10.00 as
 * pressed; or press Close."), or that the check was cancelled underneath it ("This bank check was cancelled: … Pressing Complete won't charge anything.").
 * (Owner, Nov 4, §194) More than 4 change lines sit in a scroll box about 4–5 lines tall (the app's panel: a grip, its height kept per check by `id`), with
 * "N changes" above it; it shows the newest line, and a line that arrives scrolls it to the bottom only if it was already there (someone who scrolled up to read
 * isn't moved). The final line (Complete still pays … / cancelled …) stays outside it, always in view. The bank box is its own element inside Needs you's panel,
 * so this list scrolls on its own (OwnPanel), an exception to §187's "only the outermost panel scrolls".
 */
export function BankNotice({ notice, id = "card" }: { notice: Notice; /** (§194) the check (its payment's id): the scroll box's kept height */ id?: string }) {
  const list = useRef<HTMLUListElement>(null);
  const atBottom = useRef(true);
  const long = notice.lines.length > NOTICE_LINES_SHOWN;
  // (§194) Whether the reader is at the bottom of the list (a line arriving doesn't scroll, so this is what they last left it at).
  useEffect(() => {
    const el = long ? list.current?.closest<HTMLElement>("[data-panel-box]") : null;
    if (!el) return;
    const seen = () => { atBottom.current = isAtBottom(el); };
    el.addEventListener("scroll", seen, { passive: true });
    return () => el.removeEventListener("scroll", seen);
  }, [long]);
  // (§194) The newest line in view: when the box first appears, and when a line arrives while the reader was at the bottom.
  useLayoutEffect(() => {
    const el = list.current?.closest<HTMLElement>("[data-panel-box]");
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [notice.lines.length]);
  if (!notice.lines.length && !notice.cancelled) return null;
  const lines = <ul ref={list} className={`${long ? "" : "my-1 "}list-disc pl-5`}>{notice.lines.map((l) => <li key={l} data-bank-notice-line="">{l}</li>)}</ul>;
  return (
    <div className="info" role="status" aria-live="polite" data-bank-notice="">
      {notice.lines.length > 0 && (
        <>
          <p className="font-medium">{NOTICE_HEAD}</p>
          {long ? (
            <>
              <p className="text-xs text-sky-100/80" data-bank-notice-count="">{noticeCount(notice.lines.length)}</p>
              <div className="my-1" data-bank-notice-scroll="">
                <OwnPanel><ResizeBox id={`bank-notice-${id}`} label="Changes while your bank's page was open" defaultMax={NOTICE_SCROLL_MAX}>{lines}</ResizeBox></OwnPanel>
              </div>
            </>
          ) : lines}
        </>
      )}
      {notice.cancelled ? <p className="font-semibold" data-bank-notice-cancelled="">{notice.cancelled}</p> : notice.still && <p className="font-semibold" data-bank-notice-still="">{notice.still}</p>}
    </div>
  );
}

/**
 * (Batch 17 §11) The bank's check, INLINE, directly under the button that was pressed (never a pop-up): the bank's own page in a frame (it returns to
 * /api/payments/bank-return, which tells this page it finished; the server then asks Stripe how it ended), or, with the fake Stripe, a clearly-marked stand-in with
 * Confirm / Cancel so tests and recordings show the step.
 * (Owner, Nov 3, §158) The return page can be blocked (on localhost Chrome stops Stripe's public page from sending the frame back: Private Network Access), so while the
 * bank's page is open the page also asks the server every few seconds whether Stripe still waits (`peek`, read-only); once it doesn't, the check ends as the return
 * message would (first one wins). "Close" under the frame ends it too; the server decides how it ended.
 * (Owner, Nov 3, §160) Each answer also says what changed since the press, or that the check was cancelled: shown in the blue notice at the bottom of the box as it arrives.
 * Plain changes never close the box (the developer decides: Complete still pays as pressed, or Close); a cancelled check stays open with its notice until the
 * bank's return or Close ends it with the usual finish.
 */
export function BankCheckView({ action, finish, onEnd, peek, leave, since = "", notice: initial = NO_NOTICE }: { action: BankAction; finish: BankFinish; onEnd: (r: Ended) => void; peek?: Peek; /** (§160) the page goes away with the window open: what Cancel does, as a beacon */ leave?: () => void; since?: string; /** tests and recordings: a notice to start with */ notice?: Notice }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(initial);
  const box = useRef<HTMLDivElement>(null);
  const ended = useRef(false);
  const opened = useRef(since || new Date().toISOString());
  const end = useCallback(async (simulate?: Simulate, cancel = false) => {
    if (ended.current) return;
    ended.current = true;
    setBusy(true);
    try {
      onEnd({ ok: true, value: await finish(simulate, cancel) });
    } catch (e) {
      onEnd({ ok: false, error: e instanceof Error ? e : new Error(String(e)) });
    }
  }, [finish, onEnd]);
  useEffect(() => bringInView(box.current), []);
  // (Owner, Nov 3, §160) Closing or reloading the page with the window open does what Cancel does (a beacon: it outlives the page). Not once the box has ended.
  useEffect(() => {
    if (!leave) return;
    const gone = () => {
      if (ended.current) return;
      ended.current = true;
      leave();
    };
    window.addEventListener("pagehide", gone);
    return () => window.removeEventListener("pagehide", gone);
  }, [leave]);
  useEffect(() => {
    if (!action.checkUrl) return;
    const heard = (e: MessageEvent) => {
      if (e.origin === window.location.origin && (e.data as { bankCheck?: unknown } | null)?.bankCheck === "done") void end();
    };
    window.addEventListener("message", heard);
    return () => window.removeEventListener("message", heard);
  }, [action.checkUrl, end]);
  // (§158) Only the bank's own page is watched (the stand-in's Confirm / Cancel decide); stops when the box closes. (§160) Its news fills the notice.
  useEffect(() => {
    if (!action.checkUrl || !peek) return;
    return watchBank(() => peek(opened.current), () => void end(), undefined, (r) => setNotice((n) => addNews(n, r)));
  }, [action.checkUrl, peek, end]);
  if (!action.checkUrl) {
    return (
      <div ref={box} role="group" aria-label={BANK_STAND_IN} className="basis-full space-y-2 rounded-lg border-2 border-dashed border-amber-300/60 bg-amber-500/10 p-3 text-sm" data-bank-check="stand-in">
        <p className="font-semibold text-amber-100">{BANK_STAND_IN}</p>
        <p className="text-xs text-amber-200/80">{BANK_STAND_IN_NOTE}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn px-3 py-1.5 text-sm" disabled={busy} onClick={() => end("succeeded")} data-bank-confirm="">Confirm</button>
          <button type="button" className="btn-ghost px-3 py-1.5 text-sm" disabled={busy} onClick={() => end("failed", true)} data-bank-cancel="">Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <div ref={box} role="group" aria-label={BANK_CHECK_TITLE} className="basis-full space-y-2 rounded-lg border border-sky-300/40 bg-sky-500/10 p-3 text-sm" data-bank-check="bank">
      <p className="font-semibold text-white">{BANK_CHECK_TITLE}</p>
      <iframe src={action.checkUrl} title={BANK_CHECK_TITLE} className="h-[28rem] w-full rounded-lg border border-white/10 bg-white" />
      <p className="text-xs text-sky-100/80" data-bank-close-hint="">{CANCEL_HINTS[action.cancel ?? "press"]}</p>
      <button type="button" className="btn-ghost px-3 py-1.5 text-sm" disabled={busy} onClick={() => end(undefined, true)} data-bank-close="">{BANK_CANCEL}</button>
      {/* (Owner, Nov 4) The notice sits at the bottom of the box, under the frame and Cancel. */}
      <BankNotice notice={notice} id={action.paymentId || "card"} />
    </div>
  );
}

type Open = { action: BankAction; finish: BankFinish; peek?: Peek; leave?: () => void; since: string; resolve: (v: unknown) => void; reject: (e: Error) => void };

/**
 * (Batch 17 §11) A button's inline bank check: `check(action)` opens it (render `view` directly under the button) and resolves with the server's result when the payment
 * went through, or throws the plain sentence when it didn't. `finish` overrides what ends it (Verify a card). While it is open (`open`), the button stays disabled and the
 * page's live refresh waits. (§158) `peek` asks whether Stripe still waits: by default the payment's (or reservation's) own `paymentId`; Verify a card passes its
 * SetupIntent's. (§160) It is asked with the moment the box opened (the press), so its answer carries the notice's lines since then.
 */
export function useBankCheck() {
  const [open, setOpen] = useState<Open | null>(null);
  const cur = useRef<Open | null>(null);
  useEffect(() => {
    if (!open) return;
    countBankCheck(1);
    return () => countBankCheck(-1);
  }, [open]);
  const check = useCallback(<T,>(a: BankAction, finish?: (s?: Simulate, cancel?: boolean) => Promise<T>, peek?: Peek, leave?: () => void): Promise<T> => {
    // (Owner, Nov 5, §210) The finish names this window's own check too: paid by it but recorded first by something else reads as paid.
    const fin = finish ?? ((s?: Simulate) => finishPayment<T>(a.paymentId, s, checkPiOf(a.clientSecret) || undefined));
    // (Owner, Nov 4, §171 B4) The peek names this window's own check (its PaymentIntent, from the client secret): the server says when it is no longer the live one.
    const look: Peek | undefined = peek ?? (!finish && a.paymentId ? (since: string) => peekBank({ paymentId: a.paymentId, ...(checkPiOf(a.clientSecret) ? { pi: checkPiOf(a.clientSecret) } : {}) }, since) : undefined);
    if (a.needs === "none") return fin();
    if (!a.checkUrl && !a.simulated) return stripePopup(a).then(() => fin());
    return new Promise<T>((resolve, reject) => {
      // (§160) Leaving the page: the payment's own finish as a beacon (Verify a card passes its own).
      const away = leave ?? (!finish && a.paymentId ? () => void leaveBeacon("/api/payments/confirm", { paymentId: a.paymentId }) : undefined);
      cur.current = { action: a, finish: fin, peek: look, leave: away, since: new Date().toISOString(), resolve: resolve as (v: unknown) => void, reject };
      setOpen(cur.current);
    });
  }, []);
  const onEnd = useCallback((r: Ended) => {
    const o = cur.current;
    cur.current = null;
    setOpen(null);
    if (o && r.ok) o.resolve(r.value);
    else if (o && !r.ok) o.reject(r.error);
    // (§160) The page's live checks waited while the window was open: they run now (a redraw drawn meanwhile shows the payment as it was), not at the next beat.
    setTimeout(liveBeat, 400);
  }, []);
  const view = open ? <BankCheckView key={open.action.paymentId || "card"} action={open.action} finish={open.finish} peek={open.peek} leave={open.leave} since={open.since} onEnd={onEnd} /> : null;
  return { check, view, open: !!open };
}
