# Batch 13: excerpt requests (owner, Oct 29)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 12. For reference only, see the full app's version (C:/Users/march/Projects/playtest-platform/src/lib/services.ts: `sampleChoices`, `proposeSample`, `decideSample`, `removeSample`, `MAX_SAMPLES`; and the tester claim page around "Pick one excerpt"). Follow THESE rules.

## 1. What it is
A tester can ask to show a short excerpt of their work on their public profile. The developer of that test allows or denies it.
- Only from written answers the developer **paid** for (any amount above $0), never from a test with an NDA.
- The tester picks one answer and can trim it. It's shown as a plain quote: 10 to 500 characters, with formatting stripped.
- "Don't name the product" is ticked by default. Unticked, the quote shows the product's name.
- At most 3 excerpts shown or pending per tester. A 4th is refused: "You can show at most 3 excerpts. Remove one first."
- One pending request per part.

## 2. Where it shows
- **Tester:** an "Show an excerpt on your profile" button on each eligible paid part (session page), opening the picker. Their profile and Settings list their excerpts (pending, shown, denied), with Remove.
- **Developer:** an "Excerpt request" item in the test's Needs you, with the quote, whether the product is named, and **Allow** and **Deny**. Once decided, it leaves Needs you.
- **The tester gets the decision as a bell line only:**
  - "Your excerpt from <test> is now on your profile."
  - "<dev> prefers that work from <test> isn't shown on profiles."
- **Shown excerpts** appear on the tester's profile and on their hover card (up to 3).
- **Either side can take a shown excerpt down at any time:** the tester from their profile, the developer from the tester's row on the test page. Bell to the other side: "<name> took down the excerpt from <test>."

## 3. Excerpt requests never stop and are never blocked
- Allow, Deny, Remove and the request itself **ignore stop-once**: no blue "since you opened this page" notice. They go through whatever changed. Only a request that no longer exists is refused ("This request was already decided." / "This excerpt was already taken down.").
- **Blocks don't affect them.** A block in either direction doesn't cancel pending requests or hide shown excerpts, and the developer can still decide.
- **Suspensions and holds don't affect them:**
  - Pending requests stay up.
  - A restricted developer gets an "Excerpt requests" box at their dashboard top, under the blue box, with Allow and Deny, because test pages are closed to them.
  - A suspended tester's pending requests stay up and can be decided.
  - A suspended tester can't make NEW requests, because their session pages are closed. They can still Remove from Settings.
- **Stopping or closing a test doesn't close requests.**
- **Deleting an account closes its pending requests:**
  - A tester deleting: their requests and shown excerpts are removed.
  - A developer deleting: pending requests on their tests close ("<test>'s developer deleted their account, so this request was closed"). Excerpts already shown stay.

## 4. Rate and suspensions (confirming what's built)
A suspended person's Rate press is refused and routes them to the dashboard top, and Rate stays hidden while their pages are closed. When the suspension lifts, Rate is back (it has no end date). No change is needed; add a test if one is missing.

## 5. The NDA field, matching the full app
On Post a test and Edit, the NDA gets its own card, as in the full app (C:/Users/march/Projects/playtest-platform/src/app/dev/test-form.tsx, around line 336):
- Heading with the ShieldCheck icon: "Keep it confidential? (NDA, optional)".
- Three bullets:
  - "An NDA stops testers sharing your build or what they saw. They must accept it before joining."
  - "With or without one, **you can always use the feedback you receive** to improve your product."
  - "Testers can never show work from a test under an NDA as excerpts on their profile; without one, they can only with your permission."
- The text box: "Leave blank for no NDA. If filled, testers must accept it before joining."
- Keep lean's existing behaviour: the 3-change limit with "Changes left", and the Switch/Keep offer when it changes.

## 6. Excerpts and an NDA added later
The rule follows the test's CURRENT NDA. While the test has one:
- Testers' "Show an excerpt" buttons are hidden. A press from a page loaded before the NDA was added is refused with a blue notice under the button: "This test now has an NDA, so its work can't be shown as an excerpt." (This is a refusal, not a stop-once.)
- Pending requests are hidden from Needs you and the dashboard box. A developer's Allow from an older page is refused the same way ("…can't be allowed"). Deny still works.
- Excerpts already shown from that test are hidden from profiles and hover cards.
- Requests and excerpts are kept, not deleted. If the NDA is removed later, pending requests come back to Needs you and shown excerpts reappear.
- The tester's profile list marks them "Hidden while <test> has an NDA".

## 7. The Recording part: up to 5 recordings, sent together (owner, Oct 29)
This overrides batch 11 §7 and the old "5 per session" for the Recording part.
- A tester can add up to **5 recordings** (unchanged) to the Recording part, uploaded or recorded on the page (batch 11's Record button), 500 MB each.
- Before sending, each one shows a preview, its length and size, and **Remove** (with a confirm). Removing one frees its slot. The 6th add is refused: "You can add at most 5 recordings. Remove one first."
- **Send** sends all of them together as ONE piece of work. The developer reviews and pays them as one Recording part, with one Pay box, and sees each recording playable in that piece's scroll box.
- As today, until the developer pays (or rejects), the tester can still remove or add recordings and send again; the developer sees "sent or updated work" as a change. Once paid, nothing can change.
- The limit stays `MAX_RECORDINGS = 5` for the Recording part. Videos attached to written parts now count separately, not toward these 5.
- Recordings attached to written parts (batch 11 §7) are separate and keep that section's limits.
- A Send pressed from another tab while one recording is still uploading is refused with: "A recording is still uploading. Send once it's done."

## 8. Changed questions: previous sets of questions and answers (owner, Oct 29; keep it simple)
Today `Submission.answers` is a plain list of strings, and the developer's views pair it with the contract's CURRENT questions, so answers sent before a switch show under the wrong questions. Replace that with whole SETS:
- **Store each set.** A sent or drafted written part stores its questions with its answers: `[{ question, required, answer }]`. Migrate existing rows by pairing them with the contract's questions.
- **When a tester switches to terms with changed questions** (even if only one of three changed):
  - The **whole earlier set** (every question, changed or not, with the answer it had, sent or draft) is kept as a previous set: "Previous questions and answers (until <date>)".
  - The **form above the Send button** shows the **current** questions only. Answers to questions whose text is unchanged are carried over and stay filled in, including unsent draft text. Changed or new questions start empty.
  - At most 3 previous sets, because questions have 3 changes.
- **Tester's session page:** under the written form, a fold per previous set, newest first, read-only, showing all its questions and answers.
- **Developer:**
  - The tester's written part shows what was last SENT, under the questions it answered.
  - If that was an earlier set, it's labelled "Sent for the questions until <date>", and it's reviewed and paid at the price it was sent at.
  - Earlier sent sets are in a "Previous questions and answers" fold in that tester's row.
  - By question groups answers by exact question text.
- **Sending** sends the current set and replaces the sent version, until paid. Once paid, nothing changes.
- **Media/report example to support:** a test with 3 questions. The tester types a draft answer to Q1. The developer changes only Q2. The tester switches. Q1's draft is still filled in, Q2 is the new question and empty, Q3 is unchanged. The previous set shows all of Q1–Q3 with what they had.

## 9. Long text, handled the same way everywhere (owner, Oct 29)
"What should testers do?" (the steps) and the questions stay **separate fields**, each with its own 3-change count.

Limits:
- Steps: 1,000 characters (unchanged).
- NDA: **1,000 characters** (owner, Oct 29; was 20,000). `LIMITS.nda = 1000`. Existing longer NDAs stay as they are, but an Edit Save that changes the NDA must fit 1,000.
- Questions: 1 to 20 (unchanged), and **NEW: at most 300 characters per question** (DEFAULT). Live counters on every field: "N / 1,000" (steps and NDA), "N / 300" (each question).

Display, one rule per kind of text:
- **The NDA, wherever it's shown, sits in a scroll box about 12 lines tall:** the join page (already), the session page's terms, the Switch/Keep offer box at the top, Terms history "NDA then and now", and the developer's Post and Edit preview. The offer box and Terms history show "Before" and "Offered" as two such boxes, never in full.
- **The steps:** in full on the listing, the join page and the session page (1,000 characters fits). On cards and rows, 3 lines then "Show more".
- **Questions:** in full in the answer form and in the previous sets. In the offer box and "Questions then and now", a list showing 3 then "+N more".
- **Written answers:** batch 10's scroll box for each piece.
- **Reasons, notes and messages in rows:** 3 lines then "Show more" (ClampText), as today.
- **Names and titles in rows:** cut with "…", with the full text on hover, as today.

## Check and report
- A migration is needed (the Excerpt table). Write it by hand and check it with the `prisma migrate diff ... --exit-code` command from BATCH-10. A stale Prisma client is then the only acceptable failure.
- Tests for every item. Run `NEXT_DIST_DIR=.next-build npm run check`.
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed and any interpretations.
