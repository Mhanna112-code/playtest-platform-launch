"use client";
import { Sparkles } from "lucide-react";
import { PressButton } from "@/components/PressButton";
import { PERK_LIST, SUBSCRIPTION_PRICE, type SubState } from "@/lib/subscription";

/**
 * (Owner, Oct 28, batch 8) Payments: "Subscription · $7/month" (the full app's billing card, lean's rules). Not subscribed: the perks and Subscribe (needs a saved card);
 * subscribed: since, renews on, Cancel; cancelled: until when, Keep my subscription. Free during launch says so first.
 */
export function SubscriptionBox(p: {
  state: SubState; since: string | null; renews: string | null; endedReason: string; seenAt: string; hasCard: boolean; needsCard: boolean;
  launch: { free: boolean; until: string | null }; pastDueBy: string | null; restricted: boolean;
}) {
  const perks = (
    <ul className="space-y-1 text-sm text-slate-300">
      {PERK_LIST.map((x) => <li key={x} className="flex gap-2"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-volt-300" /> {x}</li>)}
    </ul>
  );
  const btn = (action: string, label: string, cls = "btn-secondary px-3 py-1.5 text-sm") => (
    <PressButton seenAt={p.seenAt} path="/api/payments/subscription" body={{ action }} className={cls}>{label}</PressButton>
  );
  const subscribed = p.state === "active" || p.state === "cancelled" || p.state === "past_due" || p.state === "paused";
  return (
    <section id="subscription" className="card scroll-mt-24 space-y-3 border-volt-300/30" data-subscription={p.state}>
      <h2 className="flex items-center gap-2 font-semibold text-white"><Sparkles className="h-5 w-5 text-volt-300" /> Subscription · {SUBSCRIPTION_PRICE}</h2>
      {p.launch.free && (
        <p className="rounded-xl border border-volt-300/30 bg-volt-300/10 p-3 text-sm text-volt-100" data-free-launch="">
          {p.launch.until ? <>Free during launch until <strong className="text-white">{p.launch.until}</strong>: everything is included. Subscribe to keep the extras after that.</> : "Free during launch: everything is included."}
        </p>
      )}
      {p.state === "active" && (
        <>
          {perks}
          <p className="text-sm text-slate-300">Active since {p.since}. Renews on <strong className="text-white">{p.renews}</strong>.</p>
          {btn("cancel", "Cancel subscription")}
          <p className="text-xs text-slate-500">Cancel any time: it lasts until the end of the month you&apos;ve paid for. No refunds.</p>
        </>
      )}
      {p.state === "paused" && (
        <>
          <p className="text-sm text-slate-300">Billing is paused while your account is paused: no renewal is charged. When it&apos;s active again, the days you had left resume.</p>
          {btn("cancel", "Cancel subscription")}
        </>
      )}
      {p.state === "past_due" && (
        <>
          <p className="text-sm text-amber-200">Your {SUBSCRIPTION_PRICE.replace("/month", "")} subscription payment didn&apos;t go through. Update your card{p.pastDueBy ? ` by ${p.pastDueBy}` : ""} to keep it.</p>
          {btn("cancel", "Cancel subscription")}
        </>
      )}
      {p.state === "cancelled" && (
        <>
          <p className="text-sm text-amber-200">You can use the perks until {p.renews}; you won&apos;t be charged again.</p>
          {btn("keep", "Keep my subscription")}
        </>
      )}
      {!subscribed && !(p.launch.free && !p.launch.until) && (
        <>
          {p.state === "lapsed" && <p className="text-sm text-slate-300">Your subscription ended because the payment didn&apos;t go through.</p>}
          {p.state === "ended" && <p className="text-sm text-slate-300">Your subscription ended{p.endedReason === "cancelled" ? " (cancelled)" : ""}.</p>}
          <p className="text-sm text-slate-300">The free plan runs one open test at a time. The subscription adds:</p>
          {perks}
          {p.restricted ? <p className="note">You can subscribe once your account is active again.</p> : btn("subscribe", `Subscribe for ${SUBSCRIPTION_PRICE}`, "btn")}
          {p.needsCard && !p.hasCard && <p className="text-xs text-slate-500">Add a card below first.</p>}
          <p className="text-xs text-slate-500">Monthly from the day you subscribe{p.launch.until ? " (during the free launch: from the day it ends)" : ""}. Cancel any time; it lasts until the end of the paid month.</p>
        </>
      )}
    </section>
  );
}
