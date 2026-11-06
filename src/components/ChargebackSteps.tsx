"use client";
import { useFinished } from "@/lib/usePress";
import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Err } from "@/components/Err";
import { api, errOf } from "@/lib/client";
import { CARD_CHECK_CANCELLED } from "@/lib/bankNotice";
import { stepsLine } from "@/lib/pause";
import { useBankCheck } from "@/components/BankCheck";
import { CARD_NOT_VERIFIED } from "@/lib/rules";
import { leaveBeacon, peekBank, type Simulate } from "@/lib/bankConfirm";

/** (Owner, Nov 5, §207) The developer pressed Cancel under the card check's window and the card wasn't verified: a cancel, not a failure. */
export class CardCheckCancelled extends Error {
  constructor() {
    super(CARD_CHECK_CANCELLED);
  }
}

type Steps = { cardVerified: boolean; owedPaid: boolean; approved: boolean; remaining: string[]; /** (Owner, Nov 3) from the 2nd chargeback */ reviewFirst?: boolean; count?: number };

type CardElement = { mount: (el: HTMLElement) => void; on: (event: "ready", fn: () => void) => void; destroy: () => void };
type Elements = { create: (t: "payment", o?: { wallets?: { link?: "auto" | "never"; applePay?: "auto" | "never"; googlePay?: "auto" | "never" } }) => CardElement; submit: () => Promise<{ error?: { message?: string } }> };
type StripeJs = {
  elements: (o: { mode: "setup"; currency: string; paymentMethodCreation: "manual"; paymentMethodTypes: string[] }) => Elements;
  createPaymentMethod: (o: { elements: Elements }) => Promise<{ error?: { message?: string }; paymentMethod?: { id: string } }>;
};

function loadStripe(): Promise<(pk: string) => StripeJs> {
  const w = window as unknown as { Stripe?: (pk: string) => StripeJs };
  if (w.Stripe) return Promise.resolve(w.Stripe);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://js.stripe.com/v3/";
    s.onload = () => (w.Stripe ? resolve(w.Stripe) : reject(new Error("Stripe didn't load.")));
    s.onerror = () => reject(new Error("Stripe didn't load. Check your connection and try again."));
    document.head.appendChild(s);
  });
}

/**
 * (Owner, Oct 26) A chargeback hold has three steps: a card verified with 3D Secure, what you owe paid (the box below), and the team's approval.
 * Paying alone never lifts it; this box says which steps remain.
 */
export function ChargebackSteps({ steps }: { steps: Steps }) {
  const [err, setErr] = useState("");
  // (§156) A refusal names the button pressed: "Verify a card" (starts the check) or the card form's "Verify this card".
  const [errPress, setErrPress] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ stripe: StripeJs; elements: Elements; setupIntentId: string } | null>(null);
  // (Batch 35 §40, §41) Verified: the page redraws in place (the step ticks); until it has, the button stays greyed with "Card verified.".
  const fin = useFinished(() => setForm(null));
  const done = fin.line || (fin.done ? " " : "");
  // (Batch 17 §11) The bank's check (3D Secure) opens inline, under the button; with the fake Stripe, the clearly-marked stand-in.
  const bank = useBankCheck();
  // (§160) Ended without a verified card (Cancel, or the bank refused): the server cancels the card check at Stripe too (`cancel`).
  // (Owner, Nov 5, §207) Ended by the developer's own Cancel and not verified: "Cancelled: your card wasn't changed." (a plain line, not a refusal).
  // The server answers it as a cancel (`cancelled`, never a 409), so no refusal is kept for it and the page doesn't redraw for it.
  const finish = (setupIntent: string) => async (simulate?: Simulate, cancel = false) => {
    const r = await api<{ verified: boolean; cancelled?: boolean }>("/api/payments/verify-card", { finish: true, setupIntent, cancel: true, ...(cancel ? { pressedCancel: true } : {}), ...(simulate ? { simulate } : {}) });
    if (r?.cancelled) throw new CardCheckCancelled();
    return r;
  };
  const [cancelled, setCancelled] = useState("");
  /** A failed step: the developer's own Cancel is its plain line; anything else is the named refusal under the button. */
  const failed = (e: unknown) => (e instanceof CardCheckCancelled ? setCancelled(e.message) : setErr(errOf(e)));
  const check = async (setupIntent: string, checkUrl: string | null, simulated: boolean) => {
    await bank.check({ requiresAction: true, paymentId: "", clientSecret: "", publishableKey: "", simulated, checkUrl, cancel: "card" }, finish(setupIntent), (since) => peekBank({ setupIntent }, since), () => void leaveBeacon("/api/payments/verify-card", { finish: true, setupIntent, cancel: true })); // (§158; §160: a cancelled card check is said; leaving the page cancels it)
    fin.finish("Card verified.");
  };
  const mount = useRef<HTMLDivElement>(null);
  // (Batch 28 §19) Stripe's card form is mounted once its box is on the page (after the SetupIntent arrived), and "Verify this card" waits until the form is ready: a
  // timer fired before React drew the box left nothing mounted, so every press failed ("Could not find a ready element to create a payment method from.").
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!form || !mount.current) return;
    const el = form.elements.create("payment", { wallets: { link: "never", applePay: "never", googlePay: "never" } }); // cards only: no Link bank tab, no wallets
    el.on("ready", () => setReady(true));
    el.mount(mount.current);
    return () => {
      setReady(false);
      el.destroy();
    };
  }, [form]);
  const row = (ok: boolean, text: string) => (
    <li className="flex items-center gap-2" data-step-ok={ok ? "yes" : "no"}>
      {ok ? <Check className="h-4 w-4 text-emerald-300" aria-label="done" /> : <X className="h-4 w-4 text-rose-300" aria-label="not yet" />} {text}
    </li>
  );
  async function start() {
    setBusy(true);
    setErr("");
    setCancelled("");
    setErrPress("Verify a card");
    try {
      const r = await api<{ simulated: boolean; verified?: boolean; standIn?: boolean; clientSecret?: string; setupIntentId?: string; publishableKey?: string }>("/api/payments/verify-card", { check: true });
      if (r.simulated && r.standIn) {
        await check("", null, true);
        return;
      }
      if (r.simulated) {
        fin.finish();
        return;
      }
      if (!r.publishableKey || !r.clientSecret) throw new Error("Card verification isn't set up yet. Contact us in Settings.");
      const Stripe = await loadStripe();
      const stripe = Stripe(r.publishableKey);
      // (Batch 17 §11) The card form only makes the card; the server confirms it with return_url, so the bank's check comes back as a page shown inline.
      const elements = stripe.elements({ mode: "setup", currency: "usd", paymentMethodCreation: "manual", paymentMethodTypes: ["card"] });
      setForm({ stripe, elements, setupIntentId: r.setupIntentId ?? "" });
    } catch (e) {
      failed(e);
    }
    setBusy(false);
  }
  async function confirm() {
    if (!form || !ready) return;
    setBusy(true);
    setErr("");
    setCancelled("");
    setErrPress("Verify this card");
    try {
      const sub = await form.elements.submit();
      if (sub.error) throw new Error(sub.error.message ?? CARD_NOT_VERIFIED);
      const pm = await form.stripe.createPaymentMethod({ elements: form.elements });
      if (pm.error || !pm.paymentMethod) throw new Error(pm.error?.message ?? CARD_NOT_VERIFIED);
      const r = await api<{ setupIntentId: string; checkUrl: string | null }>("/api/payments/verify-card", { setupIntent: form.setupIntentId, paymentMethod: pm.paymentMethod.id });
      if (r.checkUrl) {
        // (Batch 19 section 5) A cancelled or failed check frees the press: the next Verify a card starts a new check (a new card form and SetupIntent).
        try { await check(r.setupIntentId, r.checkUrl, false); } catch (e) { setForm(null); throw e; }
      } else {
        await finish(r.setupIntentId)();
        fin.finish("Card verified.");
      }
    } catch (e) {
      failed(e);
    }
    setBusy(false);
  }
  return (
    <div id="chargeback-steps" data-chargeback-steps="" className="space-y-2 rounded-lg border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-100">
      {/* (Batch 26 section 5) The chargeback wording: it's a chargeback hold, not a payment hold. */}
      <p><b>Your bank reversed a payment, so your account is on a chargeback hold.</b> Your tests are paused. To lift it:</p>
      {steps.reviewFirst ? (
        /* (Owner, Nov 3) From the 2nd chargeback: the team reviews the account first; then paying (one payment) lifts the hold. */
        <ul className="space-y-1" data-review-first-steps={steps.count}>
          {row(steps.approved, `The team's review (your account has had ${steps.count} chargebacks)`)}
          {row(steps.cardVerified, "A card verified with 3D Secure")}
          {row(steps.owedPaid, "What you owe paid")}
        </ul>
      ) : (
        <ul className="space-y-1">
          {row(steps.cardVerified, "A card verified with 3D Secure")}
          {/* (Batch 23 section 6) Paying reserves it on the card; the team's approval takes it. */}
          {row(steps.owedPaid, "What you owe reserved on your card")}
          {row(steps.approved, "The team's approval")}
        </ul>
      )}
      {steps.remaining.length > 0 && <p data-steps-line="">{stepsLine(steps.remaining)}{steps.reviewFirst ? "" : " Paying alone doesn't lift it."}</p>}
      {/* (Owner, Nov 5, §272) Verified in another tab or device: the page's next poll redraws it (the payments, test and dashboard versions read the verified
          card), the step shows ticked like the others and neither Verify a card nor an open card form's Verify this card stays (one in flight keeps its refusal). */}
      {!steps.cardVerified && !form && (
        <button className="btn" disabled={busy || bank.open || !!done} onClick={start}>Verify a card</button>
      )}
      {form && (!steps.cardVerified || busy) && (
        <div className="space-y-2">
          <div ref={mount} data-card-form="" className="min-h-[3rem] rounded-lg bg-white p-3" />
          <button className="btn" disabled={busy || !ready || bank.open || !!done} onClick={confirm}>Verify this card</button>
        </div>
      )}
      {bank.view}
      {fin.line && <p className="ok" data-card-verified="">{fin.line}</p>}
      {cancelled && !fin.line && <p className="ok" data-card-check-cancelled="">{cancelled}</p>}
      <Err text={err} press={errPress} />
    </div>
  );
}
