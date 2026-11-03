# C one combined payment during a hold: Stripe objects for rec+pddana969690@playtest.test (cus_VYjdGHK29sjrb9)

ONE PaymentIntent for $444.67 (Pay what you owe) covering Cid's and Dee's pieces

Listed through Stripe's API in test mode at 2026-11-03T07:31:09.034Z. JSON: [C2-one-payment.stripe.json](C2-one-payment.stripe.json).

| PaymentIntent | Amount | Received | Status | Description | Metadata | Charge (amount / captured / refunded) | Disputes | App rows |
|---|---|---|---|---|---|---|---|---|
| `pi_3UXcAOAwolF8enxC0yKq1x7s` | $244.67 | $244.67 | succeeded | Playtest: Ana Silva's written answers on “Harbor Run” | developerId=cmw0dal0q009c7k4895fmsr23, payKey=press:cmw0dal0q009c7k4895fmsr23:32f73680-d8ca-4fd0-b3be-a0ea2471b0d2, testerId=cmw0dalo3009j7k48op4o4ygx | `ch_3UXcAOAwolF8enxC0WADaiia` $244.67 / $244.67 / $0.00 | none | review charged $244.67 |
| `pi_3UXcAPAwolF8enxC3bjRGjbO` | $244.67 | $244.67 | succeeded | Playtest: Ben Okafor's written answers on “Harbor Run” | developerId=cmw0dal0q009c7k4895fmsr23, payKey=press:cmw0dal0q009c7k4895fmsr23:e002e2ff-bbd5-4d74-b35e-0e45f050822b, testerId=cmw0dalzu009v7k486n900c9e | `ch_3UXcAPAwolF8enxC3NLgGHTB` $244.67 / $244.67 / $0.00 | none | review charged $244.67 |
| `pi_3UXcAtAwolF8enxC41AgK19a` | $244.67 | $0.00 | canceled | Playtest: Cid Moreau's written answers on “Harbor Run”, charged by Cid Moreau after 7 days without a review | developerId=cmw0dal0q009c7k4895fmsr23, payKey=choice:cmw0db5pa00c37k48v6ahqwra, testerId=cmw0damea00a77k48aad11vjh | none | none |  |
| `pi_3UXcBDAwolF8enxC07pdqlgP` | $444.67 | $444.67 | succeeded | Playtest: What you owe (Cid Moreau's written answers on “Harbor Run” $244.67, Dee Lin's written answers on “Harbor Run” $200.00) | developerId=cmw0dal0q009c7k4895fmsr23, payKey=owedall:cmw0dc97x00e37k482ve788w7 | `ch_3UXcBDAwolF8enxC0rLzn9De` $444.67 / $444.67 / $0.00 | none | review charged $244.67; review charged $200.00; owed bundled $444.67 |
