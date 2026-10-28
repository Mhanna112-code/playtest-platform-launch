import { describe, expect, it } from "vitest";
import {
  callCharge, canCancelCall, canDispute, changedTerms, checkDisputeDecision, checkListing, checkPay, isLate, lateLabel, listingAmount,
  CALL_KINDS, checkReject, contractSnapshot, devStopOnce, editCheck, endedLine, testerRefusal, joinCheck, mergeEdit, splitFee, stopOnce, stopOnceChanges, termsLine, type Listing,
} from "@/lib/rules";

const listing = (over: Partial<Listing> = {}): Listing => ({
  productName: "Harbor Run", mature: false, matureWhy: "", ndaText: "", title: "Harbor Run", description: "A boat game", buildUrl: "https://example.com/build", categories: ["Game"],
  devices: ["Windows PC"], languages: ["English"], spots: 5, writtenCents: 1000, recordingCents: 1500,
  liveRateCents: 3000, liveMinutes: 30, deadlineDays: 7, questions: ["What did you like?"], openUntil: new Date(Date.now() + 12 * 86_400_000).toISOString(), joinMode: "anyone", ...over,
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

describe("the one Pay box", () => {
  it("the listing amount with the tick: no reason needed", () => expect(checkPay(1000, 1000, "", 1000)).toEqual({ ok: true }));
  it("any amount from $0 up, even above the listing", () => {
    expect(checkPay(0, 1000, "Didn't answer the questions", 0).ok).toBe(true);
    expect(checkPay(1500, 1000, "", 1500).ok).toBe(true);
  });
  it("below the listing amount needs a reason", () => {
    expect(checkPay(500, 1000, "", 500)).toMatchObject({ ok: false, message: expect.stringContaining("Say why") });
    expect(checkPay(500, 1000, "Half the answers", 500).ok).toBe(true);
  });
  it("extra work (not in the listing): any amount, no reason", () => {
    expect(checkPay(0, null, "", 0).ok).toBe(true);
    expect(checkPay(700, null, "", 700).ok).toBe(true);
  });
  it("(batch 9) the tick must name exactly the amount", () => {
    expect(checkPay(1000, 1000, "", null)).toMatchObject({ ok: false, message: "Tick “I understand this payment of $10.00 can't be refunded and is charged now.” to pay." });
    expect(checkPay(1000, 1000, "", 900).ok).toBe(false);
  });
  it("never negative, fractional, or under the smallest card charge", () => {
    expect(checkPay(-1, null, "", -1).ok).toBe(false);
    expect(checkPay(1.5, null, "", 1.5).ok).toBe(false);
    expect(checkPay(null, null, "", null).ok).toBe(false);
    expect(checkPay(30, null, "", 30).ok).toBe(false);
    expect(checkPay(50, null, "", 50).ok).toBe(true);
  });
  it("listing amounts come from the contract; calls = rate × booked minutes", () => {
    const c = { writtenCents: 1000, recordingCents: null, liveRateCents: 3000 };
    expect(listingAmount(c, "written")).toBe(1000);
    expect(listingAmount(c, "recording")).toBeNull();
    expect(listingAmount(c, "call", 30)).toBe(1500);
    expect(listingAmount({ ...c, liveRateCents: null }, "call", 30)).toBeNull();
  });
});

describe("disputes", () => {
  it("only contract parts paid below the listing amount, once", () => {
    expect(canDispute(500, 1000, false).ok).toBe(true);
    expect(canDispute(1000, 1000, false).ok).toBe(true); // (batch 10) any amount
    expect(canDispute(500, 1000, true)).toMatchObject({ ok: false, message: expect.stringContaining("once") });
    expect(canDispute(0, null, false).ok).toBe(true); // (batch 10) unlisted parts too
  });
  it("an admin can only raise pay, up to the listing amount", () => {
    expect(checkDisputeDecision(400, 500, 1000).ok).toBe(false);
    expect(checkDisputeDecision(1100, 500, 1000).ok).toBe(false);
    expect(checkDisputeDecision(1000, 500, 1000)).toEqual({ ok: true, extraCents: 500 });
    expect(checkDisputeDecision(500, 500, 1000)).toEqual({ ok: true, extraCents: 0 });
    expect(checkDisputeDecision(520, 500, 1000).ok).toBe(false); // $0.20 extra is under the smallest charge
  });
});

describe("live calls", () => {
  it("reference = rate × length, rounded to the cent", () => {
    expect(callCharge(3000, 30)).toBe(1500);
    expect(callCharge(1000, 7)).toBe(117); // 116.67
    expect(callCharge(0, 30)).toBe(0);
    expect(callCharge(1000, 1)).toBe(50); // raised to the smallest card charge
  });
  it("cancel only 24 hours or more ahead", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    expect(canCancelCall(new Date("2026-11-06T12:00:00Z"), now).ok).toBe(true);
    expect(canCancelCall(new Date("2026-11-06T11:59:00Z"), now)).toMatchObject({ ok: false, message: "Calls can only be cancelled 24 hours or more ahead." });
  });
});

describe("late work and when testers are refused", () => {
  const fmt = () => "Oct 22";
  const now = new Date("2026-11-05T12:00:00Z");
  const working = { status: "working", endKind: "", endedAt: null };
  it("late work is allowed and marked", () => {
    expect(isLate(new Date("2026-11-04T12:00:00Z"), now)).toBe(true);
    expect(isLate(new Date("2026-11-06T12:00:00Z"), now)).toBe(false);
    expect(lateLabel(new Date(), fmt)).toBe("Sent late (deadline was Oct 22)");
    expect(testerRefusal(working, { openUntil: null }, "Nora Lane", fmt, now)).toBe("");
  });
  it("refused after Open until, after being ended or stopped, or after leaving", () => {
    expect(testerRefusal(working, { openUntil: new Date("2026-11-01T00:00:00Z") }, "Nora Lane", fmt, now)).toBe("This test closed on Oct 22.");
    expect(testerRefusal({ status: "ended", endKind: "early", endedAt: now }, { openUntil: null }, "Nora Lane", fmt, now)).toContain("ended your session early");
    expect(testerRefusal({ status: "ended", endKind: "stopped", endedAt: now }, { openUntil: null }, "Nora Lane", fmt, now)).toContain("stopped the test");
    expect(testerRefusal({ status: "left", endKind: "", endedAt: now }, { openUntil: null }, "Nora Lane", fmt, now)).toBe("You left this test.");
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
  it("Open until must be in the future", () => {
    expect(checkListing(listing({ openUntil: "2020-01-01" }))).toContain("Open until must be a date in the future.");
    expect(checkListing(listing({ openUntil: new Date(Date.now() + 12 * 86_400_000).toISOString() }))).toEqual([]);
  });
  it("(batch 12 section 6) Open until is required, 3 to 30 days ahead on Post; within 30 days on Edit", () => {
    const now = new Date("2026-11-01T12:00:00Z");
    const l = (openUntil: string | null) => listing({ openUntil });
    expect(checkListing(l(null), 0, now)).toEqual(["Set Open until 3 to 30 days from today: it's every tester's deadline too."]);
    expect(checkListing(l("2026-11-03T23:59:59Z"), 0, now)).toEqual(["Set Open until 3 to 30 days from today: it's every tester's deadline too."]);
    expect(checkListing(l("2026-11-04T23:59:59Z"), 0, now)).toEqual([]);
    expect(checkListing(l("2026-12-01T23:59:59Z"), 0, now)).toEqual([]);
    expect(checkListing(l("2026-12-02T23:59:59Z"), 0, now)).toEqual(["Open until can be at most 30 days from today."]);
    expect(checkListing(l("2026-11-03T23:59:59Z"), 0, now, { edit: true })).toEqual([]);
    // Edit only checks it when Open until changed (old tests keep working).
    expect(checkListing(l(null), 0, now, { edit: true, changed: new Set(["description"]) })).toEqual([]);
  });
  it("(design doc 4) product, title, instructions and the Mature note", () => {
    const now = new Date();
    expect(checkListing(listing({ productName: "" }), 0, now)).toContain("Enter the product name.");
    expect(checkListing(listing({ productName: "x".repeat(61) }), 0, now)).toContain("Keep the product name to 60 characters.");
    expect(checkListing(listing({ title: "x".repeat(61) }), 0, now)).toContain("Keep the title to 60 characters.");
    expect(checkListing(listing({ description: "" }), 0, now)).toContain("Say what testers should do (What to do).");
    expect(checkListing(listing({ description: "x".repeat(1001) }), 0, now)).toContain("Keep What to do to 1,000 characters.");
    expect(checkListing(listing({ mature: true, matureWhy: "" }), 0, now)).toContain("Say why this test is mature (18+): it's required for mature content.");
    expect(checkListing(listing({ mature: true, matureWhy: "Boss fights with blood" }), 0, now)).toEqual([]);
    // Older tests keep working when only other fields change.
    expect(checkListing(listing({ productName: "", description: "" }), 0, now, { changed: new Set(["spots"]) })).toEqual([]);
  });
  it("written answers need a question", () => expect(checkListing(listing({ questions: [] }))).toContain("Add at least one question for the written answers."));
});

describe("contract snapshot at join", () => {
  it("copies every term; (batch 12) the deadline is the test's Open until (an old test with none keeps its days)", () => {
    const joined = new Date("2026-11-01T10:00:00Z");
    const c = contractSnapshot({ ...listing({ openUntil: "2026-11-20T23:59:59.000Z" }), listingVersion: 3 }, joined, true);
    expect(c).toMatchObject({ listingVersion: 3, writtenCents: 1000, recordingCents: 1500, liveRateCents: 3000, liveMinutes: null, keepPrivate: true });
    expect(c.dueAt.toISOString()).toBe("2026-11-20T23:59:59.000Z");
    expect(contractSnapshot({ ...listing({ openUntil: null }), listingVersion: 3 }, joined, true).dueAt.toISOString()).toBe("2026-11-08T10:00:00.000Z");
  });
  it("is a copy: changing the listing afterwards doesn't change it", () => {
    const l = { ...listing(), listingVersion: 1 };
    const c = contractSnapshot(l, new Date(), false);
    l.questions.push("New question");
    l.writtenCents = 5000;
    expect(c.questions).toEqual(["What did you like?"]);
    expect(c.writtenCents).toBe(1000);
  });
  it("terms line", () => expect(termsLine(listing())).toBe("Written $10.00 · Recording $15.00 · Live call $30.00/h"));
  it("testers see what they get (80%)", () => expect(termsLine(listing(), true)).toBe("Written $8.00 · Recording $12.00 · Live call $24.00/h"));
});

describe("stop once", () => {
  const seen = at(10);
  const events = [
    ev("joined", 5, "old join"), // before the page loaded
    ev("sent", 12, "Ana Silva sent her written answers"),
    ev("edited", 13, "You edited the listing"), // not a stop-once kind
    ev("left", 14, "Ben Carter left the test"),
    ev("joined", 15, "Cara Diaz joined"),
    ev("booked", 16, "Ana Silva booked a call for Thu, Nov 5, 3:00 PM"),
    ev("cancelled", 17, "Ben Carter cancelled their call"),
    ev("offered", 18, "You offered 2 call times"),
    ev("removed", 19, "You removed a call time"),
  ];
  it("lists exactly what changed since the page loaded, oldest first", () => {
    expect(stopOnceChanges(events, seen).map((e) => e.text)).toEqual([
      "Ana Silva sent her written answers", "Ben Carter left the test", "Cara Diaz joined",
      "Ana Silva booked a call for Thu, Nov 5, 3:00 PM", "Ben Carter cancelled their call", "You offered 2 call times", "You removed a call time",
    ]);
  });
  it("each trigger alone stops the first press", () => {
    for (const k of ["left", "joined", "sent", "booked", "confirmed", "cancelled", "offered", "removed"]) expect(stopOnce([ev(k, 11)], seen, false).go).toBe(false);
  });
  it("other changes don't stop", () => expect(stopOnce([ev("edited", 11), ev("stopped", 12), ev("ended", 13)], seen, false)).toEqual({ go: true }));
  it("nothing new: goes ahead at once", () => expect(stopOnce([ev("joined", 5)], seen, false)).toEqual({ go: true }));
  it("the second press goes ahead", () => expect(stopOnce(events, seen, true)).toEqual({ go: true }));
  it("the tester's live-call panel only stops for call changes", () => {
    expect(stopOnce([ev("joined", 11), ev("sent", 12), ev("left", 13)], seen, false, CALL_KINDS)).toEqual({ go: true });
    for (const k of CALL_KINDS) expect(stopOnce([ev(k, 11)], seen, false, CALL_KINDS).go).toBe(false);
  });
});

describe("one stop-once reason set for every developer button", () => {
  const seen = at(10);
  it("any tester's change, call change, payment or rejection anywhere on the test stops the first press", () => {
    for (const k of ["joined", "left", "sent", "booked", "confirmed", "cancelled", "offered", "removed", "paid", "rejected"]) {
      expect(devStopOnce([ev(k, 11)], seen, false).go).toBe(false);
    }
  });
  it("edits, stops, ends and round changes don't stop", () => {
    expect(devStopOnce([ev("edited", 11), ev("stopped", 12), ev("ended", 13), ev("next_round", 14), ev("opened", 15)], seen, false)).toEqual({ go: true });
  });
  it("the second press goes ahead", () => expect(devStopOnce([ev("paid", 11)], seen, true)).toEqual({ go: true }));
  it("reject needs a reason", () => {
    expect(checkReject("").ok).toBe(false);
    expect(checkReject("Didn't follow the questions").ok).toBe(true);
  });
});

describe("ended sessions", () => {
  const fmt = () => "Oct 22";
  it("one line for a tester ended early or stopped", () => {
    expect(endedLine({ status: "ended", endKind: "early", endedAt: new Date() }, "Nora Lane", fmt)).toBe("Nora Lane ended your session early on Oct 22. Work you sent is still reviewed.");
    expect(endedLine({ status: "ended", endKind: "stopped", endedAt: new Date() }, "Nora Lane", fmt)).toBe("Nora Lane stopped the test on Oct 22. Work you sent is still reviewed.");
    expect(endedLine({ status: "working", endKind: "", endedAt: null }, "Nora Lane", fmt)).toBe("");
  });
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
    expect(joinCheck({ ...open, openUntil: new Date(Date.now() - 1000) }, 2, true).result).toBe("refused");
  });
});
