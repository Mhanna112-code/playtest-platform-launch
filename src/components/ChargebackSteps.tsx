"use client";
import { useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Err } from "@/components/Err";
import { api, errOf } from "@/lib/client";
import { stepsLine } from "@/lib/pause";

type Steps = { cardVerified: boolean; owedPaid: boolean; approved: boolean; remaining: string[] };

type StripeJs = {
  elements: (o: { clientSecret: string }) => { create: (t: string) => { mount: (el: HTMLElement) => void }; submit?: () => Promise<unknown> };
  confirmSetup: (o: { elements: unknown; confirmParams: { return_url: string }; redirect: "if_required" }) => Promise<{ error?: { message?: string }; setupIntent?: { id: string } }>;
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
  const [form, setForm] = useState<{ stripe: StripeJs; elements: unknown } | null>(null);
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
      const r = await api<{ simulated: boolean; clientSecret?: string; publishableKey?: string }>("/api/payments/verify-card", {});
      if (r.simulated) {
        window.location.reload();
        return;
      }
      if (!r.publishableKey || !r.clientSecret) throw new Error("Card verification isn't set up yet. Contact us in Settings.");
      const Stripe = await loadStripe();
      const stripe = Stripe(r.publishableKey);
      const elements = stripe.elements({ clientSecret: r.clientSecret });
      setForm({ stripe, elements });
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
    const r = await form.stripe.confirmSetup({ elements: form.elements, confirmParams: { return_url: `${window.location.origin}/api/payments/verify-card/done` }, redirect: "if_required" });
    if (r.error) {
      setErr(r.error.message ?? "The card wasn't verified. Try again.");
      setBusy(false);
    } else window.location.href = `/api/payments/verify-card/done?setup_intent=${encodeURIComponent(r.setupIntent?.id ?? "")}`;
  }
  return (
    <div id="chargeback-steps" data-chargeback-steps="" className="space-y-2 rounded-lg border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-100">
      <p><b>Your bank reversed a payment, so your account is on a payment hold.</b> Your tests are paused. To lift it:</p>
      <ul className="space-y-1">
        {row(steps.cardVerified, "A card verified with 3D Secure")}
        {row(steps.owedPaid, "What you owe paid")}
        {row(steps.approved, "The team's approval")}
      </ul>
      {steps.remaining.length > 0 && <p data-steps-line="">{stepsLine(steps.remaining)} Paying alone doesn&apos;t lift it.</p>}
      {!steps.cardVerified && !form && (
        <button className="btn" disabled={busy} onClick={start}>Verify a card</button>
      )}
      {form && (
        <div className="space-y-2">
          <div ref={mount} />
          <button className="btn" disabled={busy} onClick={confirm}>Verify this card</button>
        </div>
      )}
      <Err text={err} />
    </div>
  );
}
