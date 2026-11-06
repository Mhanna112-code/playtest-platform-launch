import { money } from "@/lib/format";
import { OWED_BANK_WAITING } from "@/lib/rules";
import { paidRows, plainLabel, type PaidRow } from "./paymentRows";
import { OWED_BANK_WAIT_TAIL, bankCheckOpen } from "./holds";

/**
 * (Owner, Nov 3, batch 35 §152) Each part's payments on the developer's test page (written answers, recording, each call): every Pay, Pay more, team decision and
 * automatic call charge on it, oldest first, each in the same line as Payments' "What you've paid" (`paidRows`, developer side: what it was for and how it was
 * paid), then its date, amount and status in the words the developer already sees elsewhere. Testers never see these lines (they have their own, without holds).
 */

/** The payments a part's list shows: the piece's own payment, a Pay more, a team decision (a repaid chargeback is the original line's "your bank reversed this"). */
export const PART_PAY_KINDS = ["review", "call", "extra", "dispute"] as const;
/** Shown: everything that was charged or is still owed or waiting; never one still being sent (it shows once the bank answers) or cancelled (nothing was charged). */
export const PART_PAY_STATUSES = ["charged", "not_set_up", "refunded", "needs_confirmation", "needs_action", "failed", "owed", "deferred"] as const;

/**
 * A payment's status words: Payments' "What you've paid" words for a paid one ("recorded (payments not set up)", "refunded (your bank's chargeback was reversed)",
 * "your bank reversed this (chargeback)"), and the words of Pay what you owe and "Confirm with your bank" for one not paid yet ("waiting for your bank", "card declined",
 * "waiting until your tests resume"). A plain paid one has none.
 */
export function partPayStatus(p: { status: string }, row?: Pick<PaidRow, "reversed" | "reversedCents"> | null, /** (§240) a waiting charge whose bank check is open */ bankWait = false): string {
  if (p.status === "not_set_up") return "recorded (payments not set up)";
  if (p.status === "refunded") return "refunded (your bank's chargeback was reversed)";
  if (p.status === "needs_confirmation" || p.status === "needs_action") return OWED_BANK_WAITING.toLowerCase();
  if (p.status === "failed") return "card declined";
  if (p.status === "owed") return "charged when you press Pay what you owe";
  // (Owner, Nov 5, §240) A waiting charge whose bank check is really open (bankCheckOpen) waits for the bank, not the lift.
  if (p.status === "deferred") return bankWait ? OWED_BANK_WAIT_TAIL : "waiting until your tests resume";
  if (row?.reversed) return row.reversedCents ? `your bank reversed ${money(row.reversedCents)} of this (chargeback)` : "your bank reversed this (chargeback)";
  return "";
}

/** One line of a part's payments: Payments' line (`what`, `full` its hover, `how`), then `when`, `amount` and `status`. */
export type PartPayLine = { id: string; what: string; full: string; how: string; when: string; amount: string; status: string; /** (Owner, Nov 5, §270) the people and tests it names, green links */ links?: import("@/lib/lineLinks").LineLink[] };

type Pay = Parameters<typeof paidRows>[0][number] & { status: string; createdAt: Date; actionPi?: string | null; coveredById?: string | null };

/** Every part's payment lines, by the part's id (the sent work's or the call's), oldest first. `when`: the date in the developer's own time zone. */
export async function partPaymentLines(ps: Pay[], when: (d: Date) => string): Promise<Map<string, PartPayLine[]>> {
  const shown = ps
    .filter((p) => (p.submissionId || p.callId) && (PART_PAY_KINDS as readonly string[]).includes(p.kind) && (PART_PAY_STATUSES as readonly string[]).includes(p.status))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const rows = shown.length ? await paidRows(shown, "developer") : new Map<string, PaidRow>();
  const out = new Map<string, PartPayLine[]>();
  for (const p of shown) {
    const r = rows.get(p.id);
    const key = (p.submissionId ?? p.callId)!;
    out.set(key, [...(out.get(key) ?? []), { id: p.id, what: r?.what ?? plainLabel(p.kind), full: r?.full ?? plainLabel(p.kind), how: r?.how ?? "", when: when(p.createdAt), amount: money(p.amountCents), links: r?.links ?? [], status: partPayStatus(p, r, p.status === "deferred" && (await bankCheckOpen(p))) }]);
  }
  return out;
}
