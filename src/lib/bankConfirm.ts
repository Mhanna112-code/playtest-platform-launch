"use client";
import { api } from "@/lib/client";

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
};
export const needsBank = (r: unknown): r is BankAction => !!r && typeof r === "object" && (r as { requiresAction?: unknown }).requiresAction === true;

/** How the inline check ended, told to the server: the stand-in's answer, or nothing (the server asks Stripe). */
export type Simulate = "succeeded" | "failed" | undefined;

/** (Batch 17 §11) A payment's check ended: the payment goes through, or "Your bank didn't confirm the payment, so nothing was charged." (thrown as a plain sentence). */
export async function finishPayment<T = Record<string, unknown>>(paymentId: string, simulate?: Simulate): Promise<T> {
  try {
    return await api<T>("/api/payments/confirm", { paymentId, ...(simulate ? { simulate } : {}) });
  } catch (e) {
    throw new Error((e as Error).message);
  }
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
