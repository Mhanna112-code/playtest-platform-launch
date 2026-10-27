/** (Owner, Oct 28, batch 8) The Payments link after a subscription notice: opens in a new tab so the form keeps what was typed. */
export function SubscribeLink() {
  return (
    <a href="/app/payments#subscription" target="_blank" rel="noreferrer" data-subscribe-link="">Open Payments</a>
  );
}

/** The small "Subscribers" tag next to a perk's button on the free plan. */
export function SubscribersTag() {
  return <span className="badge border-volt-300/40 text-volt-200" data-subscribers-tag="">Subscribers</span>;
}
