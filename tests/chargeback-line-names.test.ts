import { describe, expect, it } from "vitest";
import { chargebackOwedLine } from "@/lib/rules";

// (Owner, Nov 2) The reversed-payment line names what it paid for, with the tester's and the test's names cut at 20 characters (owner, Nov 5, §203: was 12).
describe("chargeback line names", () => {
  it("cuts long names at 20 characters with …, keeps short ones", () => {
    expect(chargebackOwedLine(1000, { name: "Marc Hanna", part: "written answers", test: "delaytestdelaytestdelay", date: "Nov 2" }))
      .toBe("Your bank reversed $10 you paid for Marc Hanna's written answers on “delaytestdelaytestde…” (Nov 2): $10 + $15 chargeback fee");
    expect(chargebackOwedLine(1000, { name: "Alexandria Montgomery", part: "recording", test: "Run", date: "Nov 2" }))
      .toBe("Your bank reversed $10 you paid for Alexandria Montgomer…'s recording on “Run” (Nov 2): $10 + $15 chargeback fee");
    expect(chargebackOwedLine(1000)).toBe("Your bank reversed a $10 payment: $10 + $15 chargeback fee");
  });
});
