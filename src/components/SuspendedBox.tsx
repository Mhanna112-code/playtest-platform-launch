import Link from "next/link";
import { ShieldAlert } from "lucide-react";

/**
 * (Design doc 2, owner) The red box at the top of the dashboard (and the profile, when that is where they land) for a suspended
 * account: names the press that didn't go through, says the account is suspended, what that means, and how to appeal.
 */
export function SuspendedBox({ failed, developer, tester }: { failed?: string; developer: boolean; tester: boolean }) {
  return (
    <section role="alert" data-suspended-box="" className="rounded-2xl border border-rose-400/50 bg-rose-500/10 p-4 text-sm text-rose-100">
      <h2 className="flex items-center gap-2 text-base font-semibold text-rose-100"><ShieldAlert className="h-5 w-5" /> Your account has been suspended</h2>
      {failed && <p className="mt-1 font-medium">{failed}: your account is suspended.</p>}
      <ul className="mt-2 list-disc space-y-1 pl-5 text-rose-100/90">
        {developer && (
          <>
            <li data-suspended-dev="">Your account is suspended: your tests are paused. You can still cancel calls, end a tester&apos;s work early or stop a test. Paying and reviewing work wait until the suspension is lifted.</li>
            <li>Your testers are still in your tests, but nothing can happen on them. You can&apos;t post a test, read messages or use the other buttons on your test pages.</li>
            <li data-suspended-closing="">A paused test closes after 7 days; its date is on its card below. When the suspension is lifted before then, your tests unpause and carry on as normal.</li>
          </>
        )}
        {tester && (
          <>
            <li>You were removed from all the tests you were in. What you sent is still reviewed; payment for it waits until the suspension is lifted.</li>
            <li>You can&apos;t open Find tests, edit your profile or read messages.</li>
            <li>When the suspension is lifted you&apos;re invited back to the tests you were removed from that are open with spots; the others are listed on your dashboard with a Suspended label and Ask to rejoin.</li>
          </>
        )}
        <li>To appeal, contact the team: <Link href="/app/help" className="text-rose-50 underline">Contact us</Link> in Settings.</li>
      </ul>
    </section>
  );
}
