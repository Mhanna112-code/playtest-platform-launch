# C one combined payment during a hold: Stripe objects for rec+pddana969690@playtest.test (cus_VYjdGHK29sjrb9)

Cid's charge waited for the bank and was cancelled when its 3 days ran out; nothing was taken

Listed through Stripe's API in test mode at 2026-11-03T07:30:43.038Z. JSON: [C1-hold-owed.stripe.json](C1-hold-owed.stripe.json).

| PaymentIntent | Amount | Received | Status | Description | Metadata | Charge (amount / captured / refunded) | Disputes | App rows |
|---|---|---|---|---|---|---|---|---|
| `pi_3UXcAOAwolF8enxC0yKq1x7s` | $244.67 | $244.67 | succeeded | Playtest: Ana Silva's written answers on “Harbor Run” | developerId=cmw0dal0q009c7k4895fmsr23, payKey=press:cmw0dal0q009c7k4895fmsr23:32f73680-d8ca-4fd0-b3be-a0ea2471b0d2, testerId=cmw0dalo3009j7k48op4o4ygx | `ch_3UXcAOAwolF8enxC0WADaiia` $244.67 / $244.67 / $0.00 | none | review charged $244.67 |
| `pi_3UXcAPAwolF8enxC3bjRGjbO` | $244.67 | $244.67 | succeeded | Playtest: Ben Okafor's written answers on “Harbor Run” | developerId=cmw0dal0q009c7k4895fmsr23, payKey=press:cmw0dal0q009c7k4895fmsr23:e002e2ff-bbd5-4d74-b35e-0e45f050822b, testerId=cmw0dalzu009v7k486n900c9e | `ch_3UXcAPAwolF8enxC3NLgGHTB` $244.67 / $244.67 / $0.00 | none | review charged $244.67 |
| `pi_3UXcAtAwolF8enxC41AgK19a` | $244.67 | $0.00 | canceled | Playtest: Cid Moreau's written answers on “Harbor Run”, charged by Cid Moreau after 7 days without a review | developerId=cmw0dal0q009c7k4895fmsr23, payKey=choice:cmw0db5pa00c37k48v6ahqwra, testerId=cmw0damea00a77k48aad11vjh | none | none | review failed $244.67 |
