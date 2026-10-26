// (Owner, Oct 26) A paused test closes after 7 days, whatever the cause (a payment hold, a chargeback hold, the developer's suspension or the
// team's pause). The admin can move the date later or close the test sooner. Pure helpers: the dashboard, the test page and the admin page
// all read the same date.

export const PAUSE_CLOSE_DAYS = 7;
const DAY = 86_400_000;

export type PauseCause = "hold" | "chargeback" | "suspension" | "team";

type Dev = { holdStartedAt?: Date | null; holdReason?: string | null; suspendedAt?: Date | null };
type Tst = { status: string; adminPausedAt?: Date | null; pauseCloseAt?: Date | null; pauseCloseSetAt?: Date | null };

/** Why a test is paused right now (empty when it isn't). Only tests that are live (open or full) count. */
export function pauseCauses(dev: Dev, test: Tst): PauseCause[] {
  if (test.status !== "open" && test.status !== "closed") return [];
  const out: PauseCause[] = [];
  if (dev.holdStartedAt) out.push(dev.holdReason === "chargeback" ? "chargeback" : "hold");
  if (dev.suspendedAt) out.push("suspension");
  if (test.adminPausedAt) out.push("team");
  return out;
}

/** When the current continuous pause began: the earliest of its causes. */
export function pauseSince(dev: Dev, test: Tst): Date | null {
  if (!pauseCauses(dev, test).length) return null;
  const times = [dev.holdStartedAt, dev.suspendedAt, test.adminPausedAt].filter((d): d is Date => !!d).map((d) => d.getTime());
  return new Date(Math.min(...times));
}

/** The date a paused test closes: 7 days after the pause began, or the date the admin set during this pause (never earlier than 7 days). */
export function pauseClosesAt(dev: Dev, test: Tst): { at: Date; since: Date; extended: boolean; causes: PauseCause[] } | null {
  const since = pauseSince(dev, test);
  if (!since) return null;
  const base = new Date(since.getTime() + PAUSE_CLOSE_DAYS * DAY);
  const set = test.pauseCloseAt && test.pauseCloseSetAt && test.pauseCloseSetAt.getTime() >= since.getTime() ? test.pauseCloseAt : null;
  const at = set && set.getTime() > base.getTime() ? set : base;
  return { at, since, extended: at !== base, causes: pauseCauses(dev, test) };
}

const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** The developer's countdown: "Closes on Nov 2 unless your account is cleared". */
export function pauseCountdownLine(at: Date, causes: PauseCause[]) {
  const accountCaused = causes.some((c) => c !== "team");
  return `Closes on ${fmt(at)} unless ${accountCaused ? "your account is cleared" : "the team lifts the pause"}`;
}

/** The sentence the developer is told when a paused test is closed (testers only read that the test ended). */
export function pauseClosedReason(causes: PauseCause[], by: "daily" | "admin") {
  const why = causes.map((c) => (c === "hold" ? "your payments were on hold" : c === "chargeback" ? "your account was on a chargeback hold" : c === "suspension" ? "your account was suspended" : "the team had paused it"));
  const list = why.length < 2 ? why.join("") : `${why.slice(0, -1).join(", ")} and ${why[why.length - 1]}`;
  return by === "admin" ? `The team closed this test while it was paused because ${list || "it was paused"}.` : `This test was closed because it stayed paused for ${PAUSE_CLOSE_DAYS} days: ${list}.`;
}

/** The chargeback banner's line: "Still to do: verify a card with 3D Secure, then pay what you owe ($8.00), then wait for the team's approval." */
export const stepsLine = (remaining: string[]) => `Still to do: ${remaining.map((x) => x.charAt(0).toLowerCase() + x.slice(1)).join(", then ")}.`;
