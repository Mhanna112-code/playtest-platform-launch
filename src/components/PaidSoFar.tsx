import { money } from "@/lib/format";

/**
 * (Owner, Nov 4, §195) What the developer has paid for this tester's work on this test so far (paymentRows.paidForWork), shown ONCE on the right of the row that
 * heads the tester's group (Needs you's person, the Testers row, the Call requests box's person): "paid $15.00 so far". Never cut, never wraps inside itself. On a
 * phone (below `sm`) it reads "paid $15.00", so the name keeps room before it is cut with "…".
 */
export function PaidSoFar({ cents, className = "" }: { cents: number; className?: string }) {
  return <span className={["ml-auto shrink-0 whitespace-nowrap pl-2 text-sm font-normal text-slate-300", className].filter(Boolean).join(" ")} data-paid-so-far={cents}>paid {money(cents)}<span className="hidden sm:inline"> so far</span></span>;
}
