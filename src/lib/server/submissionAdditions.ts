import { chargeIsOpen, isLate, payByFrom } from "@/lib/rules";

/** Additions never erase an existing piece's on-time status or reopen a settled Charge. */
export function additionTerms(existing: { late: boolean; review: unknown; payBy: Date | null; stintDueAt?: Date | null; choiceOfferedAt?: Date | null } | null, contract: { dueAt: Date }, price: number | null, now: Date) {
  if (existing?.review) return { late: existing.late, paidUpdateAt: now };
  const late = existing ? existing.late : isLate(contract.dueAt, now);
  // Freeze after the deadline or after Charge has opened, including a deadline subsequently extended.
  if (existing && (isLate(contract.dueAt, now) || existing.choiceOfferedAt || chargeIsOpen(existing, { openUntil: null, status: "open" }, { ...contract, status: "working" }, now))) return { late };
  return { late, agreedCents: price, payBy: payByFrom(now), stintDueAt: null, choiceOfferedAt: null, choiceBy: null };
}
