import Link from "next/link";
import { LongList } from "@/components/LongList";
import { stepsLine } from "@/lib/pause";
import type { DevRestriction } from "@/lib/restricted";

/**
 * (Design doc 2; owner, Oct 27) The BLUE box at the very top of the dashboard for a restricted account. For a developer an admin suspension, a payment hold and a chargeback
 * hold are one state: it says whether a press they just made didn't go through, why the account is restricted, that all their tests are paused (testers stay in them), how to
 * resume, and that the tests resume as normal when it lifts. For a suspended tester it says they were removed from their tests and how to appeal.
 * Long boxes show 3 lines then "Show N more" (the long-list rule).
 */
export function RestrictedBox({ failed, developer, tester, kinds, steps, review }: { failed?: string; developer: boolean; tester: boolean; kinds: DevRestriction[]; steps?: string[]; review?: boolean }) {
  const suspended = kinds.includes("suspended");
  const hold = kinds.includes("hold"), chargeback = kinds.includes("chargeback");
  const lines: React.ReactNode[] = [];
  if (failed) lines.push(<li key="failed" data-restricted-failed=""><b>{failed}.</b></li>);
  if (developer) {
    if (suspended) lines.push(<li key="s" data-restricted-why="suspended">Your account is suspended.</li>);
    if (hold) lines.push(<li key="h" data-restricted-why="hold">Your account is on hold because a payment was declined.</li>);
    if (chargeback) lines.push(<li key="c" data-restricted-why="chargeback">Your account is on hold after a chargeback.</li>);
    lines.push(<li key="p" data-restricted-paused="">All your tests are paused. Testers stay in them. You can&apos;t open your test pages, Edit, Post a test or Messages, and Pay and Reject wait; you can still cancel booked calls below.</li>);
    if (hold) lines.push(<li key="rh" data-restricted-resume="hold">To resume: <Link href="/app/payments#owed" target="_blank" rel="noreferrer" className="underline">Pay what you owe</Link> in Payments (it opens in a new tab).{review && <span data-hold-review=""> After you pay, the team will review your account before your tests resume.</span>}</li>);
    if (chargeback) lines.push(<li key="rc" data-restricted-resume="chargeback">To resume: follow the chargeback steps in <Link href="/app/payments#chargeback-steps" target="_blank" rel="noreferrer" className="underline">Payments</Link> (it opens in a new tab).{steps && steps.length > 0 && <> {stepsLine(steps)}</>}</li>);
    if (suspended) lines.push(<li key="rs" data-restricted-resume="suspended">To appeal, contact the team: <Link href="/app/help" className="underline">Contact us</Link> in Settings.</li>);
    lines.push(<li key="l">When it lifts, your tests resume as normal.</li>);
  }
  if (tester && suspended) {
    lines.push(<li key="t1" data-restricted-tester="">Your account is suspended. You were removed from all the tests you were in. What you sent is still reviewed; payment for it waits until the suspension is lifted.</li>);
    lines.push(<li key="t2">You can&apos;t open Find tests, edit your profile or read messages.</li>);
    lines.push(<li key="t3">To appeal, contact the team: <Link href="/app/help" className="underline">Contact us</Link> in Settings.</li>);
    lines.push(<li key="t4">When the suspension is lifted you&apos;re invited back to the tests you were removed from that are still open with free spots; the others are listed on your dashboard with a Suspended label and Ask to rejoin.</li>);
  }
  return (
    <section role="status" data-restricted-box="" data-suspended-box={suspended ? "" : undefined} id="restricted" className="info space-y-2">
      <h2 className="text-base font-semibold">{suspended ? "Your account is suspended" : "Your account is on hold"}</h2>
      <LongList className="list-disc space-y-1 pl-5" tall="max-h-52">{lines}</LongList>
    </section>
  );
}
