"use client";
import { api, errOf } from "@/lib/client";

// (Owner, Oct 29, batch 11) "Your bank wants to confirm this payment": the bank's own pop-up in the page, with Stripe.js. Without a publishable key (the local fake, or dev
// without Stripe) the pop-up is simulated with the browser's confirm dialog.

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

export type BankAction = { requiresAction: true; paymentId: string; clientSecret: string; publishableKey: string; simulated: boolean; paymentMethod?: string | null; needs?: "action" | "confirm" };
export const needsBank = (r: unknown): r is BankAction => !!r && typeof r === "object" && (r as { requiresAction?: unknown }).requiresAction === true;

/**
 * Show the bank's pop-up for one payment, then tell the server how it ended. Resolves with the server's result when the payment went through; throws the plain sentence
 * ("Your bank didn't confirm the payment, so nothing was charged.") when it didn't.
 */
export async function confirmWithBank<T = Record<string, unknown>>(a: BankAction): Promise<T> {
  let simulate: string | undefined;
  if (a.simulated) {
    simulate = window.confirm("Your bank wants you to confirm this payment. Confirm it?") ? "succeeded" : "failed";
  } else {
    try {
      const stripe = (await loadStripeJs())(a.publishableKey);
      const r = a.needs === "confirm" ? await stripe.confirmCardPayment(a.clientSecret, a.paymentMethod ? { payment_method: a.paymentMethod } : undefined) : await stripe.handleNextAction({ clientSecret: a.clientSecret });
      void r; // the server asks Stripe how it ended
    } catch {
      // The pop-up didn't open: the server still decides (nothing is charged unless Stripe says it went through).
    }
  }
  try {
    return await api<T>("/api/payments/confirm", { paymentId: a.paymentId, ...(simulate ? { simulate } : {}) });
  } catch (e) {
    throw new Error(errOf(e));
  }
}

/** Confirm on Payments: a payment made while the developer was away waits for their bank. */
export async function confirmWaiting(paymentId: string) {
  const start = await api<Omit<BankAction, "requiresAction">>("/api/payments/confirm", { paymentId, start: true });
  return confirmWithBank({ ...start, requiresAction: true, needs: start.needs ?? "confirm" });
}
