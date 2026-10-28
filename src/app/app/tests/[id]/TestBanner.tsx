import { ReasonQuote } from "@/components/ScrollText";

export type BannerCause = "team-paused" | "team-stopped" | "hold" | "chargeback" | "suspended" | "stopped";

/** (Owner, Oct 30, batch 15 section 37) The banner's title, by cause. */
export const BANNER_TITLES: Record<BannerCause, string> = {
  "team-paused": "The team paused this test.",
  "team-stopped": "The team stopped this test.",
  hold: "Your tests are paused until you pay what you owe.",
  chargeback: "Your tests are paused until you pay what you owe.",
  suspended: "Your account is suspended: your tests are paused.",
  stopped: "This test is stopped.",
};

/** The bottom line, built from the buttons actually shown, so it never lists something hidden. */
export function allowedLine(paused: boolean, can: { stop?: boolean; endEarly?: boolean; cancelCalls?: boolean; nextRound?: boolean }) {
  if (paused) {
    const parts = [can.stop ? "stop this test" : "", can.endEarly ? "end testers' work early" : "", can.cancelCalls ? "cancel calls" : ""].filter(Boolean);
    if (!parts.length) return "";
    return `For now you can ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")}, or ${parts[parts.length - 1]}`}.`;
  }
  return `You can still pay for work testers already sent, chat with them, rate testers, and read their answers${can.nextRound ? ", and start a Next round" : ""}.`;
}

/**
 * (Owner, Oct 30, batch 15 sections 20, 23 and 37) ONE red banner for paused and stopped tests, top to bottom: the title by cause; the reason in italics in a scroll box;
 * the failed-press lines ("Your Save on <test> didn't go through: the team paused this test."); and, at the bottom, what's still allowed.
 */
export function TestBanner({ cause, reason, failed, allowed }: { cause: BannerCause; reason?: string | null; failed?: string; allowed: string }) {
  const why = cause === "team-paused" ? "the team paused this test" : cause === "team-stopped" ? "the team stopped this test" : "";
  return (
    <section role="alert" data-test-banner={cause} className="space-y-2 rounded-2xl border border-rose-400/50 bg-rose-500/10 p-4 text-sm text-rose-100">
      <p className="font-semibold">{BANNER_TITLES[cause]}</p>
      {reason && <ReasonQuote text={reason} className="text-rose-50" />}
      {failed && <p data-failed-line="">{why && !failed.includes(":") ? `${failed.replace(/\.$/, "")}: ${why}.` : /[.!]$/.test(failed) ? failed : `${failed}.`}</p>}
      {allowed && <p className="text-rose-100/80" data-allowed-line="">{allowed}</p>}
    </section>
  );
}
