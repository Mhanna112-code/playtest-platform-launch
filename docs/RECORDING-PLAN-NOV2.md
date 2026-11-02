# Recording round after the Nov 2 merges (owner-approved)

Run AFTER task 29 (codex/one-card-checks, merged with task 25 + whole-amount chargeback fix), fix/nov2-a (items 1, 5, 16) and
fix/nov2-b (items 15, 17) are merged, the full check passes and master is pushed. Use throwaway accounts on a separate media
server (not the owner's 3400). Show the Stripe side (test mode dashboard / API state of each PaymentIntent) where money moves.

1. Money (owner's plan): confirms waiting on a couple of tests while the developer is suspended -> one becomes a payment owed ->
   a chargeback on the payment owed (opened while the owner-style press of Pay what you owe is in flight) -> a chargeback on the
   one Pay what you owe payment after it goes through (whole amount back once + one fee) -> several other confirms cleared by a
   brand-new card (each old check CANCELLED at Stripe, retried on the new card). Check every box and tester tag at each step.
2. Double-charge cases, each showing one charge at Stripe: Pay what you owe pressed in two tabs at once; Confirm in one tab while
   saving a new card in another; approving a check at the moment its 3 days run out (cancel vs approve: one wins, recorded once);
   a daily retry while a check is open; a chargeback on the one-total payment covering several debts.
3. A test running to its end: two testers, the last deadline passes, work ends (no Send, calls, Leave); Charge / Let it go, Pay and
   Rate still work inside their windows; then each refused for its reason (window closed / Pay closed / Rating closed / work over),
   showing the refusal lines (no flashing, no floating).
4. Stop rules: a terms change stops the tester's Rate once; an answered change doesn't stop a later press; an update the page already
   showed (pill / redraw) doesn't stop; and a change made between two 20-second checks (before the pill appears) DOES stop once —
   showing why a press can still be stopped despite the pill rule.
5. Quick screenshots: restricted dashboard boxes, attachment shown once, character counters, Invite rows updating on the beat,
   Switch / Keep gone after rating, a waiting call in the tester's Waiting box, admin Your actions jumping on the same page.
One summary report (artifact) with the clips, per the owner's evidence rule.
6. (Owner) "Why double pay isn't possible in any case": for EVERY way money can be taken on one thing (Pay, Pay more, Confirm with your
   bank, Pay what you owe press, daily retry, new-card retry, a tester's Charge, the team's Decide, auto-charged calls, the chargeback
   steps, charges waiting for a lift), show the guard that stops a second charge (the one-step claim, the lock on a waiting debt, the
   cancel-at-Stripe-first with "already paid" recorded, the idempotency key, the piece lock during a bank check, Pay closed / already
   paid refusals) and a clip or test proving it: two attempts at the same moment -> one charge at Stripe. Present it as one table in
   the report: path | what could double it | the guard | proof.
