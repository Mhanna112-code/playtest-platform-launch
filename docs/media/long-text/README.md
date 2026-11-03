# Long text: layout check (Nov 3)

The owner asked (Nov 3) that long text never breaks a page: action buttons drop onto their own line when the text beside them is long, and an amount always
shows every digit (names may be cut with "…" where the app already cuts them).

## How it was checked

- A separate dev server (port 3484, its own schema `rec_long`, the fake Stripe) with throwaway `@playtest.test` accounts only. Every name was at its limit:
  display names of 80 characters (two of them with no spaces at all), test titles and product names of 60 (one of each unbroken), emails of about 90
  characters. Amounts at their largest: pieces at $1,000.00, a single charge of $999,999.99, "What you've paid" over $1,000,000, Pay what you owe at
  $12,999.95 over 17 lines, a charges-made-while-away payment covering 12 charges, 20+ bell lines, 10 testers on one test, long chats with unbroken links.
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
| Payments: Pay what you owe (17 lines, 3 waiting for the bank with Cancel this check) | Nothing: Cancel this check drops onto its own line; amounts whole. | None | `*-hold-payments-owed-*` |
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
3. **Pay what you owe lists every debt (recommended: a scroll box after 5 lines, like the other long lists).** 17 lines make the box about 30 lines tall on a
   phone before its button.
4. **Bell stack previews (recommended: two lines instead of one).** A preview is one line cut with "…"; an amount near the cut is now hidden whole, so the
   preview often ends just before the amount. Two lines would show it in most cases.
5. **Stat tiles show $10,000 and above as "$12.4k" (by design, "Big numbers").** If "every digit" should hold there too, the tiles would need the exact
   amount (on a second line, or on hover).
6. **Product names on cards (recommended: one line, cut with "…").** The product name is drawn in wide capitals; at 60 characters it takes 3–4 lines of a
   phone card above the title.
7. **"Answer in Live session → →".** The row's action text ends with "→" and an arrow icon is drawn after it. Not changed here (wording); dropping one of
   them would read better.

# Names cut at 10 characters (owner, Nov 3)

The rule the owner confirmed: a name (a person, a test, a product) or an email **listed** on a page is drawn cut, and the full text stays one tap or hover away.

- **Drawn:** the first 10 characters and "…" with a dotted underline (`Alexandria…`); an email is cut in the middle: the part before "@" keeps 6 characters
  when it is longer than 7, the domain is cut only past 14 (`maximi…@playtest.test`, `guadal…@testing-accoun…`). A name of 10 characters or fewer is drawn
  exactly as before: no underline, no tooltip, no extra markup.
- **The full text stays in the page:** a visually hidden copy right after the cut one (the cut one can't be selected), plus `title` and `aria-label`. Selecting
  a row and copying it gives the full names, never "Alexandria…"; screen readers read the full name once.
- **With a mouse:** the browser's tooltip shows the full name; a click does what it did (a name in a row's link still opens that row's page).
- **On a touch screen (no hover):** tapping a cut name opens a small pop-up instead of following the link: the full text in a scroll box (about 6 lines,
  long words wrap), "Open profile →" or "Open test →" when the name is a link, and Copy ("Copied"). A tap outside, Escape or scrolling closes it; it is at
  most 78% of the screen wide and moves left to stay on the screen. Tapping a name that isn't cut works as before.
- **Never cut:** amounts; a page's own heading (the test page's title, a profile's name, "Call with …", the join page); form fields and their labels; the
  Terms and Privacy pages; the bell's and the emails' words (written on the server; the owner decides those separately); the payment sentences (already cut
  by `pieceName`); sentences about a person ("You rated …", "Note to …", "Charge … $X", "Chat with …"); a hover card's own name heading (it is there to show
  the full name).

Built as one component, `src/components/Cut.tsx` (`<Cut text={name} kind="person" | "test" | "product" | "email" />`), with `cutTo` and `cutEmail` in
`src/lib/rules.ts` (`cut10`, used by the payment lines, is unchanged). Used in:

| Page | Where |
|---|---|
| Developer dashboard | Disputes and excerpt requests (name, test), Needs you (name, test, the per-test rows), Calls (name, test), Your tests cards (title, product) |
| Tester dashboard | Charge or cancel, To do, Waiting, Upcoming calls (developer, test), Invitations (developer, test), New tests for you, History (test, developer), Tests visited, Search by developer |
| Test page | Needs you (each person's fold, each piece's tester, disputes, excerpt requests, call requests), tester rows, "No longer working", applications, invite lists, keys, the call panel (tick list, rows, waiting lines), By question, End early's tick list |
| Find tests | Cards (product, title, developer) |
| Messages and chats | Each row's name, test and the last message's sender; the sender above each chat bubble (`PersonHover`, also the session page's "by …") |
| Payments | The tester's "Everything you sent" (test, developer or their email) |
| Profiles | A developer's open tests; "Your tests with …" |
| Call page | The test under "Call with …" |
| Notifications | A stack's title when it is a test's name |
| Admin console | Every person link and test link in the lists (`AdminRich`), the emails in their lines, Your actions, the dispute chat's names |

Checked in the browser (Chrome; the script is `scratch/cut-checks.cjs` in the worktree, not committed):

| Check | Result |
|---|---|
| Phone (touch, no hover): tap a cut name in a Messages row | The pop-up opened with the full 80-character name and "Open profile →" (the profile's address); the page stayed on Messages. |
| Copy in the pop-up | The clipboard held the full name; "Copied" showed. |
| A tap outside / Escape | The pop-up closed. |
| A 254-character email (admin console, Lifts) | Drawn `guadal…@testing-accoun…`; the pop-up was 304 px wide on a 390 px screen (8 px from the edge) and its text scrolled (6 lines shown). |
| Desktop (mouse): click a cut name in a Needs you row | No pop-up; it opened the row's own link (`/app/tests/…#req-…`). The full name is the tooltip (`title`). |
| Select a whole Messages row and copy (desktop) | The copied text had the full names, never the cut ones. |

The browser's own tooltip can't be pictured by the automation; the markup of a cut name (Needs you, desktop):

```html
<span title="Harbor Run: the lighthouse, the night harbors and the storms" aria-label="Harbor Run: the lighthouse, the night harbors and the storms" data-cut="test"><span aria-hidden="true" class="select-none underline decoration-dotted decoration-1 underline-offset-2" data-cut-shown="">Harbor Run…</span><span class="sr-only" data-cut-full="">Harbor Run: the lighthouse, the night harbors and the storms</span></span>
```

Pictures: `precut-<place>-<desktop|phone>.png` (this branch before the cut) and `cut-<place>-…png` (after) for the dashboards (`dash-needs`,
`dash-calls`, `tdash-top`), the test page (`test-items-row`, `-row2`, `-piece`, `-call`, `-live`), the session page (`session-top`), Find (`find-cards`),
Messages (`messages-list`, `messages-tester-list`), a chat (`chat-chat`), the call page (`call-head`), the bell (`bell-list`) and the admin console
(`admin-chargebacks`, `admin-lifts`). The touch pop-up: `cut-popup-name-phone.png`, `cut-popup-name-copied-phone.png` (a long name, then Copy),
`cut-popup-email-phone.png` and `cut-popup-email-scrolled-phone.png` (a 254-character email, the scroll box at its top and its end). Desktop:
`cut-hover-desktop.png` (the underlined cut names in Needs you).

## Suggestions about the cut (product decisions)

1. **Cards could show more than 10 characters (recommended: 24 on cards, 10 in rows).** On Find, New tests and Your tests the card has room for the title;
   at 10 characters most titles read "Harbor Run…" and the card's product line says even less.
2. **Buttons that carry a name ("Charge <developer> $X", "Chat with <name>") still show it in full (recommended: cut them at 10 too).** They are the longest
   labels left; with a cut name the button stays one line on a phone.
3. **Admin emails (recommended: keep them whole in the admin console).** The team copies emails often; the cut one needs a hover or a tap first.
4. **The bell's and the emails' words** still carry full names (server-built text, left for the owner's separate decision).
5. Suggestion 6 above (product names on cards) is settled by the cut: a product name on a card is now 10 characters.
