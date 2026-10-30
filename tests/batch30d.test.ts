import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { GET as liveGET } from "@/app/api/live/route";
import { invitePanel, invitedYouLine, reinvitedLine, WHY_IN_TEST, WHY_INVITED, whyApplied } from "@/lib/server/invites";
import { invitesV, owedV, testV } from "@/lib/server/pulseV";
import { blockUser } from "@/lib/server/blocks";
import { ANSWER_MIN_CHARS, ANSWER_MIN_LINE, ANSWER_ONE, ANSWER_SHORT, QUESTIONS_RULE_LINE, REQUIRED, answerChars, answerCounter, answerShortLine, answersMissing } from "@/lib/questions";
import { json, makeUser, req, uniq } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 30 (owner, Oct 29): §7 the Invite search says why a person isn't invitable, §8 new invites on the tester dashboard live, §14 each answer at least 50 characters.
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");

// ---------- §7 ----------

describe("batch 30 §7: the Invite search says why a matching person isn't invitable", () => {
  it("an invited, a joined and an applying tester each show greyed with why (no tick); a blocked one shows nothing", async () => {
    const tag = uniq();
    const { dev, testId } = await setup({ joinMode: "apply", title: `Search ${tag}` });
    const mk = (n: string) => makeUser({ tester: true, name: `${n} ${tag}` });
    const [inv, inTest, applier, blocked, free] = await Promise.all([mk("Invo"), mk("Joino"), mk("Appo"), mk("Blocko"), mk("Freeo")]);
    expect((await act(testId, "invite", dev.cookie, { testerIds: [inv.user.id], seenAt: seen(), confirmed: true })).status).toBe(200);
    // Joined through an invite (an "apply" test joins on an invite).
    expect((await act(testId, "invite", dev.cookie, { testerIds: [inTest.user.id], seenAt: seen(), confirmed: true })).status).toBe(200);
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect((await act(testId, "join", inTest.cookie, { listingVersion: t.listingVersion })).status).toBe(200);
    expect((await act(testId, "apply", applier.cookie, { note: "I love boat games" })).status).toBe(200);
    await blockUser(blocked.user, dev.user.id);
    await settle();

    const found = async (q: string) => (await invitePanel(dev.user.id, testId, { q })).found;
    const one = async (n: string) => {
      const f = await found(`${n} ${tag}`);
      expect(f).toHaveLength(1);
      return f[0];
    };
    const a = await one("Invo");
    expect(a).toMatchObject({ why: WHY_INVITED, whyKind: "invited", invited: true });
    expect(`${a.name} · ${a.why}`).toBe(`Invo ${tag} · already invited, waiting for them to join`);
    expect(await one("Joino")).toMatchObject({ why: WHY_IN_TEST, whyKind: "in" });
    expect(WHY_IN_TEST).toBe("already in this test");
    const app = await db.application.findFirstOrThrow({ where: { testId, testerId: applier.user.id } });
    expect(await one("Appo")).toMatchObject({ why: "applied: answer them in Needs you →", whyKind: "applied", appId: app.id });
    expect(whyApplied("rejoin")).toBe("asked to rejoin: answer them in Needs you →");
    // Blocked: never revealed, so the plain "No testers match" stays.
    expect(await found(`Blocko ${tag}`)).toHaveLength(0);
    // An invitable one has no reason, and comes before the ones that can't be invited.
    expect((await one("Freeo")).why).toBeUndefined();
    const all = (await found(tag)).map((x) => x.why ?? "");
    expect(all[0]).toBe("");
    expect(all.slice(1).every(Boolean)).toBe(true);
    // The applicant isn't suggested (they're answered in Needs you).
    expect((await invitePanel(dev.user.id, testId)).suggested.map((x) => x.id)).not.toContain(applier.user.id);
  });

  it("the panel: a greyed reason row without a tick box; the invited reason brings the Invited row into view; applied jumps to Needs you", () => {
    const panel = src("app/app/tests/[id]/InvitePanel.tsx");
    expect(panel).toContain("found.map((t) => (t.why ? whyRow(t) : row(t, \"f\")))");
    expect(panel).toContain("id={`invited-${s.id}`}");
    expect(panel).toContain("jumpTo(`item-app-${t.appId}`)");
    expect(panel).toContain("No testers match “{term}”.");
    // whyRow has no checkbox.
    const whyRow = panel.slice(panel.indexOf("const whyRow"), panel.indexOf("const [none, setNone]"));
    expect(whyRow).not.toContain("checkbox");
  });
});

// ---------- §8 ----------

describe("batch 30 §8: a new invite shows on the tester dashboard live", () => {
  it("the dashboard renders with the same fingerprint the poll answers, so an invite created right after render changes it", async () => {
    const { dev, testId } = await setup({ title: `Live ${uniq()}` });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    const rendered = await invitesV(ana.user.id);
    const poll = async () => ((await json(await pulseGET(req("/api/pulse?invites=1", { cookie: ana.cookie })))).body as { v: string }).v;
    expect(await poll()).toBe(rendered);
    expect((await act(testId, "invite", dev.cookie, { testerIds: [ana.user.id], seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await poll()).not.toBe(rendered);
    // Every AutoRefresh user passes the server-rendered fingerprint (v).
    expect(src("app/app/page.tsx")).toContain('<AutoRefresh query="invites=1" v={invitesFp} />');
    expect(src("app/app/payments/page.tsx")).toContain('<AutoRefresh query="owed=1" v={owedFp} />');
    expect(src("app/app/BankToConfirm.tsx")).toContain('v={bankTopV(rows)}');
    expect(src("app/app/RatingsToGive.tsx")).toContain("v={rows.map((r) => `${r.id}:${r.text}`).join(\",\")}");
    expect(src("app/app/TestsVisited.tsx")).toContain("v={visitedV(rows)}");
  });

  it("the test page, the session page, chat and the join page start from the poll's fingerprint too", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    const pv = async (q: string, cookie: string) => ((await json(await pulseGET(req(`/api/pulse?${q}`, { cookie })))).body as { v: string }).v;
    expect(await pv(`test=${testId}`, dev.cookie)).toBe(await testV(dev.user.id, testId));
    expect(await pv(`session=${j.sessionId}`, j.tester.cookie)).toBe(await testV(j.tester.user.id, testId, j.sessionId));
    expect(src("app/app/tests/[id]/page.tsx").split("<AutoRefresh query={`test=${t.id}`} v={pageV} />").length).toBe(3); // the full and the restricted view
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("<AutoRefresh query={`session=${c.id}`} v={pageV} />");
    expect(src("app/app/chat/[id]/page.tsx")).toContain("v={pageV} />");
    expect(src("app/app/find/[id]/page.tsx")).toContain('{invite && <AutoRefresh query="invites=1" v={invitesFp} />}');
  });

  it("Payments' owed fingerprint is the poll's", async () => {
    const dev = await makeUser({ dev: true });
    const r = await json(await pulseGET(req("/api/pulse?owed=1", { cookie: dev.cookie })));
    expect(r.body.v).toBe(await owedV(dev.user.id));
  });

  it("the top box: \"Marc Hanna invited you to “ddddd”\" for a new invite, the re-sent line for one sent again on a new listing", async () => {
    const title = `ddddd ${uniq()}`;
    const { dev, testId } = await setup({ title });
    await db.user.update({ where: { id: dev.user.id }, data: { name: "Marc Hanna" } });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    // (A minute back: Ana is new, so nothing else can be in it, and the database clock may differ from this one under load.)
    const since = new Date(Date.now() - 60_000).toISOString();
    expect((await act(testId, "invite", dev.cookie, { testerIds: [ana.user.id], seenAt: seen(), confirmed: true })).status).toBe(200);
    const live = async (s: string) => ((await json(await liveGET(req(`/api/live?scope=invites:me&since=${encodeURIComponent(s)}`, { cookie: ana.cookie })))).body as { changes: { text: string }[] }).changes.map((c) => c.text).filter((t) => !t.startsWith("The site was down")); // another test's outage line reaches everyone
    // (The database clock can run ahead of this one under load, and the live route shows only lines up to its own now: ask again for up to 3 s, as the page's next poll would.)
    let first: string[] = [];
    for (let i = 0; i < 30 && !first.length; i++) {
      if (i) await new Promise((r) => setTimeout(r, 100));
      first = await live(since);
    }
    expect(first).toEqual([invitedYouLine("Marc Hanna", title)]);
    expect(invitedYouLine("Marc Hanna", "ddddd")).toBe("Marc Hanna invited you to “ddddd”");
    // A listing change re-sends the invite: the new one reads as re-sent.
    // (Since the first invite's own time, as the database wrote it: the two clocks can differ under load.)
    const since2 = (await db.invite.findFirstOrThrow({ where: { testerId: ana.user.id } })).createdAt.toISOString();
    await settle();
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { writtenCents: "12.00" }, seenAt: seen(), confirmed: true })).status).toBe(200);
    let second: string[] = [];
    for (let i = 0; i < 30 && !second.length; i++) {
      if (i) await new Promise((r) => setTimeout(r, 100));
      second = await live(since2);
    }
    expect(second).toEqual([reinvitedLine("Marc Hanna", title)]);
  });
});

// ---------- §14 ----------

describe("batch 30 §14: each written answer is at least 50 characters", () => {
  beforeEach(() => {
    process.env.ANSWER_MIN_CHARS = "50"; // the real minimum (the suite runs at 1 for the tests written before batch 30)
  });
  afterEach(() => {
    process.env.ANSWER_MIN_CHARS = "1";
  });
  const x = (n: number) => "x".repeat(n);

  it("the rule: formatting marks don't count, spaces inside do; an empty optional answer is fine; at least one answer of 50+", () => {
    expect(ANSWER_MIN_CHARS).toBe(50);
    expect(answerChars("  " + x(10) + "  ")).toBe(10);
    expect(answerChars("**" + x(10) + "**")).toBe(10);
    expect(answerChars("```\n" + x(10) + "\n```")).toBe(10);
    expect(answerChars("a b c")).toBe(5);
    expect(answersMissing(["A?", "B?"], [x(49), ""])).toEqual({ message: ANSWER_SHORT, at: 0, chars: 49 });
    expect(answersMissing(["A?", "B?"], [x(50), ""])).toBeNull();
    expect(answersMissing(["A?", "B?"], ["", x(50)])).toBeNull();
    expect(answersMissing(["A?", "B?"], [x(50), "short"])).toEqual({ message: ANSWER_SHORT, at: 1, chars: 5 });
    expect(answersMissing(["A?", "B?"], ["**" + x(48) + "**", ""])).toMatchObject({ at: 0, chars: 48 });
    expect(answersMissing(["A?", "B?"], ["", ""])).toEqual({ message: ANSWER_ONE, at: 0 });
    expect(answerShortLine(12)).toBe("Write at least 50 characters (12 so far).");
    expect(answerCounter(12)).toBe("12 / 50 characters minimum");
    expect(ANSWER_SHORT).toBe("Each answer needs at least 50 characters.");
  });

  it("the server: 49 refused at that answer, 50 accepted; an empty optional fine; Anything else short is fine; a draft saves short", async () => {
    const { testId } = await setup({ questions: ["What did you like?", REQUIRED + "Where did you get stuck?"] });
    const j = await joined(testId);
    const short = await sact(j.sessionId, "written", j.tester.cookie, { answers: ["", x(49)], notes: "ok" });
    expect(short.status).toBe(400);
    expect(short.body.error).toMatchObject({ code: "bad_answers", message: ANSWER_SHORT, missing: 1, chars: 49 });
    // A draft keeps whatever was typed.
    const { setKept } = await import("@/lib/server/kept");
    await setKept(j.tester.user.id, `written:${j.sessionId}`, { answers: ["", "short"], notes: "" });
    expect(await db.keptForm.count({ where: { userId: j.tester.user.id } })).toBe(1);
    const ok = await sact(j.sessionId, "written", j.tester.cookie, { answers: ["", x(50)], notes: "ok" });
    expect(ok.status).toBe(200);
    // An optional one filled in short is refused at it.
    const k = await joined(testId, "Ben Cole", "he");
    const opt = await sact(k.sessionId, "written", k.tester.cookie, { answers: ["meh", x(60)] });
    expect(opt.body.error).toMatchObject({ message: ANSWER_SHORT, missing: 0, chars: 3 });
  });

  it("the form: counter under each answer, red line at the answer; Post / Edit / the join page say it", () => {
    const form = src("app/app/sessions/[id]/SessionActions.tsx");
    expect(form).toContain("{answerCounter(chars)}");
    expect(form).toContain("answerShortLine(missing.chars ?? 0)");
    expect(form).toContain('<AnswerBox id="notes" rows={2} value={notes} onChange={setNotes} />'); // no minimum on Anything else
    expect(QUESTIONS_RULE_LINE).toBe("Testers answer at least one question. Tick Required on any they must answer. Each answer is at least 50 characters.");
    expect(ANSWER_MIN_LINE).toBe("Each answer is at least 50 characters.");
    expect(src("app/app/tests/TestForm.tsx")).toContain("{QUESTIONS_RULE_LINE}");
    expect(src("app/app/find/[id]/page.tsx")).toContain("{ANSWER_MIN_LINE}");
  });
});
