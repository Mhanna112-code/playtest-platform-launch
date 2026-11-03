# Long text: layout check (Nov 3)

The owner asked (Nov 3) that long text never breaks a page: action buttons drop onto their own line when the text beside them is long, and an amount always
shows every digit (names may be cut with "…" where the app already cuts them).

## How it was checked

- A separate dev server (port 3484, its own schema `rec_long`, the fake Stripe) with throwaway `@playtest.test` accounts only. Every name was at its limit:
  display names of 80 characters (two of them with no spaces at all), test titles and product names of 60 (one of each unbroken), emails of about 90
  characters. Amounts at their largest: pieces at $1,000.00, a single charge of $999,999.99, "What you've paid" over $1,000,000, Pay what you owe at
  $15,999.84 over 16 lines, a charges-made-while-away payment covering 12 charges, 20+ bell lines, 10 testers on one test, long chats with unbroken links.
- Every screen at desktop (1280 wide) and phone (390 wide). Files: `before-<place>-<desktop|phone>.png` (master as it was) and
  `after-<place>-<desktop|phone>.png` (this branch). Pictures of one item (a piece, a tester row, the call panel) open the scroll boxes around it so the
  whole item shows; the boxes themselves are unchanged.
- Each page was also measured in the browser: how far it scrolls sideways, text squeezed into a narrow column, an amount split over two lines, and an
  amount cut by "…". Before → after (all zero after):

| Page (width) | Scrolls sideways | Squeezed text | Amount split | Amount cut |
|---|---|---|---|---|
| Developer dashboard (phone) | 0 | 2 → 0 | 0 | 0 |
| Test page (phone) | 263 px → 0 | 0 | 0 | 0 |
| Find tests (desktop) | 0 | 0 | 1 → 0 | 0 |
| Find tests (phone) | 346 px → 0 | 0 | 0 | 0 |
| Tester dashboard (phone) | 236 px → 0 | 0 | 0 | 0 |
| Messages, developer (phone) | 325 px → 0 | 0 | 0 | 0 |
| Messages, tester (phone) | 297 px → 0 | 0 | 0 | 0 |
| Notifications (phone) | 0 | 0 | 0 | 1 → 0 |

Every other page measured zero before and after.

## What was checked, what broke, and the fix

All fixes are CSS and markup only: no wording or behaviour changed.

| Place | What broke | Fix | Pictures |
|---|---|---|---|
| Developer dashboard: "Your bank wants you to confirm" | Nothing: the lines wrap, $999,999.99 stays whole, Confirm with your bank is full width on a phone. | None | `*-dash-bank-*` |
| Developer dashboard: Needs you | Phone: a row with an action ("asked for a live call" … "Answer in Live session →") squeezed the name and words into a column 39 px wide. | The words keep at least 12rem; the action drops onto its own line, right-aligned. | `*-dash-needs-*` |
| Developer dashboard: Calls | With long names the whole row was cut with "…", hiding the call's day, time and length. | Only the names are cut; the day, time and length always show, on their own line when the names are long. | `*-dash-calls-*` |
| Payments: "Your bank wants you to confirm" | Nothing: "Confirm with your bank →" drops below a long line. | None | `*-payments-confirm-*` |
| Payments: Your card | Nothing. | None | `*-payments-card-*` |
| Payments: What you've paid (and the tester's Your earnings) | Nothing at 390 px, but the heading row could not wrap, so on a narrower phone a large total would split in the middle of the number. | The heading row wraps (the total moves under the heading); the total and each line's amount are kept on one line. | `*-payments-paid-*` |
| Payments: Pay what you owe (16 lines, 3 waiting for the bank with Cancel this check) | Nothing: Cancel this check drops onto its own line; amounts whole. | None | `*-hold-payments-owed-*` |
| Dashboard on a payment hold, and on a chargeback hold | Nothing. | None | `*-hold-dash-box-*`, `*-chargeback-dash-box-*` |
| Chargeback steps (Payments) | Nothing. | None | `*-chargeback-steps-*`, `*-chargeback-owed-*` |
| Admin console: chargeback hold row with Approve; Lifts row with Approve | Nothing: Approve sits after the line on desktop and on its own line on a phone; the 90-character emails wrap. | None | `*-admin-chargebacks-*`, `*-admin-lifts-*` |
| Test page: Needs you and the tester rows | Phone: the page scrolled sideways (263 px): a tester's unbroken name in their "N parts to pay" fold ran past the box; the testers' hover cards (hidden until hovered) reached past the screen from avatars near the right edge, and their "Chat with <name>" button grew to 557 px for an unbroken name. | The fold's name wraps beside the arrow with the count after it; on phones the hover cards open from the row's left edge (under the avatar from sm up, as before); a button is never wider than the space it sits in (`max-width: 100%`, every button style) and the Chat with label wraps. | `*-test-needs-*`, `*-test-items-row-*`, `*-test-items-row2-*` |
| Test page: a piece and a call with their Pay boxes | Nothing. | None | `*-test-items-piece-*`, `*-test-items-call-*` |
| Test page: the call panel (Live session) | A booked call with a shorter line had "Add to calendar" at the end of its line and "Cancel" on the next. | The call's buttons move together: beside the line when there is room, all on their own line when it is long. | `*-test-items-live-*` |
| Tester's session page | Phone: Rate's note box was squeezed to about 20 px between the stars and "Rate and finish". | The note keeps at least 12rem, so it takes its own line on a phone. | `*-session-rate-*` (also `*-session-top-*`, `*-session-parts-*`, `*-session-live-*`: nothing else broke) |
| Tester's session page, developer name with a 35-letter word | "Charge <developer> $1,000.00" grew wider than its box. | Buttons never wider than their box; the label wraps (the long word too) and the amount stays whole. | `*-session-f1-parts-*` |
| Call page header (both sides) | Nothing: the long "Call with …" heading and the test link wrap. | None | `*-call-head-*`, `*-call-tester-head-*` |
| Find tests cards | Desktop: the pay column was squeezed by a long title and "from $800.00" split as "$800.0 / 0". Phone: every card was 346 px wider than the screen (the grid grew to the longest title). | The pay column never shrinks: at most half the card beside the title, under the title on a phone; each amount stays whole; a card may shrink, so the title is cut with "…" as before. | `*-find-cards-*` |
| Tester dashboard: Upcoming calls, New tests for you, History | Upcoming calls: as the developer's Calls box, a long developer name hid the call's day, time and length. Phone: the New tests cards ran 236 px past the screen and their pay line was cut by the edge of the screen; History rows had the same squeeze as Needs you. | Upcoming calls as the Calls box; New tests as Find (the card may shrink, amounts whole); History rows keep their words at 12rem. | `*-tdash-top-*` |
| Messages list (both sides) | Phone: long names ran up to 325 px past their card (the name could not shrink) and the unread count sat on top of them. | The name wraps inside the card; the test's name goes under it, cut with "…". | `*-messages-list-*`, `*-messages-tester-list-*` |
| A test chat and a direct chat | Nothing: unbroken links and words wrap inside the bubbles. | None | `*-chat-chat-*`, `*-direct-chat-*` |
| Notifications (the bell list) | A stack's one-line preview, cut with "…", could cut through an amount ("$1,00…"). | Every amount in a bell line is one unit: in a cut preview it shows whole or not at all. | `*-bell-list-*` |
| Written answers (everywhere they show) | Nothing found, but a long unbroken word (a pasted link) could widen a tester row on a phone. | Long unbroken words wrap anywhere, as reasons and notes already do (batch 35 §43). | (covered by `*-test-items-*`) |
| Call room status bar; tester's payout banner | Not pictured (needs a live call / a failed payout): the same squeeze pattern as Rate. | The same fix: the words keep at least 12rem. | — |
| Amounts in rows: To do's pay, Charge's "(up to $X)", a tester row's "paid $X" for calls | Nothing at these widths; an amount in a flex row could still split on a very narrow screen. | Kept on one line (`whitespace-nowrap`). | — |

New helper: `src/components/Amounts.tsx` (`keepAmounts(text)`) keeps every amount in a line as one unit that never splits over two lines and is never
drawn partly behind "…". It is used where a line can be cut or squeezed: bell lines and previews, Find's and the tester dashboard's pay lines.

## Suggestions (product decisions)

1. **A cap for unbroken words in names (recommended: 30 characters).** Names may be 80 characters with no space at all; the layout now copes, but such a
   name wraps letter by letter in buttons and headings. Refusing a word longer than 30 characters in a name at sign-up and in Profile would avoid it.
2. **"Charges made while you were away" lists every charge inline (recommended: the first 3, then "+N more").** With 12 charges the dashboard row is about
   12 lines long; the bank box's scroll box then shows barely one row on a phone.
3. **Pay what you owe lists every debt (recommended: a scroll box after 5 lines, like the other long lists).** 16 debts make the box about 30 lines tall on a
   phone before its button.
4. **Bell stack previews (recommended: two lines instead of one).** A preview is one line cut with "…"; an amount near the cut is now hidden whole, so the
   preview often ends just before the amount. Two lines would show it in most cases.
5. **Stat tiles show $10,000 and above as "$12.4k" (by design, "Big numbers").** If "every digit" should hold there too, the tiles would need the exact
   amount (on a second line, or on hover).
6. **Product names on cards (recommended: one line, cut with "…").** The product name is drawn in wide capitals; at 60 characters it takes 3–4 lines of a
   phone card above the title.
7. **"Answer in Live session → →".** The row's action text ends with "→" and an arrow icon is drawn after it. Not changed here (wording); dropping one of
   them would read better.
