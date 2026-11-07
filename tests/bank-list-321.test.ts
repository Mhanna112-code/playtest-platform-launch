import { describe, expect, it } from "vitest";
import { bankWaitingAllLine } from "@/lib/rules";

describe("(Owner, Nov 6, §321) the bank-confirm line names its first 3 payments, then 'and N more'", () => {
  const at = (d: number) => new Date(Date.UTC(2026, 10, d, 18));
  it("one, two, three and five payments", () => {
    expect(bankWaitingAllLine([{ cents: 1000, title: "Harbor Run", by: at(9) }])).toMatch(/^Your bank wants you to confirm a \$10\.00 payment on “Harbor Run” by /);
    expect(bankWaitingAllLine([{ cents: 900, title: "Sky Lab", by: at(10) }, { cents: 1000, title: "Harbor Run", by: at(9) }])).toMatch(/^Your bank wants you to confirm 2 payments \(\$19\.00 in all\): \$10\.00 on “Harbor Run” and \$9\.00 on “Sky Lab”; the first by /);
    expect(bankWaitingAllLine([{ cents: 1000, title: "A", by: at(9) }, { cents: 900, title: "B", by: at(10) }, { cents: 700, title: null, by: at(11) }])).toMatch(/: \$10\.00 on “A”, \$9\.00 on “B” and \$7\.00; the first by /);
    const five = [9, 10, 11, 12, 13].map((d, i) => ({ cents: 100 * (i + 1), title: `T${i + 1}`, by: at(d) }));
    expect(bankWaitingAllLine(five)).toMatch(/^Your bank wants you to confirm 5 payments \(\$15\.00 in all\): \$1\.00 on “T1”, \$2\.00 on “T2”, \$3\.00 on “T3” and 2 more; the first by /);
  });
});
