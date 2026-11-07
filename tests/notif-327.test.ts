import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { renderTimes } from "@/lib/tz";
import { autoChargeCalls, closingSoonLine } from "@/lib/server/holds";
import { paidRows } from "@/lib/server/paymentRows";
import { partPaymentLines } from "@/lib/server/partPayments";
import { bookCall, joined, setup } from "./fixtures";

// (Owner, Nov 7, §327) Every payment row that names a call names it by its date and time ("bb's live call on “…” (Fri, Oct 30, 12:17 AM)"): the single
// (ungrouped) row in What you've paid and the test page's Payments (N) lacked it, and so did the tester's own row, the Charge receipt and Closing soon.

const DAY = 86_400_000;
const DT = /\((Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)( [A-Z]+)?\)/;

describe("§327 a call's payment rows name its date and time", () => {
  it("an automatically charged call: the developer's row, the test page's Payments (N) and the tester's row", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Nina Park");
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie);
    const start = new Date(Date.now() - 8 * DAY);
    await db.call.update({ where: { id: call.id }, data: { startsAt: start, measuredMinutes: 30, measuredAt: new Date(start.getTime() + 30 * 60_000), payBy: new Date(Date.now() - 60_000) } });
    await autoChargeCalls(new Date());
    const ps = await db.payment.findMany({ where: { callId: call.id } });
    expect(ps).toHaveLength(1);
    const dev = (await paidRows(ps, "developer")).get(ps[0].id)!;
    expect(renderTimes(dev.what, "UTC")).toMatch(new RegExp(`^Nina Park's live call on “Harbor Run” ${DT.source}$`));
    expect(renderTimes(dev.full, "UTC")).toMatch(DT);
    const part = [...(await partPaymentLines(ps, (d) => d.toISOString())).values()].flat();
    expect(renderTimes(part[0].what, "UTC")).toMatch(DT);
    const tester = (await paidRows(ps, "tester")).get(ps[0].id)!;
    expect(renderTimes(tester.what, "UTC")).toMatch(new RegExp(`^from .+ for your live call on “Harbor Run” ${DT.source}$`));
  });

  it("Closing soon names a call by its date and time", () => {
    const at = new Date("2026-11-18T15:00:00Z");
    expect(renderTimes(closingSoonLine([{ who: "Ana", part: "call", title: "Harbor Run", at, when: "⟦t:2026-10-30T05:17:00.000Z:datetime⟧" }]), "UTC")).toMatch(/^Closing soon: Ana's call on “Harbor Run” \(Fri, Oct 30, 5:17 AM( UTC)?\) closes on Nov 18$/);
  });
});
