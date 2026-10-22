import { describe, expect, it } from "vitest";
import {
  callCharge, canCancelCall, canDispute, changedTerms, checkCallLength, checkDisputeDecision, checkListing, checkPayAmount,
  contractSnapshot, editCheck, joinCheck, mergeEdit, splitFee, stopOnce, stopOnceChanges, termsLine, type Listing,
} from "@/lib/rules";

const listing = (over: Partial<Listing> = {}): Listing => ({
  title: "Harbor Run", description: "A boat game", buildUrl: "https://example.com/build", category: "Action",
  devices: ["Windows PC"], languages: ["English"], spots: 5, writtenCents: 1000, recordingCents: 1500,
  liveRateCents: 3000, liveMinutes: 30, deadlineDays: 7, questions: ["What did you like?"], ...over,
});
const at = (min: number) => new Date(Date.UTC(2026, 10, 5, 15, min));
const ev = (kind: string, min: number, text = kind, version?: number) => ({ kind, text, createdAt: at(min), version });

describe("platform fee", () => {
  it("tester gets 80%, platform keeps 20%", () => {
    expect(splitFee(2000)).toEqual({ amountCents: 2000, feeCents: 400, testerCents: 1600 });
    expect(splitFee(0)).toEqual({ amountCents: 0, feeCents: 0, testerCents: 0 });
  });
  it("odd cents: parts always add up to the charge", () => {
    for (const a of [1, 3, 99, 333, 1001, 12345]) {
      const s = splitFee(a);
      expect(s.feeCents + s.testerCents).toBe(a);
    }
  });
});

describe("pay amount at review", () => {
  it("full price needs no reason", () => expect(checkPayAmount(1000, 1000, "")).toEqual({ ok: true }));
  it("anything from $0 to the agreed price with a reason", () => {
    expect(checkPayAmount(0, 1000, "Didn't answer the questions").ok).toBe(true);
    expect(checkPayAmount(500, 1000, "Half the answers").ok).toBe(true);
  });
  it("less than full requires a reason", () => {
    expect(checkPayAmount(500, 1000, "")).toMatchObject({ ok: false, message: expect.stringContaining("Say why") });
    expect(checkPayAmount(0, 1000, "  ")).toMatchObject({ ok: false });
  });
  it("never more than agreed, never negative or fractional cents", () => {
    expect(checkPayAmount(1001, 1000, "")).toMatchObject({ ok: false, message: "You can pay at most the agreed $10.00." });
    expect(checkPayAmount(-1, 1000, "reason here").ok).toBe(false);
    expect(checkPayAmount(1.5, 1000, "reason here").ok).toBe(false);
    expect(checkPayAmount(null, 1000, "reason here").ok).toBe(false);
  });
  it("a non-zero amount is at least the smallest card charge", () => {
    expect(checkPayAmount(30, 1000, "reason here").ok).toBe(false);
    expect(checkPayAmount(50, 1000, "reason here").ok).toBe(true);
  });
  it("a free part can only be paid $0", () => {
    expect(checkPayAmount(0, 0, "").ok).toBe(true);
    expect(checkPayAmount(100, 0, "").ok).toBe(false);
  });
});

describe("disputes", () => {
  it("once, only when paid less than agreed", () => {
    expect(canDispute(500, 1000, false).ok).toBe(true);
    expect(canDispute(1000, 1000, false).ok).toBe(false);
    expect(canDispute(500, 1000, true)).toMatchObject({ ok: false, message: expect.stringContaining("once") });
  });
  it("an admin can only raise pay, up to the agreed price", () => {
    expect(checkDisputeDecision(400, 500, 1000).ok).toBe(false);
    expect(checkDisputeDecision(1100, 500, 1000).ok).toBe(false);
    expect(checkDisputeDecision(1000, 500, 1000)).toEqual({ ok: true, extraCents: 500 });
    expect(checkDisputeDecision(500, 500, 1000)).toEqual({ ok: true, extraCents: 0 });
    expect(checkDisputeDecision(520, 500, 1000).ok).toBe(false); // $0.20 extra is under the smallest charge
  });
});

describe("live calls", () => {
  it("charge = rate × length, rounded to the cent", () => {
    expect(callCharge(3000, 30)).toBe(1500);
    expect(callCharge(3000, 20)).toBe(1000);
    expect(callCharge(1000, 7)).toBe(117); // 116.67
    expect(callCharge(0, 30)).toBe(0);
  });
  it("a tiny charge is raised to the smallest card charge", () => expect(callCharge(1000, 1)).toBe(50));
  it("length: 1 minute to 3× booked; shorter than booked needs a reason", () => {
    expect(checkCallLength(30, 30, "").ok).toBe(true);
    expect(checkCallLength(90, 30, "").ok).toBe(true);
    expect(checkCallLength(91, 30, "").ok).toBe(false);
    expect(checkCallLength(20, 30, "").ok).toBe(false);
    expect(checkCallLength(20, 30, "Started late").ok).toBe(true);
    expect(checkCallLength(0, 30, "Nobody came").ok).toBe(false);
  });
  it("cancel only 24 hours or more ahead", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    expect(canCancelCall(new Date("2026-11-06T12:00:00Z"), now).ok).toBe(true);
    expect(canCancelCall(new Date("2026-11-06T11:59:00Z"), now)).toMatchObject({ ok: false, message: "Calls can only be cancelled 24 hours or more ahead." });
  });
});

describe("listing checks", () => {
  it("a good listing passes", () => expect(checkListing(listing())).toEqual([]));
  it("prices: $1 minimum per part, $10/h for calls, or free", () => {
    expect(checkListing(listing({ writtenCents: 50 }))[0]).toContain("at least $1.00");
    expect(checkListing(listing({ writtenCents: 0 }))).toEqual([]);
    expect(checkListing(listing({ liveRateCents: 900 }))[0]).toContain("$10.00 an hour");
    expect(checkListing(listing({ writtenCents: null, recordingCents: null, liveRateCents: null }))).toContain("Choose at least one kind of feedback.");
  });
  it("spots can't go below the testers already in", () => {
    expect(checkListing(listing({ spots: 2 }), 3)).toContain("Spots can't go below the 3 testers already in.");
    expect(checkListing(listing({ spots: 3 }), 3)).toEqual([]);
  });
  it("written answers need a question", () => expect(checkListing(listing({ questions: [] }))).toContain("Add at least one question for the written answers."));
});

describe("contract snapshot at join", () => {
  it("copies every term and counts the deadline from the join", () => {
    const joined = new Date("2026-11-01T10:00:00Z");
    const c = contractSnapshot({ ...listing(), listingVersion: 3 }, joined, true);
    expect(c).toMatchObject({ listingVersion: 3, writtenCents: 1000, recordingCents: 1500, liveRateCents: 3000, liveMinutes: 30, deadlineDays: 7, keepPrivate: true });
    expect(c.dueAt.toISOString()).toBe("2026-11-08T10:00:00.000Z");
  });
  it("is a copy: changing the listing afterwards doesn't change it", () => {
    const l = { ...listing(), listingVersion: 1 };
    const c = contractSnapshot(l, new Date(), false);
    l.questions.push("New question");
    l.writtenCents = 5000;
    expect(c.questions).toEqual(["What did you like?"]);
    expect(c.writtenCents).toBe(1000);
  });
  it("terms line", () => expect(termsLine(listing())).toBe("Written $10.00 · Recording $15.00 · Live call $30.00/h (30 min) · 7 days"));
});

describe("stop once (top panel)", () => {
  const seen = at(10);
  const events = [
    ev("joined", 5, "old join"), // before the page loaded
    ev("sent", 12, "Ana Silva sent her written answers"),
    ev("edited", 13, "You edited the listing"), // not a stop-once kind
    ev("left", 14, "Ben Carter left the test"),
    ev("joined", 15, "Cara Diaz joined"),
    ev("booked", 16, "Ana Silva booked a call for Thu, Nov 5, 3:00 PM"),
    ev("cancelled", 17, "Ben Carter cancelled their call"),
  ];
  it("lists exactly what testers did since the page loaded, oldest first", () => {
    expect(stopOnceChanges(events, seen).map((e) => e.text)).toEqual([
      "Ana Silva sent her written answers", "Ben Carter left the test", "Cara Diaz joined",
      "Ana Silva booked a call for Thu, Nov 5, 3:00 PM", "Ben Carter cancelled their call",
    ]);
  });
  it("each trigger alone stops the first press: left, joined, sent, booked, cancelled", () => {
    for (const k of ["left", "joined", "sent", "booked", "cancelled"]) expect(stopOnce([ev(k, 11)], seen, false).go).toBe(false);
  });
  it("other changes don't stop", () => expect(stopOnce([ev("edited", 11), ev("stopped", 12)], seen, false)).toEqual({ go: true }));
  it("nothing new: goes ahead at once", () => expect(stopOnce([ev("joined", 5)], seen, false)).toEqual({ go: true }));
  it("the second press goes ahead", () => expect(stopOnce(events, seen, true)).toEqual({ go: true }));
});

describe("Edit version check", () => {
  const events = [ev("joined", 1, "Ana joined (a spot was used)", 2), ev("edited", 2, "The listing was edited in another tab", 3), ev("sent", 3, "Ana sent", undefined)];
  it("same version saves at once", () => expect(editCheck(3, 3, events, false)).toEqual({ go: true }));
  it("a newer version stops once and lists the changes since the loaded version", () => {
    const r = editCheck(1, 3, events, false);
    expect(r.go).toBe(false);
    if (!r.go) expect(r.changes.map((c) => c.text)).toEqual(["Ana joined (a spot was used)", "The listing was edited in another tab"]);
    const r2 = editCheck(2, 3, events, false);
    if (!r2.go) expect(r2.changes.map((c) => c.text)).toEqual(["The listing was edited in another tab"]);
  });
  it("the second press saves", () => expect(editCheck(1, 3, events, true)).toEqual({ go: true }));
  it("typed values go on top; untouched fields take the newer values", () => {
    const newer = listing({ title: "Harbor Run 2", spots: 8, writtenCents: 1200 });
    const merged = mergeEdit(newer, { writtenCents: 900 });
    expect(merged).toMatchObject({ title: "Harbor Run 2", spots: 8, writtenCents: 900 });
  });
  it("only term changes count for the listing version", () => {
    expect(changedTerms(listing(), listing({ spots: 9 }))).toEqual([]);
    expect(changedTerms(listing(), listing({ writtenCents: 900, questions: ["Q2"] }))).toEqual(["writtenCents", "questions"]);
  });
});

describe("join check", () => {
  const open = { status: "open", listingVersion: 2, spots: 3, testersIn: 1 };
  it("same listing: joins", () => expect(joinCheck(open, 2, false)).toEqual({ result: "go" }));
  it("changed listing: stops once, second press joins on the new terms", () => {
    expect(joinCheck(open, 1, false)).toEqual({ result: "changed" });
    expect(joinCheck(open, 1, true)).toEqual({ result: "go" });
  });
  it("closed, stopped or full refuses for good, even when confirmed", () => {
    expect(joinCheck({ ...open, status: "stopped" }, 2, true)).toEqual({ result: "refused", message: "This test was stopped." });
    expect(joinCheck({ ...open, status: "closed" }, 2, true).result).toBe("refused");
    expect(joinCheck({ ...open, testersIn: 3 }, 2, true)).toEqual({ result: "refused", message: "This test is full." });
  });
});
