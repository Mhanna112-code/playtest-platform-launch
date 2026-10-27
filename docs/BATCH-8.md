# Batch 8: developer subscription, $7/month (owner, Oct 28)

This file wins over the earlier batches and the design doc where they differ. The lean app has no subscription today; this adds one. Look at the full app's version for reference only (C:/Users/march/Projects/playtest-platform: src/app/dev/billing/page.tsx, `subscribe` / `cancelSubscription` / `resumeSubscription` / `syncSubscription` / `periodEnd`). Match its UI patterns, but follow THESE rules.

## 1. Plans
- **Free plan (every developer):** one open test at a time. A test counts as open while it is Open, Full or Paused. Drafts, Stopped and Closed tests don't count.
- **Subscription, $7/month** (`SUBSCRIPTION_CENTS = 700`, one constant) adds:
  - several open tests at once;
  - Approved-only testers (applications);
  - Next round;
  - Invite testers.
- Testers never pay and never see any of this. The 20% platform share on payments is unchanged.

## 2. Where it shows
- **Payments page:** a "Subscription · $7/month" section.
  - Not subscribed: the perks list and "Subscribe for $7/month". This needs a saved card.
  - Subscribed: active since, renews on, and "Cancel subscription".
  - Cancelled: "You can use the perks until <date>; you won't be charged again." plus "Keep my subscription".
  - Each charge gets a receipt line.
- **Post a test, on the free plan with an open test already:** Post is refused with the blue notice under the button: "You already have an open test. Subscribe ($7/month) to run several at once." with a link to Payments (new tab). The form keeps what was typed.
- **Perk buttons on the free plan** (Approved-only on Post and Edit, Next round, Invite testers): still visible, each with a small "Subscribers" tag. A press is refused with the same kind of notice, naming the perk.
- **Losing the subscription** (cancel ends, or a renewal lapses):
  - Running tests carry on as they are: an Approved-only test stays Approved-only, and invites already sent stay valid.
  - Only NEW uses of a perk are refused.
  - A page open at that moment gets it as a stop-once change: "Your subscription ended."

## 3. Billing
- Use Stripe Billing when keys are set (renewals and failures through the webhook). Without Stripe, record it by hand, as the rest of lean does.
- Monthly from the sign-up day. The 31st renews on the last day of shorter months.
- Cancel any time. It lasts until the end of the paid month. No refunds.

## 4. A declined renewal: it lapses, with no hold
This is an exception to "any decline starts a payment hold".
- Stripe retries for about a week. The perks continue meanwhile.
- The developer gets a bell and an email (sent even with email Off): "Your $7 subscription payment didn't go through. Update your card by <date> to keep it."
- After the last retry fails, the subscription ends and they drop to the free plan (section 2 applies). Bell and email: "Your subscription ended because the payment didn't go through."
- Testers are never affected.
- A chargeback on a subscription payment starts a chargeback hold, like any chargeback (the amount is added to what is owed).

## 5. During a payment hold, a chargeback hold or an admin suspension
- Billing pauses: no renewal is charged while it lasts.
- When the hold or suspension starts, store the paid days left. When it lifts, those days resume (the next renewal moves later by the time it was paused). With Stripe, pause collection and push the next billing date; choose the mechanism yourself and document it.
- The developer can still Cancel from Payments, since Payments stays open.
- Deleting the account, or the team deleting it, cancels the subscription at once with no refund. Add a line to the delete warning: "Your subscription ends now, with no refund for the rest of the month."

## 6. Free during launch
- An admin setting "Free for everyone until <date>". Until that date, every developer has the subscription perks without paying, and Payments shows "Free during launch until <date>: everything is included. Subscribe to keep the extras after that."
- If no date is set, it's free with no end ("Free during launch").
- When an admin sets the date: every developer gets a bell and an email (sent even with email Off) 30 days before ("…extras need a $7/month subscription from <date>"), and another 7 days before. Refuse a date less than 30 days away.
- A developer who subscribes during the free period is first charged on that date.

## 7. Admin
- Each user row shows the subscription state: free plan, subscribed, cancelled until <date>, lapsed, or paused (hold or suspension).
- The admin settings hold the free-during-launch date.

## Check and report
- A migration is needed: the subscription fields on User and the free-until setting. Write it by hand and check it with:
  `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <DATABASE_URL with the db name swapped to playtest_lite_shadow> --exit-code`
  It must report "No difference detected".
- Tests for everything above. Run `NEXT_DIST_DIR=.next-build npm run check`. A stale Prisma client (you can't run `generate` while port 3400 runs) is the only acceptable failure. Say so if it is the case.
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed, the Stripe pause mechanism you chose, the migration name, and any interpretations.

## 8. Settled details (DEFAULT: my recommendations, easy to change)
1. When free-during-launch ends, it works like a lapse: running tests carry on, and only NEW uses of a perk are refused.
2. A test that stays Approved-only after the subscription ends keeps working fully: the developer can still accept or decline its applications. Using a perk on an existing test is not a new use.
3. During a hold or suspension, Subscribe is refused: "You can subscribe once your account is active again." "Keep my subscription" still works, because it charges nothing.
4. "Your subscription ended because the payment didn't go through." is sent even with email Off, like the renewal-failed email.
5. The subscription bell lines join the "Payments and holds" stack.
6. If an admin moves the free-until date later, developers get a new notice: "…now from <date>". If they move it earlier, the 30-day minimum still applies and a new notice goes out. If they clear it: "The extras stay free for now."
7. Per-perk refusal text: "<Perk> needs a subscription ($7/month)." with a Payments link (new tab); for Approved-only it is plural: "Approved-only testers need a subscription ($7/month)." The perks are named "Inviting testers", "Next round", "Approved-only testers" and "Running several open tests"; posting a second open test keeps its own notice from section 2.
