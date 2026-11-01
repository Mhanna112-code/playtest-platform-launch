import { testerPaymentStatus, type TesterPaymentFacts } from "@/lib/testerPaymentStatus";

const TONE = { grey: "", amber: "border-amber-300/40 text-amber-200", green: "border-emerald-400/40 text-emerald-200", rose: "border-rose-300/40 text-rose-200" } as const;

/** (§97) The same small badge style as the other tags on the tester's parts. */
export function TesterPaymentTag(props: TesterPaymentFacts) {
  const state = testerPaymentStatus(props);
  return <span className={`badge ${TONE[state.tone]}`} data-part-status={state.kind}>{state.text}</span>;
}
