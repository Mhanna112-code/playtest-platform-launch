import Link from "next/link";
import { PAY_OWED_HREF, PAY_OWED_LINK } from "@/lib/rules";

/**
 * (Owner, Nov 5, batch 35 §227) Pay what you owe is never on the developer's test page: wherever that page says something is owed (the paused banner, the Pay
 * boxes' "Pay what you owe first.", a refusal naming what's owed) it links here: "Pay what you owe on Payments" → /app/payments#owed (OwedBox's anchor there).
 */
export function PayOwedLink({ className = "underline" }: { className?: string }) {
  return <Link href={PAY_OWED_HREF} className={className} data-pay-owed-link="">{PAY_OWED_LINK}</Link>;
}
