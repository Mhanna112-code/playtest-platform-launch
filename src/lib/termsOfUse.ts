import { SENT_WORK_PRICE_EXPLANATION } from "./answerTerms";
// (Owner, Oct 28 evening, batch 18 section 1) The Terms of Use version each account accepted is stored (User.termsVersion; at sign-up, and when they agree again).
// TERMS_VERSION is bumped whenever the Terms change. An account on an older version is asked once, at its next Post a test / post a draft (developer) or Join,
// Apply, Accept an invite, Ask to rejoin (tester): a box under the button with a link to what changed and a tick. Nothing else is blocked.
import { CLOSE_OUT_DAYS, REVIEW_DAYS } from "./rules";
import { LIVE_CALL_LEAD_MINUTES } from "./callLead";
import { leadWords } from "./callWindow";

/** The current Terms of Use version. Bump it (and add a WHAT_CHANGED entry) whenever the Terms change. */
export const TERMS_VERSION = 2;
/**
 * (Owner, Nov 2, batch 35 §132) The call window as the site enforces it (section 7, Calls and recordings): at least 24 hours ahead (the live site's lead), and no later
 * than the latest deadline. It replaces calls booked any time ahead, even after a tester's deadline.
 */
export const CALL_WINDOW_TERMS = `A call can be booked at least ${leadWords(LIVE_CALL_LEAD_MINUTES)} ahead, and no later than when testers' work on the test ends (the latest tester's deadline, or Open until if later); daily and weekly calls stop there.`;
/** Current notification rules, including the immediate exceptions added in batch 35. */
export const EMAIL_TIMING_TERMS = "You can turn summary emails off, or choose daily, weekly or monthly. Payment updates and important account notices are included in the daily email even with emails off: account suspensions and reinstatements, tests paused, resumed, stopped or closed by the team, deadline and review reminders, booked calls and final rating reminders. New chargeback notices and the 24-hour call reminder are emailed immediately, even with emails off. Password reset and email confirmation links are sent when requested. Other bell notices follow your email setting. Emails depend on the scheduled jobs running and may be delayed if delivery fails; failed deliveries are retried.";
export const PAUSE_DEADLINE_TERMS = "When a paused test resumes, working testers whose deadlines had not passed when the pause began get that time back, even if their old deadline passed during the pause. Their new deadline is rounded up to the end of the day. A deadline already past when the pause began stays past. Overlapping pauses count once. A test that stays paused closes after 7 days unless the team extends its closing date; a closed test does not resume automatically.";
export const EDIT_TEST_TERMS = `Every saved edit updates the test's current listing. For testers already on the test, changes to their agreed parts and prices are offered separately: Switch accepts the new parts and prices; Keep retains their existing agreed parts and prices. ${SENT_WORK_PRICE_EXPLANATION} An unanswered parts-and-prices offer blocks sending until the tester chooses Switch or Keep. Keep does not preserve an older version of the rest of the listing: other edits apply where relevant, including the questions, instructions, build link, devices, languages and NDA. Question changes retain earlier answers in Terms history. An NDA change requires its own acknowledgement, separately from Switch or Keep. While a test is paused or stopped, the developer can edit only its NDA. This does not reopen the test or change payment dates. Past testers can acknowledge the change too. Excerpts remain hidden while an NDA is present; removing it restores otherwise approved excerpts. Editing an NDA does not mean a tester accepted it before they acknowledged it. Moving Open until later extends working testers' deadlines only if those deadlines have not already passed; moving it earlier does not shorten their deadlines.`;
/** The anchor of the "What changed" note at the top of the Terms page. */
export const WHAT_CHANGED_ID = "what-changed";
export const TERMS_CHANGED_HREF = `/terms#${WHAT_CHANGED_ID}`;
/** The box's line (and the server's refusal of an unticked press). "Read the Terms" links to the note. */
export const TERMS_UPDATED_LINE = "We updated our Terms of Use. Read the Terms.";
export const TERMS_AGREE_LABEL = "I agree to the updated Terms";
/** (Owner, Oct 28, batch 20 section 5) The age rule: in the Terms, and the red line when the sign-up tick is missing. */
export const AGE_LINE = "You must be 18 or older to use Playtest.";
/** The sign-up tick (email sign-up and Google's sign-up step). */
export const AGE_TICK = "I'm 18 or older.";
/** (Owner, Oct 28, batch 20 section 21) The updated-Terms tick above the button (Post / Join / Apply / Ask to rejoin), with "Read the Terms" after it. */
export const TERMS_TICK_LABEL = "I agree to the updated Terms of Use.";
export const TERMS_TICK_LINK = "Read the Terms";
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
      "Edits update the current listing for existing testers where relevant. Switch or Keep applies to their agreed parts and prices; keeping those terms does not keep old questions or other listing information (section 2).",
      "The content rule (section 5) now reads: “Never allowed: sexual content involving minors, illegal content, real-world gore. Other graphic or mature content must be marked Mature (18+), with a reason.”",
      // (Batch 19 section 6) Folded into version 2: nothing has launched.
      "Payments section rewritten: every money rule is now in one place, section 4, How payments work, in short headed paragraphs with an example each.",
      // (Batch 19 section 3) The developer no longer lowers a call's length.
      "A call's length is measured by the app while both people are connected in the call room, up to 150% of the booked length and never past the $500 for that tester's calls. The developer pays by the hour at the call's rate; paying less needs a reason the tester reads, and the tester can dispute it once (section 4, Calls).",
      "A live call ends for both people when it reaches 150% of the booked length or its pay would pass what's left of the $500 for that tester's calls on the test, and when a block, a pause, a suspension, a leave, End early or a stop happens; the minutes before that are paid as usual (section 4, Calls).",
      // (Batch 21) Folded into version 2: nothing has launched.
      "Calls happen in the app's own call room, on the call page, straight between the two browsers (section 7).",
      "When these terms change, you're asked to agree to the new version the next time you post a test, or join, apply, accept an invite or ask to rejoin (section 8).",
      // (Batch 20 section 5) Folded into version 2: nothing has launched.
      "You must be 18 or older to use Playtest. Signing up (with email or Google) asks you to confirm it (section 1).",
      // (Batch 29 §37, the batch 28 points) Folded into version 2: nothing has launched.
      "To decide a dispute, our team can read the chat between the tester and the developer (section 4, Paying for work).",
      "A piece of work can be paid at most the part's maximum in all, listed or not: $500 for written answers or a recording, $200 an hour for a call's measured length. Pay, Pay more and a dispute decision all count toward it (section 4, Pay more).",
      "A listed call the developer hasn't paid 7 days after it took place is charged to their card automatically; there's no Charge or Let it go for it (section 4, Calls).",
      "Payment updates are included in the daily email whatever your email setting, Off included; new chargeback notices are sent immediately (section 4, Bank checks, declines, holds).",
      // (Batch 35 §132) Folded into version 2: nothing has launched.
      `${CALL_WINDOW_TERMS.replace(/\.$/, "")} (section 7).`,
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
    text: "The developer sets the parts and the price of each on the listing: written answers and a recording $1 to $500 each, a live call $10 to $200 an hour, or free. The tester receives 80% of every payment; the platform keeps 20%.",
    example: "A written part paid $10.00 gives the tester $8.00; the platform keeps $2.00.",
  },
  {
    heading: "Days per tester",
    text: "Every tester on a test gets the same number of days, counted in whole days from when the test opened (it was posted, or its Next round opened) to its Open until. A tester's deadline is the day they join plus those days. A part first sent after your own deadline is still accepted and marked as sent late, but it can't be charged if the developer doesn't review it: only the developer pressing the Pay button settles it. Later additions follow the rules in Editing a test: Switch or Keep above; additions after the deadline or once Charge opens preserve the saved price and Charge eligibility without creating extra entitlement. Nothing can be sent once the test has ended (at the last tester's deadline).",
    example: "Opened Nov 6 with Open until Nov 20: 14 days per tester, so a tester who joins Nov 19 is due Dec 3.",
  },
  {
    // (Owner, Nov 6, §288) Disputes close when the tester rates and at the piece's closing date (edited in place: nothing has launched).
    heading: "Paying for work",
    text: "The developer pays any amount from $0 up for each piece of work; there is no reject. Paying less than the listing, or $0, needs a reason the tester reads. A payment above $0 is charged to the developer's card at once. The tester can dispute a payment on each piece once; our team reads the work and both sides, and its decision is final and can only raise the pay up to the piece's cap, less what that piece was already paid. To decide a dispute, our team can read the chat between the tester and the developer. A tester's disputes close when they rate the test (a payment made after that included) and at each piece's closing date; a dispute already open stays open until our team decides it.",
    example: "A $20 recording paid $12 with the reason “Only half the levels were covered”: the tester reads it and can dispute it once.",
  },
  {
    // (Owner, Nov 4, batch 35 §171) The stop rules for payments (§159, §160, §163, §171), in the Terms. Edited in place: nothing has launched (no new version).
    heading: "Changes while you pay",
    text: "A stop-once notice shows what changed. Press again to continue if the action is still allowed. A tester’s dispute, the team’s decision, or a charge for that tester forces a stop on the developer’s payment, End early, and call buttons for that tester, even with Alerts off. Charges include the tester’s Charge, automatic call charges, and charges from team decisions. Those events follow Alerts on whole-test buttons and buttons for other testers. The tester leaving or being removed and the developer’s own actions in another tab also stop payment buttons. Work sent or added and ordinary payments follow Alerts, even on the same part. Call reports and final lengths follow Call changes alerts. Developer Rate and team Decide have separate checks. On the tester’s side, a team decision or the developer adding their side to the tester’s dispute forces a stop on applicable buttons. Ordinary developer payments follow the tester’s Alerts, even on that part. Unavailable actions are refused immediately, including Charge or Let it go after the developer pays. Existing bank confirmations can still go through during a developer suspension or team pause, within their original three-day deadline. New Pay and Pay more are unavailable during those restrictions. An open bank check shows changes about that tester regardless of Alerts. Complete can only pay the requested amount while the check is active. Cancel charges nothing.",
    example: "With Work sent alerts on, Nina adding to their recording can stop Pay once. With those alerts off, that addition alone won’t stop Pay.",
  },
  {
    heading: "Pay more",
    text: "After paying a piece, the developer can pay extra on it with Pay more, within the piece's cap: the part's maximum in all, listed or not ($500 for written answers or a recording; $200 an hour for a call's measured length), counting the first payment, every Pay more and any dispute decision. A listed price at the maximum leaves no room for Pay more. All of one tester's calls on a test stay within $500 together. Pay more closes together with the test's last Pay or Charge.",
    example: "A written part listed at $20 can be paid up to $500 in all.",
  },
  {
    heading: "Unreviewed work: Charge or Let it go",
    text: `If a listed piece of work isn't paid within ${REVIEW_DAYS} days of being sent, and not before the tester's own deadline, the tester chooses between two buttons: Charge charges the developer's card up to the agreed price saved on that submitted piece; Let it go leaves that work unpaid. The Charge and Let it go buttons are offered only while the developer hasn't paid anything on that part; once the developer has paid, the Dispute button is the way to ask for more, if eligible. Each piece gets at least ${CLOSE_OUT_DAYS} days of Charge. A part first sent after the tester's own deadline never opens Charge or Let it go: the developer decides what to pay for it (any amount, $0 included; below the listing needs a reason the tester reads), and the tester can still dispute the payment once. A listed call works differently: if the developer hasn't paid it ${REVIEW_DAYS} days after it took place, their card is charged automatically for its measured length at the call's rate (within the $500 for that tester's calls), with no Charge or Let it go. See Deadline changes, pauses and outages below.`,
    example: "Sent Nov 10 with a deadline of Nov 20: Charge opens Nov 20, the later of Nov 17 (7 days after sending) and the deadline.",
  },
  {
    heading: "Close-out",
    text: `${CLOSE_OUT_DAYS} days after the latest tester deadline or Open until, whichever is later (later for a piece whose Charge opened late: it keeps its ${CLOSE_OUT_DAYS} days), Pay, Pay more, Charge and Let it go end on the test. Work still unpaid then stays unpaid. The tester's rating countdown can run later if an open dispute paused it; this does not reopen payment or dispute buttons. Pauses and outages move the close-out later, as they move deadlines.`,
    example: "The last deadline is Dec 3: the close-out is Dec 17, and a piece whose Charge opened Dec 10 closes Dec 24.",
  },
  {
    heading: "Calls",
    // (Owner, Nov 6, §280) No booking check against the $500: only the call's own end at what's left (folded into version 2: nothing has launched).
    text: `A call's length is measured by the app while both people are connected in the call room, up to 150% of the booked length and never past the $500 for that tester's calls. The developer pays by the hour at the call's rate; paying less needs a reason the tester reads, and the tester can dispute it once. All of one tester's calls on a test can come to at most $500 together, listed or not, extra pay included. Booking isn't limited by it: a call ends by itself, for both people, when its pay at the call's rate ($200 an hour for a call that isn't listed) reaches what's left. A call that isn't listed is paid what the developer chooses, at most $200 an hour. A listed call the developer hasn't paid ${REVIEW_DAYS} days after it took place is charged to their card automatically for its measured length at the call's rate (within the $500), with no Charge or Let it go.`,
    example: "A call at $30 an hour where both people were connected for 50 minutes: $25.00.",
  },
  {
    heading: "Unlisted work",
    text: "A part or a call that isn't listed in the tester's contract is marked Not listed. The developer pays it any amount, $0 included (at most $500 for written answers or a recording, and $200 an hour for a call); Charge and Let it go never open for it.",
    example: "An unlisted recording can be paid anything from $0 (with a reason) to $500.",
  },
  {
    heading: "Bank checks, declines, holds",
    text: "When the developer presses Pay, Pay more, Pay what you owe, Subscribe or Verify a card and their bank wants to confirm it, the bank's check opens on the page; cancelled or failed, nothing is charged. A charge made while the developer isn't there (a tester's Charge, a listed call's automatic charge, a dispute decision, a renewal) that the bank wants confirmed waits 3 days for the developer's confirmation, and the tester's pay is delayed meanwhile. A declined payment is owed: the developer's tests pause until they pay what they owe, and the tester's pay is delayed until then. What you owe is charged when you press Pay what you owe. A chargeback (the developer's bank reversing a payment) adds a $15 fee, and the tests stay paused until the developer verifies a card with 3D Secure and presses Pay what you owe, which reserves the amount on their card: it's taken when our team approves lifting the hold, and released if they don't approve or after about 7 days. From an account's 2nd chargeback (every payment ever reversed counts), our team reviews the account before the developer can pay: once the team allows it, Pay what you owe charges everything owed as one payment and the tests resume; a new chargeback before paying needs the team's review again. If the bank changes the amount it reversed after the developer repaid it, the difference is settled at once: a lower amount is refunded to their card, a higher one is charged to it like a charge made while they aren't there. Emails about payments (receipts, payments, declines, holds, delays and payouts) are included in the daily email, whatever the email setting, Off included. New chargeback notices are sent immediately. Changes to the amount reversed are included in the daily email. Delivery may be delayed and failed deliveries are retried.",
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
    text: "Testers are independent, not employees of the platform or of developers, and handle their own taxes. Payments aren't refunded, except when the platform wins a chargeback the developer already paid (the amount and the fee go back to their card), or when the bank lowers the amount it reversed after the developer repaid it (the difference goes back to their card).",
    example: "A $10 chargeback the platform wins after the developer paid it: $25 back to their card.",
  },
];

/** Whether this account still has to agree to the current Terms. (Batch 20 sections 5 and 21) Age is confirmed only at sign-up: existing accounts aren't asked. */
export const needsTermsAgain = (u: { termsVersion: number }) => u.termsVersion < TERMS_VERSION;

export const DEADLINE_MOVEMENT_TERMS = "Extending Open until by a number of days adds those days to working testers' deadlines only if those deadlines have not already passed. It does not extend a tester who has left or whose work ended, and shortening Open until never shortens an existing tester's deadline. Rejoining uses the remaining-time rules; accepting new parts and prices alone does not restart review or Charge dates for submitted work. Developer holds, developer suspensions, team pauses and recorded outages move eligible Open until, working-tester deadlines, review dates, Charge windows and close-out dates later. An Open until already passed when a pause began does not reopen. A working tester whose deadline had not passed when a test pause began gets that paused time back on resuming, even if the old deadline passed during the pause; an already-expired deadline stays expired. Overlapping pause periods count once. A tester-side suspension adds its time to that tester's Charge window; Charge and Rate are unavailable while suspended. Separately, time an open dispute would consume from the tester's remaining rating countdown is paused until the team decides it, with overlapping disputes or pauses counted once. This rating extension does not extend the dates for starting new disputes or paying parts. A dispute already open remains with the team after a closing date. Cancelled calls need new bookings; a date extension does not restore them.";
