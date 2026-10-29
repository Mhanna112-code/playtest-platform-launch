// (Owner, Oct 28 evening, batch 18 section 1) The Terms of Use version each account accepted is stored (User.termsVersion; at sign-up, and when they agree again).
// TERMS_VERSION is bumped whenever the Terms change. An account on an older version is asked once, at its next Post a test / post a draft (developer) or Join,
// Apply, Accept an invite, Ask to rejoin (tester): a box under the button with a link to what changed and a tick. Nothing else is blocked.
import { CLOSE_OUT_DAYS, REVIEW_DAYS } from "./rules";

/** The current Terms of Use version. Bump it (and add a WHAT_CHANGED entry) whenever the Terms change. */
export const TERMS_VERSION = 2;
/** The anchor of the "What changed" note at the top of the Terms page. */
export const WHAT_CHANGED_ID = "what-changed";
export const TERMS_CHANGED_HREF = `/terms#${WHAT_CHANGED_ID}`;
/** The box's line (and the server's refusal of an unticked press). "Read what changed" links to the note. */
export const TERMS_UPDATED_LINE = "We updated our Terms of Use. Read what changed.";
export const TERMS_AGREE_LABEL = "I agree to the updated Terms";
/** (Owner, Oct 28, batch 20 section 5) The age rule: in the Terms, and the red line when the sign-up tick is missing. */
export const AGE_LINE = "You must be 18 or older to use Playtest.";
/** The sign-up tick (email sign-up and Google's sign-up step). */
export const AGE_TICK = "I'm 18 or older.";
/** (Owner, Oct 28, batch 20 section 21) The updated-Terms tick above the button (Post / Join / Apply / Ask to rejoin), with "Read what changed" after it. */
export const TERMS_TICK_LABEL = "I agree to the updated Terms of Use.";
export const TERMS_TICK_LINK = "Read what changed";
/** Its red line (in the mistake list) and the server's refusal of an unticked press. */
export const TERMS_TICK_MISSING = "Tick to agree to the updated Terms of Use.";
/** The refusal's code: the page shows the box with the tick under the pressed button. */
export const TERMS_UPDATED_CODE = "terms_updated";

/** The short "What changed" note at the top of the Terms page: the newest version first. */
export const WHAT_CHANGED: { version: number; date: string; points: string[] }[] = [
  {
    version: 2,
    date: "Oct 28, 2026",
    points: [
      "The content rule (section 5) now reads: “Never allowed: sexual content involving minors, illegal content, real-world gore. Other graphic or mature content must be marked Mature (18+), with a reason.”",
      // (Batch 19 section 6) Folded into version 2: nothing has launched.
      "Payments section rewritten: every money rule is now in one place, section 4, How payments work, in short headed paragraphs with an example each.",
      // (Batch 19 section 3) The developer no longer lowers a call's length.
      "A call's length is measured by the app while both people are connected in the call room, up to 150% of the booked length and never past the $1,000 for that tester's calls. The developer pays by the hour at the call's rate; paying less needs a reason the tester reads, and the tester can dispute it once (section 4, Calls).",
      "A live call ends for both people when it reaches 150% of the booked length or its pay would pass what's left of the $1,000 for that tester's calls on the test, and when a block, a pause, a suspension, a leave, End early or a stop happens; the minutes before that are paid as usual (section 4, Calls).",
      // (Batch 21) Folded into version 2: nothing has launched.
      "Calls happen in the app's own call room, on the call page, straight between the two browsers (section 7).",
      "When these terms change, you're asked to agree to the new version the next time you post a test, or join, apply, accept an invite or ask to rejoin (section 8).",
      // (Batch 20 section 5) Folded into version 2: nothing has launched.
      "You must be 18 or older to use Playtest. Signing up (with email or Google) asks you to confirm it (section 1).",
    ],
  },
];

/**
 * (Owner, Oct 28, batch 19 section 6) The Terms' section 4, "How payments work": every money rule in one place, as short headed paragraphs with a one-line example
 * each. Taken from the design doc's Rules tab; where it differed from the app, the app's rules are written here.
 */
export const PAYMENT_RULES: { heading: string; text: string; example: string }[] = [
  {
    heading: "Prices and the split",
    text: "The developer sets the parts and the price of each on the listing: written answers and a recording $1 to $1,000 each, a live call $10 to $200 an hour, or free. The tester receives 80% of every payment; the platform keeps 20%.",
    example: "A written part paid $10.00 gives the tester $8.00; the platform keeps $2.00.",
  },
  {
    heading: "Days per tester",
    text: "Every tester on a test gets the same number of days, counted in whole days from when the test opened (it was posted, or its Next round opened) to its Open until. A tester's deadline is the day they join plus those days. A deadline is a guide: late work is accepted and marked as sent late.",
    example: "Opened Nov 6 with Open until Nov 20: 14 days per tester, so a tester who joins Nov 19 is due Dec 3.",
  },
  {
    heading: "Paying for work",
    text: "The developer pays any amount from $0 up for each piece of work; there is no reject. Paying less than the listing, or $0, needs a reason the tester reads. A payment above $0 is charged to the developer's card at once. The tester can dispute a payment on each piece once; our team reads the work, both sides and the chat, and its decision is final and can only raise the pay (up to the listing, or for unlisted work up to its cap, less what was already paid).",
    example: "A $20 recording paid $12 with the reason “Only half the levels were covered”: the tester reads it and can dispute it once.",
  },
  {
    heading: "Pay more",
    text: "After paying a piece, the developer can pay extra on it with Pay more, within the piece's cap: on a listed piece up to 100% of its listing on top (never past the $1,000 maximum for written answers or a recording), on unlisted written answers or a recording up to $1,000 on top, and nothing extra on an unlisted call. Pay more closes together with the test's last Pay or Charge.",
    example: "A written part listed at $20 can get up to $20 extra.",
  },
  {
    heading: "Unreviewed work: Charge or Let it go",
    text: `If a listed piece (or a listed call) isn't paid within ${REVIEW_DAYS} days of being sent (or of the call), and not before the tester's own deadline, the tester decides: Charge the developer's card up to what's left of the listing price, or Let it go. Nothing is charged automatically. A Charge over $200 needs a tick. Each piece gets at least ${CLOSE_OUT_DAYS} days of Charge.`,
    example: "Sent Nov 10 with a deadline of Nov 20: Charge opens Nov 20, the later of Nov 17 (7 days after sending) and the deadline.",
  },
  {
    heading: "Close-out",
    text: `${CLOSE_OUT_DAYS} days after the last tester's deadline (later for a piece whose Charge opened late: it keeps its ${CLOSE_OUT_DAYS} days), Pay, Pay more, Charge and Let it go end on the test. Work still unpaid then stays unpaid, and testers can no longer rate. Pauses and outages move the close-out later, as they move deadlines.`,
    example: "The last deadline is Dec 3: the close-out is Dec 17, and a piece whose Charge opened Dec 10 closes Dec 24.",
  },
  {
    heading: "Calls",
    text: "A call's length is measured by the app while both people are connected in the call room, up to 150% of the booked length and never past the $1,000 for that tester's calls. The developer pays by the hour at the call's rate; paying less needs a reason the tester reads, and the tester can dispute it once. All of one tester's calls on a test can come to at most $1,000 together, listed or not, extra pay included: a call ends for both when its pay reaches what's left. A call that isn't listed is paid what the developer chooses, at most $200 an hour.",
    example: "A call at $30 an hour where both people were connected for 50 minutes: $25.00.",
  },
  {
    heading: "Unlisted work",
    text: "A part or a call that isn't listed in the tester's contract is marked Not listed. The developer pays it any amount, $0 included (at most $1,000 for written answers or a recording, and $200 an hour for a call); Charge and Let it go never open for it.",
    example: "An unlisted recording can be paid anything from $0 (with a reason) to $1,000.",
  },
  {
    heading: "Bank checks, declines, holds",
    text: "When the developer presses Pay, Pay more, Pay what you owe, Subscribe or Verify a card and their bank wants to confirm it, the bank's check opens on the page; cancelled or failed, nothing is charged. A charge made while the developer isn't there (a tester's Charge, a dispute decision, a renewal) that the bank wants confirmed waits 3 days for the developer's confirmation, and the tester's pay is delayed meanwhile. A declined payment is owed: the developer's tests pause until they pay what they owe (it's retried once a day meanwhile, at most 7 times), and the tester's pay is delayed until then. A chargeback (the developer's bank reversing a payment) adds a $15 fee, and the tests stay paused until the developer verifies a card with 3D Secure and presses Pay what you owe, which reserves the amount on their card: it's taken when our team approves lifting the hold, and released if they don't approve or after about 7 days.",
    example: "A $10 payment reversed by the bank: $25 owed ($10 + the $15 chargeback fee).",
  },
  {
    heading: "Payouts",
    text: "Testers are paid through Stripe once their payout account is set up (that needs a confirmed email); until then their pay waits for them, and it goes out on its own once the setup is done.",
    example: "A tester paid $8.00 before setting up payouts receives it once their Stripe account can take payouts.",
  },
  {
    heading: "Subscriptions",
    text: "Developers can subscribe for $7 a month for the extras: up to 10 open tests at once, Approved-only testers, Next round and inviting testers. Everything is free during launch, until a date we announce. Billing is monthly from the day you subscribe; cancel any time and the extras last until the end of the paid month, with no refund. A declined renewal never pauses your tests: it's retried for about a week, then the subscription ends.",
    example: "Subscribe on Mar 31: it renews on Apr 30, then on May 31.",
  },
  {
    heading: "Taxes and refunds",
    text: "Testers are independent, not employees of the platform or of developers, and handle their own taxes. Payments aren't refunded, except when the platform wins a chargeback the developer already paid (the amount and the fee go back to their card).",
    example: "A $10 chargeback the platform wins after the developer paid it: $25 back to their card.",
  },
];

/** Whether this account still has to agree to the current Terms. (Batch 20 sections 5 and 21) Age is confirmed only at sign-up: existing accounts aren't asked. */
export const needsTermsAgain = (u: { termsVersion: number }) => u.termsVersion < TERMS_VERSION;
