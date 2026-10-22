import { describe, expect, it } from "vitest";
import * as R from "@/lib/rules";

describe("payment hold, auto-pay and Open until rules", () => {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date("2026-11-10T12:00:00Z");
  it("auto-pay pays the listing amount; extra work $0; 14 days after sending; 3 days to pay a failed charge", () => {
    expect(R.autoPayAmount(1000)).toBe(1000);
    expect(R.autoPayAmount(null)).toBe(0);
    expect(R.payByFrom(new Date("2026-11-01T00:00:00Z")).toISOString()).toBe("2026-11-15T00:00:00.000Z");
    expect(R.owedUntilFrom(new Date("2026-11-01T00:00:00Z")).toISOString()).toBe("2026-11-04T00:00:00.000Z");
  });
  it("a hold moves dates on by the length of the pause", () => {
    const start = new Date("2026-11-01T00:00:00Z"), lift = new Date("2026-11-06T00:00:00Z");
    expect(R.shiftForHold(new Date("2026-11-03T00:00:00Z"), start, lift).toISOString()).toBe("2026-11-08T00:00:00.000Z");
    expect(R.shiftForHold(null, start, lift)).toBeNull();
  });
  it("Open until can be moved only before it passes", () => {
    expect(R.checkOpenUntilChange(new Date("2026-11-12T00:00:00Z"), new Date("2026-11-20T00:00:00Z"), now, fmt).ok).toBe(true);
    expect(R.checkOpenUntilChange(new Date("2026-11-09T00:00:00Z"), new Date("2026-11-20T00:00:00Z"), now, fmt)).toEqual({ ok: false, message: "Joining closed on 2026-11-09 (Open until), so it can't be extended." });
    expect(R.checkOpenUntilChange(new Date("2026-11-09T00:00:00Z"), new Date("2026-11-09T00:00:00Z"), now, fmt).ok).toBe(true);
  });
  it("heads-up 3 days then 1 day before", () => {
    const at = (h: number) => new Date(now.getTime() + h * 3_600_000);
    expect(R.headsUpDue(at(70), now, false, false)).toBe("3d");
    expect(R.headsUpDue(at(70), now, true, false)).toBeNull();
    expect(R.headsUpDue(at(20), now, true, false)).toBe("1d");
    expect(R.headsUpDue(at(20), now, true, true)).toBeNull();
    expect(R.headsUpDue(at(100), now, false, false)).toBeNull();
    expect(R.headsUpLine("Harbor Run", new Date("2026-10-25T12:00:00Z"), () => "Oct 25")).toBe("Harbor Run closes on Oct 25: send your work before then.");
  });
  it("invite refusals use the exact wording and never reveal blocks or suspensions", () => {
    const t = { status: "open", spots: 6, testersIn: 6, openUntil: null, stoppedAt: null, paused: false };
    expect(R.inviteTestRefusal(t, now, fmt)).toBe(""); // (correction 6) inviting while full is allowed
    expect(R.inviteTestRefusal({ ...t, status: "stopped", stoppedAt: new Date("2026-10-22T10:00:00Z") }, now, fmt)).toBe("This test was stopped on 2026-10-22, so nobody can be invited.");
    expect(R.inviteTestRefusal({ ...t, testersIn: 1, openUntil: new Date("2026-10-20T00:00:00Z") }, now, fmt)).toBe("Joining closed on 2026-10-20 (Open until), so nobody can be invited.");
    expect(R.inviteTestRefusal({ ...t, testersIn: 1 }, now, fmt)).toBe("");
    const x = { suspended: false, blocked: false, deleted: false, activeTests: 0 };
    expect(R.inviteTesterRefusal("Ben Carter", { ...x, suspended: true })).toBe("Ben Carter can't be invited right now.");
    expect(R.inviteTesterRefusal("Ben Carter", { ...x, blocked: true })).toBe("Ben Carter can't be invited right now.");
    expect(R.inviteTesterRefusal("Ben Carter", { ...x, deleted: true })).toBe("Ben Carter's account was closed, so they can't be invited.");
    expect(R.inviteTesterRefusal("Cara Diaz", { ...x, activeTests: 10 })).toBe("Cara Diaz can't join more tests right now.");
    expect(R.andList(["Ana Silva", "Dee Moss"])).toBe("Ana Silva and Dee Moss");
  });
  it("a chargeback is a developer stop-once reason", () => {
    expect(R.devStopOnce([{ kind: "chargeback", text: "x", createdAt: new Date(now.getTime() + 1) }], now, false).go).toBe(false);
  });
});
