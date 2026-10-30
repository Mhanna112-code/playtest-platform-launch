import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { pressLabelOf, refusalLine } from "@/lib/pressLabels";
import { prevSetsOf, versionsOf } from "@/lib/answerSets";
import { GET as liveGET } from "@/app/api/live/route";
import { POST as alertsPOST } from "@/app/api/account/tester-alerts/route";
import { act, joined, sact, seen, settle, setup } from "./fixtures";
import { json, req } from "./helpers";

// Batch 15 sections 14, 24, 25, 26, 36 and 43.
const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "../src", p), "utf8");
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  return act(testId, "edit", cookie, { version: v, fields, seenAt: seen(), confirmed: true });
};

describe("every stop names the press (section 36)", () => {
  it("the press label comes from the API path; a refusal starts by naming it", () => {
    expect(pressLabelOf("/api/tests/abc/edit")).toBe("Save");
    expect(pressLabelOf("/api/review")).toBe("Pay");
    expect(pressLabelOf("/api/sessions/abc/written")).toBe("Send");
    expect(pressLabelOf("/api/tests/abc/stop")).toBe("Stop the test");
    expect(pressLabelOf("/api/calls/abc/join")).toBe("Join call");
    expect(refusalLine("Pay", "This call was cancelled.")).toBe("Your Pay didn't go through: This call was cancelled.");
    expect(refusalLine("Join call", "Your Join call didn't go through: x.")).toBe("Your Join call didn't go through: x.");
    const box = src("components/ChangesBox.tsx");
    expect(box).toContain("Your ${named} didn't go through.");
    expect(box).toContain("Since you opened this page:");
    expect(box).toContain("`Press ${pressVerb(named)} again to go ahead.`");
    // The bold action line comes last, after the Alerts lines.
    expect(box.indexOf("<QuickIgnore alerts={alerts} />")).toBeLessThan(box.indexOf('data-press-again=""'));
  });
});

describe("the tester's one-press Alerts (section 26) and Leave (section 25)", () => {
  it("Off: a payment line doesn't stop Send (it shows greyed); a terms offer still does; Leave never stops", async () => {
    const { dev, testId } = await setup({ recordingCents: "5.00" });
    const { tester, sessionId } = await joined(testId);
    const other = await joined(testId, "Ben Okafor");
    await sact(other.sessionId, "written", other.tester.cookie, { answers: ["a", "b"] });
    await settle();
    const loaded = seen();
    await settle();
    // The developer pays this tester's recording... (a stop-once reason for every tester button)
    const rec = await db.submission.create({ data: { contractId: sessionId, kind: "recording", agreedCents: 500, sentAt: new Date(), updatedAt: new Date() } });
    await db.review.create({ data: { submissionId: rec.id, contractId: sessionId, amountCents: 500, agreedCents: 500, reason: "", payKey: "k-" + rec.id } });
    await settle();
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], seenAt: loaded })).body.error?.code).toBe("stop_once");
    expect((await json(await alertsPOST(req("/api/account/tester-alerts", { cookie: tester.cookie, body: { off: true } })))).body.off).toBe(true);
    const live = await json(await liveGET(req(`/api/live?scope=session:${sessionId}&since=${encodeURIComponent(loaded)}`, { cookie: tester.cookie, method: "GET" })));
    expect(live.body.changes.length).toBeGreaterThan(0);
    expect(live.body.changes.every((c: { ignored?: boolean }) => c.ignored)).toBe(true);
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], seenAt: loaded })).status).toBe(200);
    // New terms still stop it (batch 27 section 1: an open offer blocks Send, with Alerts Off too).
    const loaded2 = seen();
    await settle();
    expect((await edit(testId, dev.cookie, { writtenCents: "12.00" })).status).toBe(200);
    await settle();
    const r = await sact(sessionId, "written", tester.cookie, { answers: ["c", "d"], seenAt: loaded2 });
    expect(r.body.error?.code).toBe("answer_terms");
    // Leave never stops (Alerts On or Off).
    await db.user.update({ where: { id: other.tester.user.id }, data: { testerAlertsOff: false } });
    expect((await sact(other.sessionId, "leave", other.tester.cookie, { seenAt: loaded })).status).toBe(200);
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("<TesterAlertsToggle off={u.testerAlertsOff} />");
    // (Batch 16 section 4) One grey line for the state shown: what stops a press.
    const toggle = src("components/TesterAlertsToggle.tsx");
    expect(toggle).toContain('"Stops a press once for: new terms, your key, pay, calls, delayed pay, your dispute, listing changes, other tabs."');
    expect(toggle).toContain('"Stops a press only for: new terms, your key marked as working."');
    expect(toggle).toContain('<p className="text-xs text-slate-400" data-tester-alerts-line="">{off ? ALERTS_OFF_LINE : ALERTS_ON_LINE}</p>');
    expect(toggle).not.toContain("Off: only new terms from the developer stop it.");
  });
});

describe("renames and the deal history (sections 24 and 43)", () => {
  it("a rename leaves no note under a press and is recorded for every working tester; each Save is one Contract changes entry with who switched or kept", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Okafor");
    const loaded = seen();
    await settle();
    expect((await edit(testId, dev.cookie, { title: "Harbor Run 2" })).status).toBe(200);
    await settle();
    const r = await sact(a.sessionId, "written", a.tester.cookie, { answers: ["x", "y"], seenAt: loaded });
    expect(r.status).toBe(200);
    expect(r.body.note).toBeUndefined();
    const notes = await db.contractNote.findMany({ where: { contractId: { in: [a.sessionId, b.sessionId] } } });
    expect(notes.map((n) => n.text)).toEqual(["Renamed: “Harbor Run · Harbor Run” → “Harbor Run · Harbor Run 2”", "Renamed: “Harbor Run · Harbor Run” → “Harbor Run · Harbor Run 2”"]);
    // A terms Save: Ana switches, Ben keeps.
    expect((await edit(testId, dev.cookie, { writtenCents: "12.00" })).status).toBe(200);
    await settle();
    const offerOf = async (cid: string) => (await db.termsOffer.findFirstOrThrow({ where: { contractId: cid, status: "open" } })).id;
    expect((await sact(a.sessionId, "terms", a.tester.cookie, { choice: "switch", offerId: await offerOf(a.sessionId), seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await sact(b.sessionId, "terms", b.tester.cookie, { choice: "keep", offerId: await offerOf(b.sessionId), seenAt: seen(), confirmed: true })).status).toBe(200);
    const changes = await db.testChange.findMany({ where: { testId }, orderBy: { createdAt: "asc" } });
    expect(changes.map((c) => c.fields)).toEqual([["title"], ["writtenCents"]]);
    expect(changes[1].before).toEqual({ writtenCents: 1000 });
    expect(changes[1].after).toEqual({ writtenCents: 1200 });
    const offers = await db.termsOffer.findMany({ where: { changeId: changes[1].id } });
    expect(offers.map((o) => o.status).sort()).toEqual(["kept", "switched"]);
    // (Batch 34 §14) The Contract changes fold gave way to the Listing panel (the current listing; the most recent save's fields tagged).
    expect(src("app/app/tests/[id]/page.tsx")).toContain("<ListingPanel rows={listingRows}");
    expect(src("app/app/tests/[id]/page.tsx")).not.toContain("ContractChanges");
  });
});

describe("previous sets: sent or draft (section 14)", () => {
  it("a sent set later edited in a draft keeps both; an old set without versions reads Sent when the part was sent", () => {
    const sets = prevSetsOf([{ until: "2026-11-01T00:00:00Z", items: [{ question: "Q1", required: true, answer: "draft" }], versions: [{ kind: "sent", at: "2026-10-30T00:00:00Z", items: [{ question: "Q1", required: true, answer: "sent" }] }, { kind: "draft", items: [{ question: "Q1", required: true, answer: "draft" }] }] }, { until: "2026-10-01T00:00:00Z", items: [] }]);
    expect(versionsOf(sets[0], true).map((v) => v.kind)).toEqual(["sent", "draft"]);
    expect(versionsOf(sets[1], true).map((v) => v.kind)).toEqual(["sent"]);
    expect(versionsOf(sets[1], false).map((v) => v.kind)).toEqual(["draft"]);
    expect(src("components/AnswerSets.tsx")).toContain('"Draft (not sent)"');
    expect(src("app/app/tests/[id]/page.tsx")).toContain("<PrevSetFolds developer");
  });
});
