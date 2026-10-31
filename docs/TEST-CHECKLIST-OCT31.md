# What to test (Oct 31 changes and the ones landing after)

Local site: http://localhost:3400. Admin: owner@example.com. Demo accounts for the admin console: demo+na4bk-1 … -17@playtest.test
(testers 1–5, developers 6–17), same password as the admin accounts. Two windows side by side make most of these easy.

## A. Drafts (batch 35 §8, §10, §11, §16, §18, §23, §39, §58, §64)
1. Edit: type in a few fields and change a price; reload → top line "Started from your unsent draft (time) · Use saved for all", each changed field "Draft · Use saved". Press Use saved on one field, then Use saved for all.
2. Post a test (new): type, close the tab, open Post again → "· Start empty", each field "Draft · Discard". Start empty clears everything.
3. Pay / Pay more: type an amount and note, reload → "Draft · Discard"; Discard puts the amount back and empties the note; the tick is needed again.
4. Tester: written answers (per-answer Draft, "Discard all" if never sent / "Use saved" if sent), dispute reason, rating comment, chat, call request, Apply note, profile edit → each comes back as Draft after a reload.
5. Admin: Decide (total + note), Suspend / Pause / Stop / Extend / close-out reasons → Draft after a reload.
6. Three tabs on one session typing different answers; sign out in one; sign back in → every tab shows the LAST typed.
7. Type in tab B (Edit), visit untouched tab A, open a new Edit → it shows B's typing (fix landing in the next push).
8. While a press is going or just finished, the Draft buttons (Use saved / Discard / Start empty) are greyed.
9. On an old Edit tab you didn't type in, another tab's Save changes those fields silently (no note); a field you did change shows the blue note with "Use theirs".

## B. Listing changes and live updates (§14, §15, §29, §34, §37, §53, §55)
1. Developer: save in another tab → ONE line "You saved the listing in another tab · See it"; See it scrolls to the Listing panel and marks the fields, and stays there (fix landing next).
2. Tester join page: the developer edits → top box "Nora Lane edited the listing · See it"; no live list by the Join button; Join pressed with the top box off screen stops once (stop box by the button); with the top box in view it goes through.
3. Update UI vs blue pill: with two windows, scroll the old one down to the rows; when the other saves, the rows/panel change and the "1 new update ↑" pill appear in the same moment (within the 20-second beat).
4. Listing panels (developer, join page, "Your agreed scope", Switch/Keep offer): small grey labels above brighter values; numbered questions with a Required tag; Updated tags open Before / Now.
5. No field lists anywhere (no "changed the terms: written $…, removed …" line); consequences keep their own lines (application closed, NDA again).

## C. Forms and mistakes (§19, §25, §27, §28, §30, §31, §57, §12, §13, §24, §52)
1. Money boxes (prices, Pay, Pay more, Decide, Charge) take only digits and one point; paste "$1,000.50" → "1000.50". Count boxes take digits only.
2. Tick Free on an empty red price/rate → the red line goes at once.
3. Link box without https:// → red at the box.
4. Open until: box, hint and red line agree (your time zone).
5. Every mistake sits under one heading above the button; fixing one (e.g. ticking the NDA) removes it at once; no empty bullets.
6. Questions box: a 21st line is ignored; the same question twice is red; with Written report OFF none of the question checks run.
7. One chip style: categories, languages, devices (Post/Edit, profile, Find, Invite filters) are round pills, green when ticked.
8. "Prices can include cents, like 9.99."

## D. After a press (§40, §41, §42, §60)
1. Send a recording / upload / Pay / Send answers: the page stays where you were (no jump to "Your parts").
2. Pay more: greyed button, inputs hidden, "Paid $X more to …" until the refresh, then an empty Pay more.
3. Same finished state on dispute, Rate, Accept/Decline, Invite, Charge, call requests, admin buttons ("Done.").
4. A new screen recording: drag the time bar while playing and paused → it seeks.
5. A refusal line under a button goes away when the page updates (e.g. after leaving / the test ending) (landing next).

## E. Stops and other tabs (§2, §5 Task 5, §12, §44, §45, §47, §48, §51, §59, §61)
1. Invite / Accept / Decline: stop once only when a tester's needs flip (all ↔ none), a rating moves a full star, or a first rating ("fbbb got their first rating: 1.0"); a bio edit doesn't stop. The box names the press ("Your Accept didn't go through").
2. Tester needs pop-up: opens only when a kind (devices / languages) is missing entirely; "You updated your profile in another tab (time)" / "<Dev> changed what this test needs (time)"; the button names your press ("Ask to rejoin anyway").
3. Withdraw after the developer accepted / declined → the line names it.
4. Admin, your own action in another tab: Delete account after your Suspend stops once ("You suspended … in another tab"); a press no longer possible: "You already paused this test in another tab". A page that redrew after your change goes straight through.
5. Leave: stops once for contract changes the page hasn't shown (like the other tester buttons), respects Alerts; second press leaves (landing next).
6. Tester with Alerts OFF: your own action in another tab still stops a press once; the Alerts line says "…and what you did in another tab" (landing next).

## F. Admin console (§35, §36, §43, §49, §63) — use the demo data
1. Every section has items: try Approve / Don't approve (chargebacks), Decide (keep the amount; a raise is declined with the demo cards), Reinstate, Lift / Extend / Close now, Mark replied, Approve lifts, outages (approving moves every local timer).
2. Reason boxes full width; long reasons in a small quoted box; no Developer / Tester ticks on those pages.
3. Timeline: a Pause then a Stop seconds later each quote their own reason.
4. Alerts menu (developer, on a stopped test): every kind listed, the ones that can't happen greyed.

## G. Other
1. Invite "Find testers" search rows update with the page (no lag).
2. Paid-piece links from emails/bell land on the right line.
3. Same tester deadline on the developer's Listing panel and the join page ("N days from joining").
4. Developer tester rows show only the terms line.
5. "Pays on average" only on the developer's own dashboard.
6. Edit's 3-change count starts only when the first tester joins (landing next): invite + saves → still "3 of 3"; after a join, the next save counts.
7. Back button and paying twice (your own earlier list).
