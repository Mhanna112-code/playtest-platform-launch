import { LET_GO_BY_TESTER, notPaidClosedLine } from "./rules";

/** (§97) A tester's payment state, using the page's existing review, outstanding-payment and close-out facts. */
export type TesterPaymentFacts = {
  review?: { rejected: boolean; reason: string; teamClosedById?: string | null } | null;
  delayed?: boolean;
  closedOn?: string | null;
  developerDeleted?: string | null;
  paidCents?: number;
};
export function testerPaymentStatus(p: TesterPaymentFacts) {
  // A paid base plus a raise still waiting is delayed too (§82 / §88).
  if (p.delayed) return { kind: "delayed", text: "Payment delayed", tone: "amber" } as const;
  if (p.review?.rejected && !(p.paidCents && p.paidCents > 0)) return { kind: "rejected", text: "Rejected", tone: "rose" } as const;
  if (p.review?.teamClosedById) return { kind: "closed", text: "Closed by the team", tone: "grey" } as const;
  if (p.review?.reason === LET_GO_BY_TESTER) return { kind: "letgo", text: "Let go", tone: "grey" } as const;
  if (p.review) return { kind: "paid", text: "Paid", tone: "green" } as const;
  if (p.developerDeleted) return { kind: "gone", text: `Can't be paid: ${p.developerDeleted} deleted their account`, tone: "rose" } as const;
  if (p.closedOn) return { kind: "closed", text: notPaidClosedLine(p.closedOn), tone: "grey" } as const;
  return { kind: "review", text: "Waiting for review", tone: "amber" } as const;
}
