// (Owner, Oct 28, batch 8) The developer subscription: $7/month. Pure rules shared by the server and the pages. Testers never pay and never see any of this.

import { money } from "./format";

export const SUBSCRIPTION_CENTS = 700;
export const SUBSCRIPTION_PRICE = `${money(SUBSCRIPTION_CENTS).replace(/\.00$/, "")}/month`; // "$7/month"
/** Stripe retries a declined renewal for about a week; the perks continue meanwhile, then it lapses. */
export const RETRY_DAYS = 7;
/** The admin's free-during-launch date must be at least this far away; developers are told 30 and 7 days before. */
export const FREE_NOTICE_DAYS = [30, 7] as const;
const DAY = 86_400_000;

/** (Section 8 item 7) The perks, as the refusals name them. */
export const PERKS = {
  several: "Running several open tests",
  approved: "Approved-only testers",
  nextRound: "Next round",
  invite: "Inviting testers",
} as const;
export type Perk = keyof typeof PERKS;
/** What the Payments page lists. */
export const PERK_LIST = ["Several open tests at once (free: one at a time)", "Approved-only testers (you accept or decline each application)", "Next round", "Invite testers"] as const;

/** "Next round needs a subscription ($7/month)." / "Approved-only testers need a subscription ($7/month)." */
export const perkLine = (perk: Perk) => `${PERKS[perk]} ${perk === "approved" ? "need" : "needs"} a subscription (${SUBSCRIPTION_PRICE}).`;
/** (Section 2) Posting a second open test on the free plan. */
export const SECOND_TEST_LINE = `You already have an open test. Subscribe (${SUBSCRIPTION_PRICE}) to run several at once.`;
export const SUBSCRIPTION_ENDED = "Your subscription ended.";
export const SUBSCRIBE_WAITS = "You can subscribe once your account is active again.";
export const DELETE_ENDS_SUBSCRIPTION = "Your subscription ends now, with no refund for the rest of the month.";

/** The end of the monthly period that contains `now`, counted from `anchor` (the 31st renews on the last day of shorter months). */
export function periodEnd(anchor: Date, now = new Date()) {
  for (let months = 1; months < 1200; months++) {
    const end = new Date(anchor);
    end.setUTCMonth(anchor.getUTCMonth() + months);
    if (end.getUTCDate() !== anchor.getUTCDate()) end.setUTCDate(0);
    if (end > now) return end;
  }
  return new Date(now.getTime() + 30 * DAY);
}

export type SubUser = {
  subscriptionStatus: string; subscriptionRenewsAt: Date | null; subscriptionCanceling: boolean; subscriptionPausedAt?: Date | null;
  subscriptionEndedAt?: Date | null; subscriptionEndReason?: string; subscribedAt?: Date | null; subscriptionPastDueAt?: Date | null;
};

/** Has the paid subscription now (a declined renewal keeps it until the last retry; a cancelled one until the end of the paid month; paused billing keeps it). */
export function subscribed(u: SubUser, now = new Date()) {
  if (u.subscriptionStatus === "past_due") return true;
  if (u.subscriptionStatus !== "active") return false;
  if (u.subscriptionPausedAt) return true;
  return !u.subscriptionCanceling || !u.subscriptionRenewsAt || u.subscriptionRenewsAt > now;
}

/** The free-during-launch state: no date set (or cleared) = free with no end; a date ahead = free until then; a date passed = over. */
export type Launch = { free: boolean; until: Date | null };
export function launchFrom(value: string | null | undefined, now = new Date()): Launch {
  if (!value) return { free: true, until: null };
  const d = new Date(value);
  if (isNaN(d.getTime())) return { free: true, until: null };
  return { free: d > now, until: d };
}

/** For Payments and the admin rows. */
export type SubState = "free" | "active" | "cancelled" | "past_due" | "lapsed" | "ended" | "paused";
export function subState(u: SubUser, now = new Date()): SubState {
  if (u.subscriptionStatus === "none") return "free";
  if (u.subscriptionPausedAt && (u.subscriptionStatus === "active" || u.subscriptionStatus === "past_due")) return "paused";
  if (u.subscriptionStatus === "past_due") return "past_due";
  if (u.subscriptionStatus === "ended") return u.subscriptionEndReason === "lapsed" ? "lapsed" : "ended";
  if (!subscribed(u, now)) return "ended";
  return u.subscriptionCanceling ? "cancelled" : "active";
}

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
/** The admin user row's subscription line. */
export function adminSubLine(u: SubUser, now = new Date()) {
  const s = subState(u, now);
  if (s === "free") return "free plan";
  if (s === "active") return `subscribed${u.subscriptionRenewsAt ? `, renews ${day(u.subscriptionRenewsAt)}` : ""}`;
  if (s === "cancelled") return `cancelled until ${u.subscriptionRenewsAt ? day(u.subscriptionRenewsAt) : "the end of the month"}`;
  if (s === "past_due") return "renewal declined (retrying)";
  if (s === "lapsed") return "lapsed";
  if (s === "paused") return "paused (hold or suspension)";
  return u.subscriptionEndReason === "deleted" ? "ended (account deleted)" : "ended";
}
export const fmtSubDay = day;

/** Is this refusal one of the subscription notices (it gets a Payments link that opens in a new tab)? */
export const isPerkRefusal = (text: string) => text.includes(`subscription (${SUBSCRIPTION_PRICE})`) || text.includes(`Subscribe (${SUBSCRIPTION_PRICE})`);
