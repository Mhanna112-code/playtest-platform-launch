import { testerPaymentStatus, type TesterPaymentFacts } from "@/lib/testerPaymentStatus";

const TONE = { grey: "", amber: "border-amber-300/40 text-amber-200", green: "border-emerald-400/40 text-emerald-200", rose: "border-rose-300/40 text-rose-200" } as const;

/**
 * (§97) The same small badge style as the other tags on the tester's parts. (Owner, Nov 9, §334) `choiceOpen`: the tester's Charge / Let it go is open on this
 * piece, so "Waiting for review" isn't shown above its buttons (only the anchor stays, for links to it); every other state still shows.
 */
export function TesterPaymentTag({ anchor, choiceOpen, ...props }: TesterPaymentFacts & { anchor?: string; choiceOpen?: boolean }) {
  const state = testerPaymentStatus(props);
  if (choiceOpen && state.kind === "review") return anchor ? <span id={anchor} data-part-status="choice" /> : null;
  return <span id={anchor} className={`badge ${TONE[state.tone]}`} data-part-status={state.kind}>{state.text}</span>;
}
