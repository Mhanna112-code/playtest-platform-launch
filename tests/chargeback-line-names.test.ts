import { describe, expect, it } from "vitest";
import { chargebackOwedLine } from "@/lib/rules";

// (Owner, Nov 2) The reversed-payment line names what it paid for, with the tester's and the test's names cut at 12 characters.
describe("chargeback line names", () => {
  it("cuts long names at 12 characters with …, keeps short ones", () => {
    expect(chargebackOwedLine(1000, { name: "Marc Hanna", part: "written answers", test: "delaytestdelaytest", date: "Nov 2" }))
      .toBe("Your bank reversed $10 you paid for Marc Hanna's written answers on “delaytestdel…” (Nov 2): $10 + $15 chargeback fee");
    expect(chargebackOwedLine(1000, { name: "Alexandria Montgomery", part: "recording", test: "Run", date: "Nov 2" }))
      .toBe("Your bank reversed $10 you paid for Alexandria M…'s recording on “Run” (Nov 2): $10 + $15 chargeback fee");
    expect(chargebackOwedLine(1000)).toBe("Your bank reversed a $10 payment: $10 + $15 chargeback fee");
  });
});
