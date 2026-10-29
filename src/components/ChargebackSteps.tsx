"use client";
import { useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Err } from "@/components/Err";
import { api, errOf } from "@/lib/client";
import { stepsLine } from "@/lib/pause";
import { useBankCheck } from "@/components/BankCheck";
import { CARD_NOT_VERIFIED } from "@/lib/rules";
import type { Simulate } from "@/lib/bankConfirm";

type Steps = { cardVerified: boolean; owedPaid: boolean; approved: boolean; remaining: string[] };

type Elements = { create: (t: string) => { mount: (el: HTMLElement) => void }; submit: () => Promise<{ error?: { message?: string } }> };
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
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ stripe: StripeJs; elements: Elements; setupIntentId: string } | null>(null);
  const [done, setDone] = useState("");
  // (Batch 17 §11) The bank's check (3D Secure) opens inline, under the button; with the fake Stripe, the clearly-marked stand-in.
  const bank = useBankCheck();
  const finish = (setupIntent: string) => (simulate?: Simulate) => api<{ verified: boolean }>("/api/payments/verify-card", { finish: true, setupIntent, ...(simulate ? { simulate } : {}) });
  const check = async (setupIntent: string, checkUrl: string | null, simulated: boolean) => {
    await bank.check({ requiresAction: true, paymentId: "", clientSecret: "", publishableKey: "", simulated, checkUrl }, finish(setupIntent));
    setDone("Card verified.");
    setTimeout(() => window.location.reload(), 1200);
  };
  const mount = useRef<HTMLDivElement>(null);
  const row = (ok: boolean, text: string) => (
    <li className="flex items-center gap-2" data-step-ok={ok ? "yes" : "no"}>
      {ok ? <Check className="h-4 w-4 text-emerald-300" aria-label="done" /> : <X className="h-4 w-4 text-rose-300" aria-label="not yet" />} {text}
    </li>
  );
  async function start() {
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ simulated: boolean; verified?: boolean; standIn?: boolean; clientSecret?: string; setupIntentId?: string; publishableKey?: string }>("/api/payments/verify-card", { check: true });
      if (r.simulated && r.standIn) {
        await check("", null, true);
        return;
      }
      if (r.simulated) {
        window.location.reload();
        return;
      }
      if (!r.publishableKey || !r.clientSecret) throw new Error("Card verification isn't set up yet. Contact us in Settings.");
      const Stripe = await loadStripe();
      const stripe = Stripe(r.publishableKey);
      // (Batch 17 §11) The card form only makes the card; the server confirms it with return_url, so the bank's check comes back as a page shown inline.
      const elements = stripe.elements({ mode: "setup", currency: "usd", paymentMethodCreation: "manual", paymentMethodTypes: ["card"] });
      setForm({ stripe, elements, setupIntentId: r.setupIntentId ?? "" });
      setTimeout(() => mount.current && elements.create("payment").mount(mount.current), 0);
    } catch (e) {
      setErr(errOf(e));
    }
    setBusy(false);
  }
  async function confirm() {
    if (!form) return;
    setBusy(true);
    setErr("");
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
        setDone("Card verified.");
        setTimeout(() => window.location.reload(), 1200);
      }
    } catch (e) {
      setErr(errOf(e));
    }
    setBusy(false);
  }
  return (
    <div id="chargeback-steps" data-chargeback-steps="" className="space-y-2 rounded-lg border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-100">
      <p><b>Your bank reversed a payment, so your account is on a payment hold.</b> Your tests are paused. To lift it:</p>
      <ul className="space-y-1">
        {row(steps.cardVerified, "A card verified with 3D Secure")}
        {/* (Batch 23 section 6) Paying reserves it on the card; the team's approval takes it. */}
        {row(steps.owedPaid, "What you owe reserved on your card")}
        {row(steps.approved, "The team's approval")}
      </ul>
      {steps.remaining.length > 0 && <p data-steps-line="">{stepsLine(steps.remaining)} Paying alone doesn&apos;t lift it.</p>}
      {!steps.cardVerified && !form && (
        <button className="btn" disabled={busy || bank.open || !!done} onClick={start}>Verify a card</button>
      )}
      {form && (
        <div className="space-y-2">
          <div ref={mount} />
          <button className="btn" disabled={busy || bank.open || !!done} onClick={confirm}>Verify this card</button>
        </div>
      )}
      {bank.view}
      {done && <p className="ok" data-card-verified="">{done}</p>}
      <Err text={err} />
    </div>
  );
}
