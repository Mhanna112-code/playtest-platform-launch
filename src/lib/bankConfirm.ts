"use client";
import { TAB, api, pageUser } from "@/lib/client";
import type { CancelKind } from "@/lib/bankNotice";

// (Owner, Oct 29, batch 11) "Your bank wants to confirm this payment". (Batch 17 §11) The bank's check opens INLINE, directly under the button that was pressed (see
// components/BankCheck.tsx): the bank's own page in a frame (`checkUrl`), or, with the fake Stripe (no publishable key, tests, recordings), a clearly-marked stand-in.
// Only when Stripe gives no page to show (an old payment) does Stripe.js's own pop-up open, as a fallback.

type StripeJs = {
  handleNextAction: (o: { clientSecret: string }) => Promise<{ error?: { message?: string }; paymentIntent?: { status: string } }>;
  confirmCardPayment: (clientSecret: string, o?: { payment_method?: string }) => Promise<{ error?: { message?: string }; paymentIntent?: { status: string } }>;
};

export function loadStripeJs<T = StripeJs>(): Promise<(pk: string) => T> {
  const w = window as unknown as { Stripe?: (pk: string) => T };
  if (w.Stripe) return Promise.resolve(w.Stripe);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://js.stripe.com/v3/";
    s.onload = () => (w.Stripe ? resolve(w.Stripe) : reject(new Error("Stripe didn't load.")));
    s.onerror = () => reject(new Error("Stripe didn't load. Check your connection and try again."));
    document.head.appendChild(s);
  });
}

export type BankAction = {
  requiresAction: true; paymentId: string; clientSecret: string; publishableKey: string; simulated: boolean; paymentMethod?: string | null;
  /** "none": it went through without a check (a "Confirm with your bank" Stripe needed nothing more for) */ needs?: "action" | "confirm" | "none";
  /** (Batch 17 §11) the bank's check page, shown inline */ checkUrl?: string | null;
  /** (§160) What Cancel under the bank's window does: the developer's own press (default), a charge made while away that keeps waiting, Confirm all, Verify a card */ cancel?: CancelKind;
};
export const needsBank = (r: unknown): r is BankAction => !!r && typeof r === "object" && (r as { requiresAction?: unknown }).requiresAction === true;

/** How the inline check ended, told to the server: the stand-in's answer, or nothing (the server asks Stripe). */
export type Simulate = "succeeded" | "failed" | undefined;

/**
 * (Batch 17 §11) A payment's check ended: the payment goes through, or "Your bank didn't confirm the payment, so nothing was charged." (thrown as a plain sentence).
 * (Owner, Nov 5, §210) `pi`: the window's own PaymentIntent (checkPiOf), so a payment its own check paid that something else recorded first (a chargeback won as
 * the bank approved it, …) reads as paid, never "You already confirmed this payment.".
 */
export async function finishPayment<T = Record<string, unknown>>(paymentId: string, simulate?: Simulate, pi?: string): Promise<T> {
  try {
    return await api<T>("/api/payments/confirm", { paymentId, ...(simulate ? { simulate } : {}), ...(pi ? { pi } : {}) });
  } catch (e) {
    throw new Error((e as Error).message);
  }
}

/**
 * (Owner, Nov 5, §210) The line a finish adds under the press's success line when a chargeback it repaid was won as the bank approved it and refunded at once:
 * "Your bank's chargeback on your $10.00 Pay for Ana Silva's written answers on “Harbor Run” was reversed: $25.00 refunded."; "" otherwise.
 */
export const refundLineOf = (r: unknown) => { const l = (r as { refundLine?: unknown } | null)?.refundLine; return typeof l === "string" ? l : ""; };

/** (§158) What the open bank check asks about: a payment's (or a chargeback hold's reservation's) check, or Verify a card's SetupIntent. */
export type PeekTarget = { paymentId: string; /** (§171 B4) the window's own PaymentIntent */ pi?: string } | { setupIntent: string };
/** (Owner, Nov 4, §171 B4) The PaymentIntent a bank window holds, read from its client secret ("pi_…_secret_…"); "" when it carries none. */
export const checkPiOf = (clientSecret: string | null | undefined) => { const i = (clientSecret ?? "").indexOf("_secret"); return i > 0 ? clientSecret!.slice(0, i) : ""; };
export type PeekAnswer = "waiting" | "done";
/**
 * (Owner, Nov 3, §160) A peek's whole answer: whether Stripe still waits, and what the box's blue notice says: the changes since the press that would have stopped
 * it (`changes`, with what Complete still does: `still`), or that the check was cancelled underneath it (`cancelled`).
 */
export type PeekResult = { status: PeekAnswer; changes?: string[]; still?: string; cancelled?: string };
/**
 * (Owner, Nov 3, §160) Closing or reloading the page while the bank's window is open does what Cancel does: the same finish request, sent as a beacon on pagehide (it
 * survives the page going away). The server asks Stripe first (paid if it went through; the developer's own press otherwise cancelled; a charge made while away
 * keeps waiting). Only a crash leaves it open: then the 15-minute clock ends it.
 */
export function leaveBeacon(url: string, body: Record<string, unknown>) {
  try {
    return navigator.sendBeacon(url, new Blob([JSON.stringify({ ...body, leave: true })], { type: "application/json" }));
  } catch {
    return false;
  }
}
/** How often the open bank check asks whether Stripe still waits. */
export const PEEK_EVERY_MS = 3000;

/**
 * (Owner, Nov 3, §158) Is Stripe still waiting for the customer? A read-only question (nothing is finished, cancelled or charged). Quiet: a failed peek (offline, a
 * refusal) is "waiting" and shows nothing, so the page simply asks again (Close still ends it). (§160) `since`: when the bank box opened (the press), so the
 * answer also carries the notice's lines; the page's tab goes with it (what this same tab did is never a change).
 */
export async function peekBank(t: PeekTarget, since?: string): Promise<PeekResult> {
  try {
    const res = await fetch("/api/payments/confirm", {
      method: "POST",
      headers: { "content-type": "application/json", ...(TAB ? { "x-tab": TAB } : {}), "x-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone, ...(pageUser() ? { "x-uid": pageUser() } : {}) },
      // (Owner, Nov 4, §177) The page the window is open on: away from the payment's own test page, the notice names the test on each line.
      body: JSON.stringify({ ...t, ...(since ? { since } : {}), ...(typeof location !== "undefined" ? { page: location.pathname } : {}), peek: true }),
    });
    if (!res.ok) return { status: "waiting" };
    const data = (await res.json().catch(() => null)) as { status?: unknown; changes?: unknown; still?: unknown; cancelled?: unknown } | null;
    const changes = Array.isArray(data?.changes) ? data.changes.filter((x): x is string => typeof x === "string" && !!x) : [];
    return {
      status: data?.status === "done" ? "done" : "waiting",
      ...(changes.length ? { changes } : {}),
      ...(typeof data?.still === "string" && data.still ? { still: data.still } : {}),
      ...(typeof data?.cancelled === "string" && data.cancelled ? { cancelled: data.cancelled } : {}),
    };
  } catch {
    return { status: "waiting" };
  }
}

/**
 * (§158) Ask every `everyMs` until the peek says done, then call `onDone` once. Returns the stop (the box closed). (§160) Every answer with something for the box's
 * notice goes to `onNews` first, as it arrives.
 */
export function watchBank(peek: () => Promise<PeekAnswer | PeekResult>, onDone: () => void, everyMs = PEEK_EVERY_MS, onNews?: (r: PeekResult) => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    if (stopped) return;
    const got = await peek().catch((): PeekAnswer => "waiting");
    const a: PeekResult = typeof got === "string" ? { status: got } : got;
    if (stopped) return;
    if (onNews && (a.changes?.length || a.cancelled)) onNews(a);
    if (a.status === "done") {
      stopped = true;
      onDone();
      return;
    }
    timer = setTimeout(tick, everyMs);
  };
  timer = setTimeout(tick, everyMs);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/** "Confirm with your bank": what the inline check needs for a payment that waits (a charge made while the developer was away, or a renewal). */
export async function startWaiting(paymentId: string): Promise<BankAction> {
  const start = await api<Omit<BankAction, "requiresAction">>("/api/payments/confirm", { paymentId, start: true });
  return { ...start, requiresAction: true, needs: start.needs ?? "confirm" };
}

/** The fallback when Stripe gives no page to show inline: Stripe.js's own pop-up (the server still decides how it ended). */
export async function stripePopup(a: BankAction) {
  try {
    const stripe = (await loadStripeJs())(a.publishableKey);
    if (a.needs === "confirm") await stripe.confirmCardPayment(a.clientSecret, a.paymentMethod ? { payment_method: a.paymentMethod } : undefined);
    else await stripe.handleNextAction({ clientSecret: a.clientSecret });
  } catch {
    // The pop-up didn't open: the server still decides (nothing is charged unless Stripe says it went through).
  }
}

/** (Batch 17 §11) How many inline checks are open on this page: the page's live refresh waits while one is (it would move the piece away from under it). */
export const bankCheckOpen = () => typeof window !== "undefined" && ((window as unknown as { __bankChecks?: number }).__bankChecks ?? 0) > 0;
export function countBankCheck(by: 1 | -1) {
  const w = window as unknown as { __bankChecks?: number };
  w.__bankChecks = Math.max(0, (w.__bankChecks ?? 0) + by);
}
