# Suspended testers: access to past payments

Suspended testers can open every session they own in a limited view, including sessions already left, blocked, stopped or ended early. Eligible disputes retain their existing payment, duplicate, rating and closing-date checks. Charge, Let it go, Rate, sending, chat and other active participation remain refused. Ownership is checked on both page and API; another tester cannot access the session through this exception.

The limited session continues polling while restricted, so payment and dispute changes update its existing view. Suspension still moves an already-open active page to the dashboard through SessionWatch; reopening an owned session shows the limited view.

Manual preparation: Second Admin reinstated DMTEst's tester side through the ordinary admin API. No automatic rejoin occurred. PRODUCT CHANGE remains left, with unpaid $3 written answers and Charge offered. Preserve that existing tab during the block/unblock/invitation/rejoin walkthrough; test Charge/Let it go before Rate rather than assuming expiry opens Rate.

Tests cover eligible dispute creation in five departure states, rejection of Charge/Rate/send/chat, ownership, and limited-session polling. No schema or payment policy change.

Validation: 18 tests passed in the new suspended-past-session suite and existing tester-state suite. Typecheck and lint passed (existing warnings). Full npm run check reproduced existing codex8-separate-sides and needs-kind-folds source assertions and was stopped; it is not green. Production build result recorded in the chat.
