import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { QuestionList } from "@/components/QuestionList";
import { QuestionBox, pastCallsBox } from "@/components/QuestionBox";
import { questionLimitLine } from "@/lib/questions";
import { isMissingNeedLine, missingNeedLine, missingNeedText, testerGapText } from "@/lib/gaps";
import { OrList, MissingNeedWords } from "@/components/MissingNeeds";
import { GapLinesBox } from "@/app/app/tests/[id]/InvitePanel";
import { testerNeedsChangedLines } from "@/lib/server/invites";
import { AGE_LINE, AGE_TICK, TERMS_TICK_LABEL, TERMS_TICK_MISSING, TERMS_UPDATED_CODE, TERMS_VERSION, WHAT_CHANGED, needsTermsAgain } from "@/lib/termsOfUse";
import { signUp } from "@/lib/server/passwords";
import { POST as signupPOST } from "@/app/api/auth/signup/route";
import { POST as googleFinishPOST } from "@/app/api/auth/google/finish/route";
import { finishGoogle, GOOGLE_COOKIE, GOOGLE_SIGNUP_COOKIE, GOOGLE_STEP_EXPIRED, pendingGoogleSignup, startGoogleSignup } from "@/lib/server/google";
import { APPLIED_WAITING, IN_THIS_TEST, INVITE_STAYS_OPEN, profileOpenTests, profileTestRefusal } from "@/lib/server/profileOpenTests";
import { alignedClash, formClashInputs, madeBy, newRow, rowsPayload, type RowState } from "@/components/RequestRows";
import { clashNotes, localFmt, type ClashTarget } from "@/lib/callClash";
import { toJson, rowsOf } from "@/lib/callRows";
import { POST as alertsPOST } from "@/app/api/account/alerts/route";
import { POST as alertsAddPOST } from "@/app/api/account/alerts/add/route";
import { POST as testerAlertsPOST } from "@/app/api/account/tester-alerts/route";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { GET as liveGET } from "@/app/api/live/route";
import { ignoredAlertsNow, publishIgnoredAlerts, publishTesterAlertsOff, testerAlertsAreOff } from "@/lib/testerAlerts";
import { exactFirst, nameMatches, textFilters } from "@/lib/nameSearch";
import { searchByDeveloper } from "@/lib/devSearch";
import { userWhere } from "@/lib/server/adminLists";
import { testSearchWhere } from "@/lib/server/findSearch";
import { INVITE_FULL_LINE, inviteBlocked, inviteTestRefusal } from "@/lib/rules";
import { payMoreLine } from "@/lib/server/testerGate";
import { json, makeUser, req } from "./helpers";
import { act, atHours, bookCall, joined, sact, seen, settle, setup } from "./fixtures";
import { pay, payMore } from "./b15";

// Batch 20 (owner, Oct 28 night): question lists in a scroll box, the 20-question notice, every missing need named, Invite stops for changes that matter, 18+ at
// sign-up, profile Open tests for testers who are part of a test, no false "overlaps" flash, Alerts in sync, 1-character searches, a full test's Invite disabled,
// past calls in a scroll box, and Pay more stopping presses.

(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const later = () => new Promise((r) => setTimeout(r, 30));
const texts = (r: { body: { error?: { code?: string; changes?: { text: string }[] } } }) => (r.body.error?.code === "stop_once" ? r.body.error.changes!.map((c) => c.text) : []);
const again = () => ({ confirmed: true, boxAt: new Date().toISOString() });
const qs = (n: number) => Array.from({ length: n }, (_, i) => `Question number ${i + 1}?`);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("batch 20 section 1: more than 3 questions sit in a scroll box", () => {
  it("2 questions: no box; 4 and 20: a box about 3 questions tall with every question inside (no +N more)", () => {
    const two = html(createElement(QuestionList, { items: qs(2) }));
    expect(two).not.toContain("data-question-box");
    expect(two).toContain("Question number 2?");
    for (const n of [4, 20]) {
      const out = html(createElement(QuestionList, { items: qs(n) }));
      expect(out).toContain(`data-question-box="${n}"`);
      expect(out).toContain("max-h-48 overflow-y-auto".split(" ")[0]);
      expect(out).toContain("overflow-y-auto");
      for (const q of qs(n)) expect(out).toContain(q);
      expect(out).not.toMatch(/\+\d+ more/);
    }
  });

  it("a long question keeps its own clamp (3 lines, Show more) inside the box; phones get the same box, full width", () => {
    const long = "Tell us everything about the harbor level. ".repeat(60);
    const out = html(createElement(QuestionList, { items: [long, ...qs(4)] }));
    expect(out).toContain("-webkit-line-clamp:3");
    expect(out).toContain("w-full");
    expect(html(createElement(QuestionBox, { count: 3, children: "x" }))).not.toContain("data-question-box");
  });

  it("every read-only list uses it; the answer form puts questions and answer boxes in the box (notes, counter, files and Send below) and a red mistake scrolls the box", () => {
    const session = src("app/app/sessions/[id]/page.tsx");
    expect(session).toContain('<li data-scope-questions="">Questions: <QuestionList items={writtenQuestions(c).map((q) => qText(q))} /></li>');
    expect(session).toContain("<div>Then: <QuestionList items={(o.fromQuestions as string[]).map(qText)} /></div>");
    expect(src("app/app/sessions/[id]/TesterTop.tsx")).toContain("<QuestionList items={offer.fromQuestions} />");
    expect(src("app/app/tests/[id]/ListingPanel.tsx")).toContain("<QuestionList items="); // (batch 34 §14) the Listing panel replaced Contract changes
    expect(src("app/app/find/[id]/page.tsx")).toContain("<QuestionBox count={l.questions.length} as=\"ul\"");
    const form = src("app/app/sessions/[id]/SessionActions.tsx");
    const box = form.indexOf('<QuestionBox count={questions.length} size="form"');
    expect(box).toBeGreaterThan(0);
    expect(form.indexOf("</QuestionBox>")).toBeLessThan(form.indexOf('htmlFor="notes"'));
    expect(form.indexOf("</QuestionBox>")).toBeLessThan(form.indexOf("data-written-count"));
    expect(form).toContain('<div key={i} data-question="">');
    expect(src("components/FieldChecks.tsx")).toContain("if (!scrollQuestionBoxTo(el)) el.scrollIntoView?.(");
    // Post and Edit are unchanged.
    expect(src("app/app/tests/TestForm.tsx")).not.toContain("<QuestionBox");
  });
});

describe("batch 20 section 2: the 20-question notice", () => {
  it("19: no line; 20: the line; delete one: gone; it's a notice (not red) right under the questions", () => {
    expect(questionLimitLine(qs(19).join("\n"))).toBe("");
    expect(questionLimitLine(qs(20).join("\n"))).toBe("At most 20 questions.");
    expect(questionLimitLine(qs(20).join("\n") + "\n\n")).toBe("At most 20 questions.");
    expect(questionLimitLine(qs(20).slice(1).join("\n"))).toBe("");
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain('{questionLimitLine(f.questions) && <p className="mt-1 text-xs text-sky-200" data-question-limit="" role="status">{questionLimitLine(f.questions)}</p>}');
    expect(form.indexOf("data-question-limit")).toBeLessThan(form.indexOf('{lockNote("questions")}'));
  });

  it("the server still refuses more than 20", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane" });
    const { POST } = await import("@/app/api/tests/route");
    const { listingBody } = await import("./fixtures");
    const r = await json(await POST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ questions: qs(21) }) })));
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain("At most 20 questions.");
  });
});

describe("batch 20 section 3: Invite anyway names every missing need", () => {
  const langs = ["Chinese", "Portuguese"];
  const devs = ["Windows PC", "Switch", "VR headset", "Steam Deck", "iPhone", "Android phone", "iPad", "Android tablet"];

  it("both kinds in one line; one kind only that part", () => {
    expect(missingNeedLine("fbbb", { languages: langs, devices: devs })).toBe("fbbb doesn't list a language this test needs (Chinese or Portuguese) or a device it needs (Windows PC, Switch, VR headset, Steam Deck, iPhone, Android phone, iPad or Android tablet).");
    expect(missingNeedLine("fbbb", { languages: langs, devices: [] })).toBe("fbbb doesn't list a language this test needs (Chinese or Portuguese).");
    expect(missingNeedLine("fbbb", { languages: [], devices: ["Windows PC", "iPad"] })).toBe("fbbb doesn't list a device this test needs (Windows PC or iPad).");
    expect(isMissingNeedLine(missingNeedLine("fbbb", { languages: langs, devices: [] }))).toBe(true);
    expect(isMissingNeedLine("What's missing changed since you looked. Press Invite anyway again to invite on this:")).toBe(false);
    // The tester's Join anyway box: the same words.
    expect(testerGapText({ languages: langs, devices: ["iPad"] }, "join")).toBe("Your profile doesn't list a language this test needs (Chinese or Portuguese) or a device it needs (iPad). Join anyway?");
    expect(missingNeedText({ languages: [], devices: [] })).toBe("");
  });

  it("a long list: its first 3 with +N more (opens in place); 5 testers sit in a scroll box about 3 lines tall", () => {
    expect(html(createElement(OrList, { items: langs }))).toBe("Chinese or Portuguese");
    const long = html(createElement(OrList, { items: devs }));
    expect(long).toContain("Windows PC, Switch, VR headset");
    expect(long).toContain("+5 more");
    expect(long).toContain('data-plus-more="closed"');
    expect(html(createElement(MissingNeedWords, { g: { languages: langs, devices: devs } }))).toContain("doesn&#x27;t list a language this test needs (Chinese or Portuguese) or a device it needs (");
    const items = ["Ana", "Ben", "Cy", "Di", "Ed"].map((name) => ({ name, languages: langs, devices: devs }));
    const box = html(createElement(GapLinesBox, { lines: items.map((i) => missingNeedLine(i.name, i)), items }));
    expect(box).toContain('data-gap-scroll="5"');
    expect(box.match(/data-gap-line/g)).toHaveLength(5);
    const three = html(createElement(GapLinesBox, { lines: items.slice(0, 3).map((i) => missingNeedLine(i.name, i)), items }));
    expect(three).not.toContain("data-gap-scroll");
    const panel = src("app/app/tests/[id]/InvitePanel.tsx");
    expect(panel.indexOf("<GapLinesBox")).toBeLessThan(panel.indexOf(">Invite anyway</button>"));
  });

  it("(server) a tester missing both hears both; the gap lines and the stale-box check use the same wording", async () => {
    const { dev, testId } = await setup();
    await db.test.update({ where: { id: testId }, data: { devices: devs, languages: langs } });
    const f = await makeUser({ tester: true, name: "fbbb" });
    await db.testerProfile.update({ where: { userId: f.user.id }, data: { devices: ["PlayStation"], languages: ["French"] } });
    await later();
    const body = { testerIds: [f.user.id], seenAt: seen() };
    const r = await act(testId, "invite", dev.cookie, body);
    const line = missingNeedLine("fbbb", { languages: langs, devices: devs });
    expect(r.body.error.message).toBe(`CONFIRM:${line}`);
    expect(r.body.error.lines).toEqual([line]);
    expect(r.body.error.items).toEqual([{ name: "fbbb", languages: langs, devices: devs }]);
    // A box that showed only the languages (the old wording) is stale: stops once with the full line.
    const stale = await act(testId, "invite", dev.cookie, { ...body, anyway: true, seenGaps: ["fbbb doesn't list Chinese or Portuguese, which this test needs."], ...again() });
    expect(stale.body.error.message).toMatch(/^CONFIRM:What's missing changed since you looked/);
    const ok = await act(testId, "invite", dev.cookie, { ...body, anyway: true, seenGaps: [line], ...again() });
    expect(ok.body.message).toBe("Invited fbbb.");
    // The live box's check: the same lines.
    const g = await makeUser({ tester: true, name: "Gus" });
    await db.testerProfile.update({ where: { userId: g.user.id }, data: { devices: ["iPad"], languages: ["French"] } });
    const check = await act(testId, "invite-check", dev.cookie, { testerIds: [g.user.id] });
    expect(check.body.lines).toEqual(["Gus doesn't list a language this test needs (Chinese or Portuguese)."]);
  });

  it("(server) the tester's Join anyway: both kinds, the same words", async () => {
    const { testId } = await setup();
    await db.test.update({ where: { id: testId }, data: { devices: ["iPad"], languages: ["Chinese"] } });
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    const test = await db.test.findUniqueOrThrow({ where: { id: testId } });
    const r = await act(testId, "join", t.cookie, { listingVersion: test.listingVersion });
    expect(r.body.error.code).toBe("needs");
    expect(r.body.error.message).toBe("Your profile doesn't list a language this test needs (Chinese) or a device it needs (iPad).\nJoin anyway?");
    expect(r.body.error.gaps).toEqual({ languages: ["Chinese"], devices: ["iPad"] });
  });
});

describe("batch 20 section 4: Invite stops only for required items, one net line per tester", () => {
  const test = { languages: ["Chinese", "Portuguese"], devices: ["Windows PC"] };
  it("unrelated changes: nothing; added; removed; both; added then removed: nothing", () => {
    const none = { languages: [] as string[], devices: [] as string[] };
    expect(testerNeedsChangedLines("fbbb", { languages: ["Chinese"], devices: ["VR headset"] }, { languages: ["Chinese", "French"], devices: ["VR headset", "Android tablet", "iPad", "PlayStation", "Xbox"] }, test)).toEqual([]);
    expect(testerNeedsChangedLines("fbbb", none, { languages: ["Chinese"], devices: ["Windows PC"] }, test)).toEqual(["fbbb now lists Chinese and Windows PC, which this test needs."]);
    expect(testerNeedsChangedLines("fbbb", { languages: ["Chinese"], devices: [] }, none, test)).toEqual(["fbbb no longer lists Chinese, which this test needs."]);
    expect(testerNeedsChangedLines("fbbb", { languages: ["Chinese"], devices: [] }, { languages: [], devices: ["Windows PC"] }, test)).toEqual(["fbbb now lists Windows PC but no longer lists Chinese (this test needs Chinese or Portuguese)."]);
    expect(testerNeedsChangedLines("fbbb", none, none, test)).toEqual([]);
  });

  it("(server) an unrelated edit never stops; several edits collapse into one line with one time; added then removed: no stop", async () => {
    const { dev, testId } = await setup();
    await db.test.update({ where: { id: testId }, data: { devices: ["Windows PC"], languages: ["Chinese", "Portuguese"] } });
    const f = await makeUser({ tester: true, name: "fbbb" });
    await db.testerProfile.update({ where: { userId: f.user.id }, data: { devices: ["Windows PC"], languages: ["Chinese"] } });
    await later();
    const loaded = seen();
    await later();
    const body = { testerIds: [f.user.id], seenAt: loaded, tab: "B", seenNeeds: { devices: ["Windows PC"], languages: ["Chinese", "Portuguese"] }, seenTesters: { [f.user.id]: { devices: ["Windows PC"], languages: ["Chinese"] } } };
    // Unrelated: French, PlayStation and Xbox added.
    await db.testerProfile.update({ where: { userId: f.user.id }, data: { devices: ["Windows PC", "PlayStation", "Xbox"], languages: ["Chinese", "French"] } });
    const r = await act(testId, "invite", dev.cookie, body);
    expect(r.body.error?.code).not.toBe("stop_once");
    await db.invite.deleteMany({ where: { testId } });
    // Several edits: Portuguese added, then Chinese removed: one line.
    await db.testerProfile.update({ where: { userId: f.user.id }, data: { languages: ["Chinese", "French", "Portuguese"] } });
    await later();
    await db.testerProfile.update({ where: { userId: f.user.id }, data: { languages: ["French", "Portuguese"] } });
    const r2 = await act(testId, "invite", dev.cookie, body);
    expect(texts(r2)).toEqual([]); // still lists a needed language: no kind flipped
    // Added then removed again (back to what the page showed): no line, no stop.
    await db.testerProfile.update({ where: { userId: f.user.id }, data: { devices: ["Windows PC"], languages: ["Chinese"] } });
    const r3 = await act(testId, "invite", dev.cookie, body);
    expect(r3.body.error?.code).not.toBe("stop_once");
    // The test's own requirement changes keep their line.
    expect(src("lib/server/invites.ts")).toContain('const line = requirementsChangedLine(seenNeeds, t);');
    // The panel sends what its rows currently show, and a box keeps one line per tester.
    expect(src("app/app/tests/[id]/InvitePanel.tsx")).toContain("shown.current.set(t.id,");
    const { mergeChanges } = await import("@/lib/live");
    expect(mergeChanges([{ text: "fbbb now lists Chinese, which this test needs.", at: "1", key: "needs:x" }], [{ text: "fbbb now lists Chinese and Windows PC, which this test needs.", at: "2", key: "needs:x" }])).toEqual([{ text: "fbbb now lists Chinese and Windows PC, which this test needs.", at: "2", key: "needs:x" }]);
  });
});

describe("batch 20 section 5: 18 or older", () => {
  const mail = () => `age-${randomUUID()}@test.playtest.test`;
  it("the Terms say it (version 2 and its What changed); the labels", () => {
    expect(src("app/terms/page.tsx")).toContain('"You must be 18 or older to use Playtest. Everyone must give accurate account details.');
    expect(WHAT_CHANGED.find((w) => w.version === TERMS_VERSION)!.points.some((p) => p.startsWith(AGE_LINE))).toBe(true);
    expect(AGE_LINE).toBe("You must be 18 or older to use Playtest.");
    expect(AGE_TICK).toBe("I'm 18 or older.");
    // (Section 21) Age is confirmed only at sign-up: an account on the current Terms isn't asked again.
    expect(needsTermsAgain({ termsVersion: TERMS_VERSION })).toBe(false);
    expect(needsTermsAgain({ termsVersion: TERMS_VERSION - 1 })).toBe(true);
  });

  it("email sign-up: refused (red at the tick) until ticked; ticked records when", async () => {
    const body = { email: mail(), password: "harbor-run-1", role: "tester", name: "Ana Silva", acceptTerms: "yes" };
    const no = await json(await signupPOST(req("/api/auth/signup", { body })));
    expect(no.body.error).toMatchObject({ code: "bad_field", message: AGE_LINE });
    expect(await db.user.count({ where: { email: body.email } })).toBe(0);
    const ok = await signUp({ ...body, over18: "yes" }, "http://localhost:3400");
    expect(ok.user.ageConfirmedAt).not.toBeNull();
    const page = src("app/signup/page.tsx");
    expect(page).toContain('<input type="checkbox" id="over18" name="over18" value="yes" required className="mt-1" data-match="18 or older" />');
    expect(page.indexOf('id="acceptTerms"')).toBeLessThan(page.indexOf('id="over18"'));
  });

  it("Google: a new account gets one short step; nothing is created until both ticks; then signed in", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    const email = mail();
    const claims = { iss: "https://accounts.google.com", aud: "cid", exp: Math.floor(Date.now() / 1000) + 600, email, email_verified: true };
    const idToken = `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id_token: idToken }), { status: 200 }));
    const done = await finishGoogle(new Request("http://localhost:3400/api/auth/google/callback?code=c&state=s", { headers: { cookie: `${GOOGLE_COOKIE}=s.v` } }));
    expect("pending" in done).toBe(true);
    expect(await db.user.count({ where: { email } })).toBe(0);
    const token = (done as { pending: string }).pending;
    expect((await pendingGoogleSignup(token))?.email).toBe(email);
    const finish = (body: Record<string, unknown>, t = token) => googleFinishPOST(req("/api/auth/google/finish", { body, headers: { cookie: `${GOOGLE_SIGNUP_COOKIE}=${t}` } }));
    expect((await json(await finish({ over18: "yes" }))).body.error.message).toBe("Agree to the Terms of Use to sign up");
    expect((await json(await finish({ acceptTerms: "yes" }))).body.error.message).toBe(AGE_LINE);
    expect(await db.user.count({ where: { email } })).toBe(0);
    const res = await finish({ acceptTerms: "yes", over18: "yes" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("pt_session");
    const u = await db.user.findUniqueOrThrow({ where: { email } });
    expect(u.ageConfirmedAt).not.toBeNull();
    expect(u.termsVersion).toBe(TERMS_VERSION);
    expect(u.emailVerifiedAt).not.toBeNull();
    // The step is used up.
    expect((await json(await finish({ acceptTerms: "yes", over18: "yes" }))).body.error.message).toBe(GOOGLE_STEP_EXPIRED);
    expect((await json(await finish({ acceptTerms: "yes", over18: "yes" }, await startGoogleSignup(mail(), new Date(Date.now() - 3_600_000))))).body.error.message).toBe(GOOGLE_STEP_EXPIRED);
    expect(src("app/api/auth/google/callback/route.ts")).toContain("headers.set(\"Location\", `${base}/signup/google`);");
  });

  it("an existing account (no age recorded, on the current Terms) isn't asked: Post and Join go straight through", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane", ageConfirmed: false });
    const { listingBody } = await import("./fixtures");
    const { POST } = await import("@/app/api/tests/route");
    expect((await json(await POST(req("/api/tests", { cookie: dev.cookie, body: listingBody() })))).status).toBe(200);
    const { testId } = await setup();
    const t = await makeUser({ tester: true, name: "Ana Silva", ageConfirmed: false });
    const test = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect((await act(testId, "join", t.cookie, { listingVersion: test.listingVersion })).status).toBe(200);
  });
});

describe("batch 20 section 6: profile Open tests keep the tests the viewer is part of", () => {
  const devOf = async (testId: string) => {
    const t = await db.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
    return t.developer;
  };
  it("the owner's case: invite only, 1 spot, joined: still listed, \"You're in this test\", opening the session", async () => {
    const { dev, testId } = await setup({ spots: 1, joinMode: "invite" });
    await db.test.update({ where: { id: testId }, data: { joinMode: "invite", spots: 1 } });
    const t = await makeUser({ tester: true, name: "fbbb" });
    await db.invite.create({ data: { testId, testerId: t.user.id } });
    const test = await db.test.findUniqueOrThrow({ where: { id: testId } });
    const j = await act(testId, "join", t.cookie, { listingVersion: test.listingVersion });
    expect(j.status).toBe(200);
    const list = await profileOpenTests(await devOf(testId), t.user, false);
    const row = list.find((x) => x.id === testId)!;
    expect(row).toMatchObject({ viewer: "working", viewerLine: IN_THIS_TEST, sessionId: j.body.sessionId });
    // Past Open until too.
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() - 86_400_000) } });
    expect((await profileOpenTests(await devOf(testId), t.user, false)).map((x) => x.id)).toContain(testId);
    // Someone else not involved: hidden, as before.
    const other = await makeUser({ tester: true, name: "Ben" });
    expect((await profileOpenTests(await devOf(testId), other.user, false)).map((x) => x.id)).not.toContain(testId);
    void dev;
    expect(src("app/app/developers/[id]/page.tsx")).toContain("t.sessionId ? `/app/sessions/${t.sessionId}`");
  });

  it("an invited tester on a full test: listed with the invite line, and the join page opens; an applicant: Applied (waiting), gone once full closes it", async () => {
    const { dev, testId } = await setup({ spots: 1 });
    const inv = await makeUser({ tester: true, name: "Ivy" });
    await db.invite.create({ data: { testId, testerId: inv.user.id } });
    await joined(testId, "Ana Silva");
    const row = (await profileOpenTests(await devOf(testId), inv.user, false)).find((x) => x.id === testId);
    expect(row?.viewerLine).toBe(INVITE_STAYS_OPEN);
    expect(await profileTestRefusal(testId, inv.user.id)).toBe("");
    // An applicant (Approved-only test with a spot).
    const s2 = await setup({ spots: 2 });
    await db.test.update({ where: { id: s2.testId }, data: { joinMode: "approve" } });
    const ap = await makeUser({ tester: true, name: "Al" });
    await db.application.create({ data: { testId: s2.testId, testerId: ap.user.id, status: "pending", listing: {} } });
    expect((await profileOpenTests(await devOf(s2.testId), ap.user, false)).find((x) => x.id === s2.testId)?.viewerLine).toBe(APPLIED_WAITING);
    await db.test.update({ where: { id: s2.testId }, data: { spots: 0 } });
    expect((await profileOpenTests(await devOf(s2.testId), ap.user, false)).map((x) => x.id)).not.toContain(s2.testId);
    void dev;
  });
});

describe("batch 20 section 7: no false \"overlaps\" flash after Request a time", () => {
  const fmt = localFmt("UTC");
  const red = (n: ReturnType<typeof alignedClash>) => n.notes.flat().filter((x) => x.tone === "red").map((x) => x.text);
  const row = (repeat: RowState["repeat"], h = 50): RowState => ({ when: atHours(h).slice(0, 16), repeat, count: "4" });

  it("a Daily / Weekly set's own calls are never compared with each other (in the form, or on the server)", () => {
    for (const repeat of ["daily", "weekly"] as const) {
      const n = clashNotes({ rows: [{ startsAt: atHours(50), repeat, count: 8 }], minutes: 180, side: "tester", targets: [{ name: "Nora", calls: [], requests: [] }], elsewhere: [], fmt });
      expect(n.rows.flat()).toEqual([]);
      const forever = clashNotes({ rows: [{ startsAt: atHours(50), repeat, count: 0 }], minutes: 180, side: "developer", targets: [{ name: "Ana", calls: [], requests: [] }], elsewhere: [], fmt });
      expect(forever.rows.flat()).toEqual([]);
    }
  });

  for (const side of ["tester", "developer"] as const) {
    for (const repeat of ["once", "daily", "weekly"] as const) {
      it(`${side}, ${repeat}, no prior calls: no red line at any moment (before, right after the response, after the next poll)`, async () => {
        const { dev, testId } = await setup();
        const j = await joined(testId, "Ana Silva");
        const rows = [row(repeat)];
        const target = (reqs: ClashTarget["requests"]): ClashTarget[] => [{ name: side === "tester" ? "Nora Lane" : "Ana Silva", calls: [], requests: reqs }];
        // What the page holds: the waiting requests between the two of them (built as the pages do).
        const pageReqs = async () => (await db.callRequest.findMany({ where: { contractId: j.sessionId, status: "pending" } })).map((r) => ({ id: r.id, rows: toJson(rowsOf(r)), minutes: r.minutes, mine: r.fromSide === side, calls: [] }));
        const before = target([]);
        expect(red(alignedClash(rows, "30", side, before, []))).toEqual([]);
        const r = side === "tester"
          ? await sact(j.sessionId, "request-time", j.tester.cookie, { rows: rowsPayload(rows), minutes: "30", seenAt: seen(), confirmed: true })
          : await act(testId, "request-time", dev.cookie, { contractIds: [j.sessionId], rows: rowsPayload(rows), minutes: "30", seenAt: seen(), confirmed: true });
        expect(r.status).toBe(200);
        const made = madeBy(r.body);
        expect(made.requestIds).toHaveLength(1);
        // The page's data refreshed (its poll) before the reload landed: the new request is in it.
        const after = target((await pageReqs()).map(({ calls: _c, ...q }) => q));
        // The cause: comparing the form with what this press just made (before the fix: "Overlaps your request to …").
        expect(red(alignedClash(rows, "30", side, after, []))[0]).toMatch(/^Overlaps your request to /);
        // Fixed: from the press on, the checks use what the page had when it was pressed, never what the press made.
        const inputs = (live: ClashTarget[], frozen: ClashTarget[] | null) => formClashInputs(live.map((t) => ({ ...t })), frozen, made);
        expect(red(alignedClash(rows, "30", side, inputs(after, before), []))).toEqual([]);
        expect(red(alignedClash(rows, "30", side, inputs(after, null), []))).toEqual([]);
        // And the form clears as soon as it went through.
        expect(alignedClash([newRow()], "", side, after, []).notes.flat()).toEqual([]);
      });
    }
  }

  it("both forms clear and freeze on success; the developer's response names its requests", () => {
    for (const f of ["components/CallRequests.tsx", "app/app/tests/[id]/DevCallPanel.tsx"]) {
      const s = src(f);
      expect(s).toContain("setMade(madeBy(r));");
      expect(s).toContain("setRows([newRow()]);");
      expect(s).toContain("formClashInputs(");
      expect(s.indexOf("setRows([newRow()]);")).toBeLessThan(s.indexOf("window.location.reload();", s.indexOf("setMade(madeBy(r));")));
    }
    expect(src("lib/server/requests.ts")).toContain("return { requested: ok.length, batchId, ids: made };");
  });
});

describe("batch 20 section 8: the chip, the Alerts menu, other boxes and other tabs share one setting", () => {
  it("(cause) the chip DID save: the server has it; the menu's own state wasn't told. Now one type at a time, and the saved list is returned", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane" });
    const add = await json(await alertsAddPOST(req("/api/account/alerts/add", { cookie: dev.cookie, body: { key: "calls" } })));
    expect(add.body.ignored).toEqual(["calls"]);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).ignoredAlerts).toEqual(["calls"]);
    // A menu drawn before the chip's press ticks Joins: only Joins is added (the chip's Call changes stays).
    const menu = await json(await alertsPOST(req("/api/account/alerts", { cookie: dev.cookie, body: { key: "joins", off: true } })));
    expect(menu.body.ignored.sort()).toEqual(["calls", "joins"]);
    // Un-ticking Call changes in the menu turns the chip back.
    const un = await json(await alertsPOST(req("/api/account/alerts", { cookie: dev.cookie, body: { key: "calls", off: false } })));
    expect(un.body.ignored).toEqual(["joins"]);
    // Other tabs and devices: the page's poll carries the saved setting.
    const { testId } = await setup();
    await db.test.update({ where: { id: testId }, data: { developerId: dev.user.id } });
    const p = await json(await pulseGET(req(`/api/pulse?test=${testId}`, { cookie: dev.cookie, method: "GET" })));
    expect(p.body.alerts).toEqual({ ignored: ["joins"] });
  });

  it("in the tab: the chip's press reaches the menu at once (an event), and other tabs (storage); the menu's tick reaches the chips", () => {
    const store = new Map<string, string>();
    const win = Object.assign(new EventTarget(), { localStorage: { setItem: (k: string, v: string) => store.set(k, v), getItem: (k: string) => store.get(k) ?? null } });
    vi.stubGlobal("window", win);
    const heard: string[][] = [];
    win.addEventListener("dev-alerts", (e) => heard.push((e as CustomEvent<{ ignored: string[] }>).detail.ignored));
    publishIgnoredAlerts(["calls"]);
    expect(heard).toEqual([["calls"]]);
    expect(ignoredAlertsNow()).toEqual(["calls"]);
    expect(JSON.parse(store.get("pt-alerts")!).ignored).toEqual(["calls"]);
    publishIgnoredAlerts([], true);
    expect(heard[1]).toEqual([]);
    const off: boolean[] = [];
    win.addEventListener("tester-alerts", (e) => off.push((e as CustomEvent<{ off: boolean }>).detail.off));
    publishTesterAlertsOff(true);
    expect(off).toEqual([true]);
    expect(testerAlertsAreOff()).toBe(true);
    publishTesterAlertsOff(false);
    expect(testerAlertsAreOff()).toBe(false);
    // The components read the shared setting.
    expect(src("components/QuickIgnore.tsx")).toContain("const done = useIgnoredAlerts();");
    expect(src("components/AlertsMenu.tsx")).toContain("const shared = useIgnoredAlerts(start);");
    expect(src("components/TesterAlertsToggle.tsx")).toContain("const off = useTesterAlertsOff(start);");
    expect(src("components/AutoRefresh.tsx")).toContain("publishIgnoredAlerts(alerts.ignored, false)");
  });

  it("the tester's Turn off alerts: saved, and the session page's poll carries it", async () => {
    const { testId } = await setup();
    const j = await joined(testId, "Ana Silva");
    expect((await json(await testerAlertsPOST(req("/api/account/tester-alerts", { cookie: j.tester.cookie, body: { off: true } })))).body.off).toBe(true);
    const p = await json(await pulseGET(req(`/api/pulse?session=${j.sessionId}`, { cookie: j.tester.cookie, method: "GET" })));
    expect(p.body.alerts).toEqual({ testerOff: true });
  });
});

describe("batch 20 section 9: name searches from 1 character", () => {
  it("1-2 characters: the start of a word or the whole name; 3+: any part; exact first", () => {
    expect(nameMatches("m", "m")).toBe(true);
    expect(nameMatches("Mia Long", "m")).toBe(true);
    expect(nameMatches("Ana Silva", "an")).toBe(true);
    expect(nameMatches("Joanna", "an")).toBe(false);
    expect(nameMatches("Joanna", "ann")).toBe(true);
    expect(nameMatches("Sam Kim", "")).toBe(false);
    expect(exactFirst(["Mia", "m", "Max"], "m", (x) => [x])).toEqual(["m", "Mia", "Max"]);
    expect(textFilters("an")).toEqual(expect.arrayContaining([{ startsWith: "an", mode: "insensitive" }, { contains: " an", mode: "insensitive" }]));
    expect(textFilters("ann")).toEqual([{ contains: "ann", mode: "insensitive" }]);
  });

  it("(server) the invite search finds a one-letter name by its letter, exact first", async () => {
    const { dev, testId } = await setup();
    const m = await makeUser({ tester: true, name: "m" });
    await makeUser({ tester: true, name: "Mia Moss" });
    const r = await act(testId, "invite-search", dev.cookie, { q: "m", devices: [], languages: [] });
    const names = (r.body.found as { id: string; name: string }[]).map((x) => x.name);
    expect(names[0]).toBe("m");
    expect(r.body.searched).toBe(true);
    expect((r.body.found as { id: string }[]).some((x) => x.id === m.user.id)).toBe(true);
    expect(src("app/app/tests/[id]/InvitePanel.tsx")).toContain('const term = q.trim().length >= 1 ? q.trim() : "";');
  });

  it("Search by developer, the admin's Accounts and Find: the same rule", async () => {
    const rows = [{ name: "Dan" }, { name: "Ana Silva" }, { name: "Joanna" }, { name: "an" }].map((x, i) => ({ id: String(i), title: "T", developer: x.name, status: "Working on it", joinedAt: `2026-10-0${i + 1}`, href: null }));
    expect(searchByDeveloper(rows, "an").map((r) => r.developer)).toEqual(["an", "Ana Silva"]);
    expect(searchByDeveloper(rows, "ann").map((r) => r.developer)).toEqual(["Joanna"]);
    const tag = randomUUID().slice(0, 6);
    await db.user.create({ data: { email: `q-${tag}@test.playtest.test`, name: `Zed ${tag}` } });
    const found = await db.user.findMany({ where: userWhere({ q: "z" }) });
    expect(found.some((u) => u.name === `Zed ${tag}`)).toBe(true);
    expect(JSON.stringify(testSearchWhere("h"))).toContain('"startsWith":"h"');
    expect(src("app/app/find/page.tsx")).toContain("exactFirst(shown, typed,");
    expect(src("lib/server/adminLists.ts")).toContain("const page = [...exact, ...list.slice(0, PAGE)];");
  });
});

describe("batch 20 section 10: Invite disabled while nobody can be invited", () => {
  const base = { status: "open", spots: 1, testersIn: 1, openUntil: null, stoppedAt: null, paused: false, title: "jj" };
  it("full: disabled with the line (Edit link); joining closed and paused keep their lines; a spot opens: enabled", () => {
    const now = new Date();
    expect(inviteBlocked(base, now, String)).toEqual({ line: INVITE_FULL_LINE, full: true });
    expect(INVITE_FULL_LINE).toBe("This test is full. Add spots in Edit to invite more people.");
    expect(inviteBlocked({ ...base, testersIn: 0 }, now, String)).toBeNull();
    expect(inviteBlocked({ ...base, testersIn: 0, paused: true }, now, String)!.line).toBe(inviteTestRefusal({ ...base, testersIn: 0, paused: true }, now, String));
    expect(inviteBlocked({ ...base, testersIn: 0, openUntil: new Date(now.getTime() - 1000) }, now, String)!.line).toMatch(/^Joining closed on /);
    const panel = src("app/app/tests/[id]/InvitePanel.tsx");
    expect(panel).toContain('<button className="btn" disabled={busy || !!blocked} title={blocked?.line} onClick={() => (ticked.length ? invite(false) : setNone(true))}>Invite</button>');
    expect(panel).toContain("This test is full. Add spots <a href={`/app/tests/${p.testId}/edit#spots`}>in Edit</a> to invite more people.");
    // Ticks stay possible (the boxes aren't disabled by it).
    expect(panel).toContain("disabled={!!t.grey}");
  });

  it("(server) an old page's press on a full test is still refused", async () => {
    const { dev, testId } = await setup({ spots: 1 });
    await joined(testId, "Ana Silva");
    const t = await makeUser({ tester: true, name: "Ben" });
    const r = await act(testId, "invite", dev.cookie, { testerIds: [t.user.id], seenAt: seen() });
    expect(r.body.error.message).toBe("Harbor Run is full. Add spots to invite more people.");
    // The page's poll changes when a spot opens (a tester leaves: an event), so the panel follows.
    expect(src("app/app/tests/[id]/page.tsx")).toContain("blocked={inviteBlocked({ ...t, testersIn: working.length, paused: !!u.holdStartedAt }, now, fmtDate)}");
  });
});

describe("batch 20 section 11: past calls in a scroll box past 3", () => {
  it("2 calls: no box; 6: a box about 3 calls tall; both pages use it; a bell link scrolls to the call", () => {
    expect(pastCallsBox(2, "tester")).toBe("");
    expect(pastCallsBox(3, "developer")).toBe("");
    expect(pastCallsBox(6, "tester")).toContain("overflow-y-auto");
    expect(pastCallsBox(6, "developer")).toContain("overflow-y-auto");
    expect(src("app/app/sessions/[id]/page.tsx")).toContain('<ul className={`mt-2 space-y-2 ${pastCallsBox(overCalls.length, "tester")}`}');
    expect(src("app/app/tests/[id]/page.tsx")).toContain('<ul className={`mt-2 space-y-2 ${pastCallsBox(overCalls.length, "developer")}`}');
    // Newest first, each with its own id (a bell link "#call-<id>" opens the fold, scrolls the box to it and marks it).
    expect(src("app/app/sessions/[id]/page.tsx")).toContain(".sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());");
    expect(src("lib/markJump.ts")).toContain('el.scrollIntoView({ block: "center", behavior: "smooth" });');
  });
});

describe("batch 20 section 12: a Pay more stops presses once", () => {
  async function paidPiece() {
    const { dev, testId } = await setup();
    const j = await joined(testId, "Ana Silva");
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    await settle();
    return { dev, testId, ...j, sub };
  }

  it("the tester: every press stops once for it (Alerts On), the live box lists it; with Alerts Off it goes through", async () => {
    const w = await paidPiece();
    const call = await bookCall(w.testId, w.dev.cookie, w.sessionId, w.tester.cookie, 72);
    await later();
    const loaded = seen();
    await later();
    expect((await payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "5.00", tickedCents: 500 })).status).toBe(200);
    const line = payMoreLine("Nora Lane", 500, "written answers");
    expect(line).toBe("Nora Lane paid you $5.00 more for your written answers");
    const presses: [string, Record<string, unknown>][] = [
      ["cancel-call", { callId: call.id, reason: "Something came up at work." }],
      ["written", { answers: ["c", "d"] }],
      ["request-time", { rows: [{ startsAt: atHours(100), repeat: "once", count: 1 }], minutes: "30" }],
    ];
    for (const [action, body] of presses) {
      const r = await sact(w.sessionId, action, w.tester.cookie, { ...body, seenAt: loaded, pageSeenAt: loaded });
      expect(texts(r), action).toContain(line);
    }
    const live = await json(await liveGET(req(`/api/live?scope=session:${w.sessionId}&since=${encodeURIComponent(loaded)}`, { cookie: w.tester.cookie, method: "GET" })));
    expect(live.body.changes.map((c: { text: string }) => c.text)).toContain(line);
    // Alerts Off: it doesn't stop.
    await db.user.update({ where: { id: w.tester.user.id }, data: { testerAlertsOff: true } });
    const off = await sact(w.sessionId, "cancel-call", w.tester.cookie, { callId: call.id, reason: "Something came up at work.", seenAt: loaded, pageSeenAt: loaded });
    expect(texts(off)).toEqual([]);
    expect(off.status).toBe(200);
  });

  it("the developer: a Pay more in tab A stops every press in tab B once", async () => {
    const w = await paidPiece();
    await later();
    const loaded = seen();
    await later();
    expect((await payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "5.00", tickedCents: 500, tab: "A" })).status).toBe(200);
    const line = "You paid Ana Silva $5.00 more for their written answers in another tab";
    const presses: [string, Record<string, unknown>][] = [
      ["request-time", { contractIds: [w.sessionId], rows: [{ startsAt: atHours(100), repeat: "once", count: 1 }], minutes: "30" }],
      ["end-early", { contractIds: [w.sessionId], reason: "Thanks, that's enough." }],
      ["pay-extra", { contractId: w.sessionId, submissionId: w.sub.id, amount: "1.00", tickedCents: 100, payKey: randomUUID() }],
    ];
    for (const [action, body] of presses) {
      const r = await act(w.testId, action, w.dev.cookie, { ...body, seenAt: loaded, loadedAt: loaded, tab: "B" });
      expect(texts(r), action).toContain(line);
    }
    // The developer's live box lists it (in the other tab). (Batch 29 section 12) Rate is never stopped by your own changes in another tab.
    expect(src("lib/server/ratings.ts")).not.toContain('o.about?.a === "pay-more"');
    expect(src("lib/server/live.ts")).toContain("export const LIVE_OWN_ACTS = BIG_OWN_ACTS;");
  });
});

describe("batch 20 section 13: a change while the tester is typing raises the pill and lands in the live box", () => {
  it("(server) the developer's call request reaches the tester's live box and the page's poll (the Call requests panel refreshes)", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId, "Ana Silva");
    await later();
    const loaded = seen();
    const pulse = async () => (await json(await pulseGET(req(`/api/pulse?session=${j.sessionId}`, { cookie: j.tester.cookie, method: "GET" })))).body.v as string;
    const v0 = await pulse();
    await later();
    expect((await act(testId, "request-time", dev.cookie, { contractIds: [j.sessionId], rows: [{ startsAt: atHours(80), repeat: "once", count: 1 }], minutes: "30", seenAt: seen(), confirmed: true })).status).toBe(200);
    await later(); // the live route lists changes up to its own "now", and the database clock can run a few ms ahead of this process
    const live = await json(await liveGET(req(`/api/live?scope=session:${j.sessionId}&since=${encodeURIComponent(loaded)}`, { cookie: j.tester.cookie, method: "GET" })));
    expect(live.body.changes.map((c: { text: string }) => c.text).some((t: string) => t.startsWith("Nora Lane requested a call for "))).toBe(true);
    expect(await pulse()).not.toBe(v0);
  });

  it("every update nobody pressed for is announced: it raises the pill and counts (batch 27 section 4: never a scroll, typing or not)", () => {
    const top = src("components/LiveTop.tsx");
    expect(top).toContain("if (fresh.length) announceFresh(fresh.length, key(fresh[fresh.length - 1]));");
    expect(top).toContain("setPill((p) => p + n);");
    // The old check read a `pill` frozen at 0 inside the poll's closure.
    expect(top).not.toContain("else if (pill) setPill(");
  });
});

describe("batch 20 section 14: Rate stops once for call changes between the two people", () => {
  it("the developer requests a call: the tester's Rate stops once naming it; another tester's call doesn't; Alerts Off goes through", async () => {
    const s = await setup({ recordingCents: "15.00" });
    const j = await joined(s.testId);
    const k = await joined(s.testId, "Ben Carter", "he");
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    await settle();
    const old = seen();
    await settle();
    // Another tester's call: never a reason.
    expect((await act(s.testId, "request-time", s.dev.cookie, { contractIds: [k.sessionId], rows: [{ startsAt: atHours(90), repeat: "once", count: 1 }], minutes: "30", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(texts(await sact(j.sessionId, "rate", j.tester.cookie, { stars: 5, seenAt: old, pageSeenAt: old })).filter((t) => t.includes("call"))).toEqual([]);
    await db.rating.deleteMany({ where: { contractId: j.sessionId } });
    await db.contract.update({ where: { id: j.sessionId }, data: { status: "working", endKind: "", endedAt: null } });
    const old2 = seen();
    await settle();
    expect((await act(s.testId, "request-time", s.dev.cookie, { contractIds: [j.sessionId], rows: [{ startsAt: atHours(95), repeat: "once", count: 1 }], minutes: "30", seenAt: seen(), confirmed: true })).status).toBe(200);
    const r = await sact(j.sessionId, "rate", j.tester.cookie, { stars: 5, seenAt: old2, pageSeenAt: old2 });
    expect(r.body.error.code).toBe("stop_once");
    expect(texts(r).some((t) => t.startsWith("Nora Lane requested a call for "))).toBe(true);
    await db.user.update({ where: { id: j.tester.user.id }, data: { testerAlertsOff: true } });
    expect((await sact(j.sessionId, "rate", j.tester.cookie, { stars: 5, seenAt: old2, pageSeenAt: old2 })).status).toBe(200);
  });

  it("(batch 30 §4) the developer's Rate has no call-change rule (it only opens once the tester's part ended)", () => {
    const r = src("lib/server/ratings.ts");
    expect(r).not.toContain('kind: { in: ["requested", "booked", "confirmed", "cancelled", "withdrew_req", "declined_req"] } } })).filter((e) => !e.text.startsWith("You ")));');
    expect(r).not.toContain('!c.test.developer.ignoredAlerts.includes("calls")');
  });
});

describe("batch 20 section 15: Dispute disabled when nothing more can be awarded", () => {
  const dispute = (sessionId: string, cookie: string, id: string) => sact(sessionId, "dispute", cookie, { kind: "submission", id, reason: "I answered every question in full detail.", seenAt: seen(), confirmed: true });
  async function paidAt(amount: string, cents: number, over: Record<string, unknown> = {}) {
    const s = await setup(over);
    const j = await joined(s.testId);
    const n = ((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions as string[]).length || 1;
    await sact(j.sessionId, "written", j.tester.cookie, { answers: Array(n).fill("answer") });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    const r = await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount, tickedCents: cents, over200: cents > 20000, reason: "Some of it was thin." });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return { ...s, ...j, sub };
  }
  it("the rule and its line", async () => {
    const { canDispute, NOTHING_TO_DISPUTE } = await import("@/lib/rules");
    expect(NOTHING_TO_DISPUTE).toBe("Already paid the most this piece can be paid, so there's nothing to dispute."); // (batch 28 §15)
    expect(canDispute(1000, 1000, false, false, 0)).toEqual({ ok: false, message: NOTHING_TO_DISPUTE });
    expect(canDispute(999, 1000, false, false, 1).ok).toBe(true);
    expect(canDispute(1000, 1000, false, false, null).ok).toBe(true); // not known: as before
  });
  it("(server; batch 28 §15) a listed piece paid the listing can still be disputed: the range runs to the piece's cap", async () => {
    const full = await paidAt("10.00", 1000);
    expect((await dispute(full.sessionId, full.tester.cookie, full.sub.id)).status).toBe(200);
  });
  it("(server; batch 29 §38) an unlisted piece paid below its max can be disputed; paid its max ($1,000 in all), there's nothing to dispute", async () => {
    const x = await paidAt("900.00", 90000, { writtenCents: null });
    expect((await dispute(x.sessionId, x.tester.cookie, x.sub.id)).status).toBe(200);
    const y = await paidAt("1000.00", 100000, { writtenCents: null });
    expect((await dispute(y.sessionId, y.tester.cookie, y.sub.id)).body.error.message).toBe("Already paid the most this piece can be paid, so there's nothing to dispute.");
  });
  it("(server) a Pay more reaching the cap disables it (the page's poll brings it); the page uses the admin form's bounds", async () => {
    const x = await paidAt("8.00", 800);
    const { disputeRoom } = await import("@/lib/server/payments");
    expect((await disputeRoom([{ submissionId: x.sub.id }])).get(x.sub.id)).toBe(99_200); // (batch 29 §38) $1,000 in all, less the $8 paid
    expect((await payMore(x.testId, x.dev.cookie, { contractId: x.sessionId, submissionId: x.sub.id, amount: "990.00", tickedCents: 99_000, over200: true })).status).toBe(200);
    expect((await payMore(x.testId, x.dev.cookie, { contractId: x.sessionId, submissionId: x.sub.id, amount: "2.00", tickedCents: 200 })).status).toBe(200);
    expect((await disputeRoom([{ submissionId: x.sub.id }])).get(x.sub.id)).toBe(0);
    expect((await dispute(x.sessionId, x.tester.cookie, x.sub.id)).body.error.message).toBe("Already paid the most this piece can be paid, so there's nothing to dispute.");
    const page = src("app/app/sessions/[id]/page.tsx");
    expect(page).toContain('<button type="button" className="btn-ghost text-sm" disabled>Dispute the pay</button>');
    expect(page).toContain("const room = await disputeRoom(");
    // The same bounds as the admin's decision (disputeBounds), so the two never disagree; a call's include what's left of the $1,000.
    expect(src("lib/server/payments.ts")).toContain("const bounds = existing || byTesterChoice(review.reason) ? null : await disputeBounds(");
    expect(src("lib/server/payments.ts")).toContain("const room = await pieceRoom(piece);");
  });
});

describe("batch 20 section 16: admin accounts are admin only", () => {
  const redirectedTo = (f: () => unknown) => {
    try {
      f();
      return "";
    } catch (e) {
      return String((e as { digest?: string }).digest ?? e);
    }
  };
  it("a new admin completes setup with Name and Pronoun only (no side); developer and tester pages move an admin to /admin; non-admins unchanged", async () => {
    const { saveProfile } = await import("@/lib/server/users");
    const { adminAway, adminKeeps } = await import("@/lib/server/adminPages");
    const admin = await makeUser({ name: "" });
    await db.user.update({ where: { id: admin.user.id }, data: { isAdmin: true } });
    const saved = await saveProfile(admin.user.id, { name: "Olive Admin", pronoun: "she", isDeveloper: false, isTester: false });
    expect(saved).toMatchObject({ name: "Olive Admin", isDeveloper: false, isTester: false });
    const a = await db.user.findUniqueOrThrow({ where: { id: admin.user.id } });
    for (const p of ["/app", "/app/tests/new", "/app/sessions", "/app/payments", "/app/profile", "/app/messages", "/app/chat", "/app/calls", "/app/tests/x/edit"]) expect(redirectedTo(() => adminAway(a, p)), p).toContain("/admin");
    for (const p of ["/app/find", "/app/find/x", "/app/developers/x", "/app/testers/x", "/app/account"]) expect(adminKeeps(p), p).toBe(true);
    // The first sign-in's setup (no name yet) stays on /app.
    expect(redirectedTo(() => adminAway({ ...a, name: "" }, "/app"))).toBe("");
    // Not an admin: nothing moves, and a side is still required.
    const plain = await makeUser({ name: "Pat" });
    expect(redirectedTo(() => adminAway(plain.user, "/app/payments"))).toBe("");
    await expect(saveProfile(plain.user.id, { name: "Pat", isDeveloper: false, isTester: false })).rejects.toThrow("Choose developer, tester, or both.");
    // An admin never gets a side (the account page offers none; the route refuses).
    const { POST } = await import("@/app/api/account/side/route");
    const r = await json(await POST(req("/api/account/side", { cookie: admin.cookie, body: { side: "tester", add: true } })));
    expect(r.body.error.message).toBe("An admin account is only for the admin console. To post or test, use a separate account.");
    expect(src("app/app/profile/ProfileForm.tsx")).toContain('if (first) window.location.href = admin && !v.isDeveloper && !v.isTester ? "/admin" : "/app";');
    expect(src("app/app/layout.tsx")).toContain("const side = admin ? null : sideFor(u);"); // (batch 34 §5) the account's side, not the page's
    expect(src("app/app/account/page.tsx")).toContain('const side = isAdmin(u) ? null : sideFor(u, "/app/account");');
  });
});

describe("batch 20 section 17: a blocked profile shows a proper page", () => {
  it("they blocked you: \"This profile isn't available.\"; you blocked them: the profile with Unblock (no Chat with, Open tests hidden with a line); unknown ids: a proper page", async () => {
    const { ProfileUnavailable, PROFILE_UNAVAILABLE, PAGE_MISSING, blockedTestsLine } = await import("@/components/ProfileUnavailable");
    expect(PROFILE_UNAVAILABLE).toBe("This profile isn't available.");
    expect(PAGE_MISSING).toBe("This page doesn't exist.");
    expect(blockedTestsLine("Nora Lane")).toBe("You blocked Nora Lane, so their tests are hidden.");
    const out = html(createElement(ProfileUnavailable, {}));
    expect(out).toContain("← Back");
    expect(out).toContain("This profile isn&#x27;t available.");
    for (const f of ["app/app/developers/[id]/page.tsx", "app/app/testers/[id]/page.tsx"]) {
      const s = src(f);
      expect(s, f).toContain("return <ProfileUnavailable />;");
      expect(s, f).toContain("{iBlocked ? <UnblockButton say userId={p.id} name={name} /> : <BlockButton plain");
      expect(s, f).not.toMatch(/blockedId: p\.id \}\] \} \}\)\)\) notFound\(\);/);
    }
    expect(src("app/app/developers/[id]/page.tsx")).toContain("const open = iBlocked ? [] : await profileOpenTests(p, viewer, isAdmin(viewer));");
    expect(src("app/app/testers/[id]/page.tsx")).toContain("const shared = !mine && viewer.isDeveloper && !off && !iBlocked ? await");
    expect(src("app/app/not-found.tsx")).toContain("<ProfileUnavailable line={PAGE_MISSING} />");
    expect(src("components/BlockButton.tsx")).toContain('{done && <span className="text-emerald-300" role="status">Unblocked.</span>}');
  });
});

describe("batch 20 section 18: never reload a page under someone's typing", () => {
  it("the last-resort reloads wait while a field has focus or typed text or a box is open (a quiet Refresh line meanwhile); the poll still re-renders", () => {
    const a = src("components/AutoRefresh.tsx");
    expect(a).toContain("if (pageBusy()) {");
    expect(a).toContain("setTimeout(() => reloadWhenFree(() => !document.querySelector(\"main\")?.children.length), 6000);");
    expect(a).toContain("reloadWhenFree(() => shown.current !== null && shown.current !== v && !bankCheckOpen())");
    expect(a).toContain("This page has updates · Refresh");
    expect(a).toContain("router.refresh();");
    expect(a).not.toMatch(/\) window\.location\.reload\(\); \}, [56]000\)/);
    const b = src("lib/pageBusy.ts");
    expect(b).toContain('"dialog[open], [role=\'dialog\'], [aria-modal=\'true\'], [data-invite-anyway], [data-changes-box], [data-stop-box], [data-confirm-open]"');
  });

  it("Request a time (both sides), End early and Stop keep what was typed across any reload", async () => {
    const { getKept, setKept } = await import("@/lib/server/kept");
    const u = await makeUser({ dev: true });
    for (const key of ["request:t-abc", "request:sess1", "endearly:t1", "stop:t1"]) {
      await setKept(u.user.id, key, { rows: [{ when: "2026-11-05T15:00", repeat: "weekly", count: "4" }], minutes: "45" });
      expect((await getKept(u.user.id, key)).data).toMatchObject({ minutes: "45" });
    }
    expect(src("app/app/tests/[id]/DevCallPanel.tsx")).toContain("useKept<{ rows: RowState[]; minutes: string; ticked: string[] }>(`request:t-${testId}`");
    expect(src("components/CallRequests.tsx")).toContain("await keep.clear();");
    expect(src("app/app/tests/[id]/TopPanel.tsx")).toContain("useKept<{ reason: string }>(`endearly:${p.id}`");
    // Pay, dispute, rating and chat already keep theirs.
    for (const f of ["app/app/tests/[id]/PayBox.tsx", "app/app/sessions/[id]/SessionActions.tsx", "components/RateBox.tsx", "components/Chat.tsx"]) expect(src(f), f).toContain("useKept(");
  });
});

describe("batch 20 section 19: number boxes can't take negatives or zero", () => {
  it("whole-number boxes keep digits only and never 0 or below; money boxes drop a minus; the spinner stops at the minimum", async () => {
    const { wholeText, moneyText } = await import("@/components/FieldChecks");
    expect(wholeText("-20")).toBe("20");
    expect(wholeText("0")).toBe("");
    expect(wholeText("0", "3")).toBe("3");
    expect(wholeText("1e3")).toBe("13");
    expect(wholeText("2.5")).toBe("25");
    expect(wholeText("007")).toBe("7");
    expect(wholeText("12")).toBe("12");
    expect(moneyText("-5.00")).toBe("5.00");
    expect(moneyText("0")).toBe("0"); // $0 stays allowed where it is today
    const f = src("components/FieldChecks.tsx");
    expect(f).toContain('document.addEventListener("keydown", onKey, true);');
    expect(f).toContain('document.addEventListener("paste", onPaste, true);');
    expect(src("app/app/tests/TestForm.tsx")).toContain('attrs: { "data-min": "1", min: "1", step: "1", inputMode: "numeric", "data-max": String(limit), "data-whole": "",');
    for (const p of ["components/CallRequests.tsx", "app/app/tests/[id]/DevCallPanel.tsx"]) expect(src(p)).toContain('data-whole=""');
    expect(src("app/admin/AdminButton.tsx")).toContain('{...(f.name === "days" ? { inputMode: "numeric" as const, "data-whole": "" } : {})}');
  });
});

describe("batch 20 section 20: the Open until line names the later of the two dates", () => {
  it("the last sentence", async () => {
    const R = await import("@/lib/rules");
    expect(R.openUntilLine("2026-11-20", 14)).toBe("Testers can join until this date. Each gets 14 days from when they join, so someone joining on Nov 20 has until Dec 4 to send work. You pay each piece within 7 days of it arriving or by that tester's deadline, whichever is later, or the tester can charge you.");
  });
});

describe("batch 20 section 21: the updated-Terms tick sits above the button, with the other ticks", () => {
  it("Post and Join with an old Terms version: the tick above the button, required (red at it); the current version: no tick", async () => {
    expect(TERMS_TICK_LABEL).toBe("I agree to the updated Terms of Use.");
    expect(TERMS_TICK_MISSING).toBe("Tick to agree to the updated Terms of Use.");
    const { TermsAgainBox } = await import("@/components/TermsAgainBox");
    const box = html(createElement(TermsAgainBox, { agreed: false, onAgree: () => undefined }));
    expect(box).toContain("I agree to the updated Terms of Use. <a href=\"/terms#what-changed\" target=\"_blank\" rel=\"noreferrer\">Read what changed</a>");
    expect(box).not.toContain("18");
    const dev = await makeUser({ dev: true, name: "Nora Lane", termsVersion: TERMS_VERSION - 1 });
    const { listingBody } = await import("./fixtures");
    const { POST } = await import("@/app/api/tests/route");
    const r = await json(await POST(req("/api/tests", { cookie: dev.cookie, body: listingBody() })));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: TERMS_UPDATED_CODE, message: TERMS_TICK_MISSING, errors: [TERMS_TICK_MISSING] });
    expect((await json(await POST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ agreeTerms: true, title: "Harbor Run again" }) })))).status).toBe(200);
    const { testId } = await setup();
    const t = await makeUser({ tester: true, name: "Ana Silva", termsVersion: TERMS_VERSION - 1 });
    const test = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect((await act(testId, "join", t.cookie, { listingVersion: test.listingVersion })).body.error.message).toBe(TERMS_TICK_MISSING);
    expect((await act(testId, "join", t.cookie, { listingVersion: test.listingVersion, agreeTerms: true })).status).toBe(200);
    // Shown from the start (the page knows), above the button; on Post before the Charge tick.
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain("const [termsAsk, setTermsAsk] = useState(termsAgain);");
    expect(form.indexOf("{termsAsk && !edit && <TermsAgainBox")).toBeLessThan(form.indexOf("data-pay-rules-tick"));
    expect(src("app/app/tests/new/page.tsx")).toContain("termsAgain={needsTermsAgain(u)}");
    const join = src("app/app/find/[id]/JoinBox.tsx");
    expect(join).toContain("const [termsAsk, setTermsAsk] = useState(!!p.termsAgain);");
    expect(join.indexOf("{termsAsk && <TermsAgainBox agreed={agreeTerms} onAgree={setAgreeTerms} red={termsErr} />}\n      <div className=\"flex flex-wrap items-center gap-3\">")).toBeGreaterThan(0);
    expect(src("app/app/find/[id]/page.tsx")).toContain("termsAgain={needsTermsAgain(u)}");
  });
});

describe("batch 20 section 22: a ticked part needs a price; Save looks disabled; the badges' words", () => {
  it("a ticked part with a blank price is refused with its line; the Free tick ($0) goes through", async () => {
    const { PART_PRICE_MISSING } = await import("@/lib/rules");
    const { listingBody } = await import("./fixtures");
    const { POST } = await import("@/app/api/tests/route");
    const dev = await makeUser({ dev: true, name: "Nora Lane" });
    let n = 0; // (batch 34 §7) different names
    const post = async (over: Record<string, unknown>) => json(await POST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ title: `Harbor Run ${++n}`, ...over }) })));
    expect((await post({ writtenCents: "" })).body.error.message).toBe(PART_PRICE_MISSING.written);
    expect(PART_PRICE_MISSING.written).toBe("Enter a price for the written answers, or tick Free.");
    expect((await post({ recordingCents: " " })).body.error.message).toBe("Enter a price for the recording, or tick Free.");
    expect((await post({ liveRateCents: "" })).body.error.message).toBe("Enter an hourly rate for live calls, or tick Free.");
    expect((await post({ writtenCents: "0" })).status).toBe(200);
    expect((await post({ writtenCents: null, questions: [] })).status).toBe(200); // off: no price needed
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain('{...(on && !free ? { "data-required": "", "data-required-msg": PART_PRICE_MISSING[part.on] } : {})}');
    expect(form).toContain('<button className={`btn ${nothingChanged ? "!bg-white/10 !text-ink-400 !shadow-none" : ""}`} disabled={busy || nothingChanged}');
    expect(form).toContain('{keep.restored && !keep.signedIn && <NotSentTag label={edit ? "Not saved yet" : "Not posted yet"} />}');
    const { NotSentTag } = await import("@/lib/useKept");
    expect(html(createElement(NotSentTag, {}))).toContain("Draft"); // (batch 35 §8) it read "Not sent yet"
    expect(html(createElement(NotSentTag, { label: "Not saved yet" }))).toContain("Not saved yet");
  });
});

describe("batch 20 section 23: \"Worked with you on N tests\" says how each one went", () => {
  it("ended, left, finished, working, mixed", async () => {
    const { togetherState, workedWithLine, invitePanel } = await import("@/lib/server/invites");
    expect(togetherState({ status: "working" })).toBe("in it now");
    expect(togetherState({ status: "left" })).toBe("left");
    expect(togetherState({ status: "ended", endKind: "rated" })).toBe("finished");
    expect(togetherState({ status: "ended", endKind: "early" })).toBe("ended");
    expect(workedWithLine(2)).toBe("Worked with you on 2 tests");
    const a = await setup();
    const j = await joined(a.testId, "fbbb");
    await db.contract.update({ where: { id: j.sessionId }, data: { status: "ended", endKind: "blocked", endedAt: new Date() } });
    const b = await json(await (await import("@/app/api/tests/route")).POST(req("/api/tests", { cookie: a.dev.cookie, body: (await import("./fixtures")).listingBody({ title: "Sky Lab" }) })));
    const test2 = await db.test.findUniqueOrThrow({ where: { id: b.body.id } });
    expect((await act(test2.id, "join", j.tester.cookie, { listingVersion: test2.listingVersion })).status).toBe(200);
    const c = await setup();
    await db.test.update({ where: { id: c.testId }, data: { developerId: a.dev.user.id } });
    const panel = await invitePanel(a.dev.user.id, c.testId);
    const row = panel.worked.find((x) => x.id === j.tester.user.id)!;
    expect(row.together.map((x) => `${x.title} · ${x.state}`).sort()).toEqual(["Harbor Run · ended", "Sky Lab · in it now"]);
    expect(src("app/app/tests/[id]/InvitePanel.tsx")).toContain("Worked with you on {t.together.length} test");
  });
});

describe("batch 20 section 24: a tester's rating updates the developer's pages live; only a working tester's (they leave) stops once", () => {
  it("an ended tester rates: the live line with the window, Needs you's Rate row, Invite straight through; a working tester rates: one Testers-leaving stop", async () => {
    const R = await import("@/lib/rules");
    expect(R.finishedAndRatedLine("ff")).toBe("ff finished their part (rated you)");
    expect(R.ratedYouLiveLine("ff", "Nov 12, 2026")).toBe("ff rated you. You can rate them until Nov 12, 2026.");
    expect(R.rateNeedsLine("ff", new Date(Date.now() + 14 * 86_400_000 - 1000))).toBe("Rate ff · 14 days left");
    const { ALERT_TYPES, alertOf } = await import("@/lib/alerts");
    expect(ALERT_TYPES.map((a) => a.label)).not.toContain("Ratings from testers");
    expect(alertOf("rated")).toBeNull();
    expect((R.DEV_QUIET_KINDS as readonly string[]).includes("rated")).toBe(true);
    expect((R.DEV_STOP_KINDS as readonly string[]).includes("rated")).toBe(false);
    const { dev, testId } = await setup({ spots: 5 });
    const ended = await joined(testId, "ff");
    await sact(ended.sessionId, "written", ended.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: ended.sessionId } });
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    await act(testId, "end-early", dev.cookie, { contractIds: [ended.sessionId], reason: "Thanks, that's enough.", seenAt: seen(), confirmed: true });
    await later();
    const loaded = seen();
    await later();
    expect((await sact(ended.sessionId, "rate", ended.tester.cookie, { stars: 4, seenAt: seen(), confirmed: true })).status).toBe(200);
    const live = await json(await liveGET(req(`/api/live?scope=test:${testId}&since=${encodeURIComponent(loaded)}`, { cookie: dev.cookie, method: "GET" })));
    expect(live.body.changes.map((c: { text: string }) => c.text).some((t: string) => /^ff rated you\. You can rate them (until |once)/.test(t))).toBe(true);
    const other = await makeUser({ tester: true, name: "Gil" });
    const inv = await act(testId, "invite", dev.cookie, { testerIds: [other.user.id], seenAt: loaded, tab: "B" });
    expect(texts(inv)).toEqual([]);
    expect(src("app/app/tests/[id]/page.tsx")).toContain("{rateNeeds.map((r) => <p key={`rate-need-${r.id}`} className=\"text-sm\" data-rate-need={r.id}><a href={`#rate-${r.id}`}>{r.line}</a></p>)}");
    // A working tester who rates leaves: one stop line under Testers leaving.
    const w = await joined(testId, "Hal");
    await sact(w.sessionId, "written", w.tester.cookie, { answers: ["a", "b"] });
    const sub2 = await db.submission.findFirstOrThrow({ where: { contractId: w.sessionId } });
    await pay(dev.cookie, { kind: "submission", id: sub2.id, amount: "10.00", tickedCents: 1000 });
    await later();
    const loaded2 = seen();
    await later();
    expect((await sact(w.sessionId, "rate", w.tester.cookie, { stars: 5, seenAt: seen(), confirmed: true })).status).toBe(200);
    const third = await makeUser({ tester: true, name: "Ivo" });
    const stop = await act(testId, "invite", dev.cookie, { testerIds: [third.user.id], seenAt: loaded2, tab: "B" });
    expect(texts(stop)).toEqual(["Hal finished their part (rated you)"]);
    await db.user.update({ where: { id: dev.user.id }, data: { ignoredAlerts: ["leaving"] } });
    expect(texts(await act(testId, "invite", dev.cookie, { testerIds: [third.user.id], seenAt: loaded2, tab: "B" }))).toEqual([]);
  });
});

describe("batch 20 section 25: a tester's Switch / Keep never stops the developer", () => {
  it("a Switch while the developer's page is open: a quiet live line (never joining a stop box), no stop on any press; Keep: nothing", async () => {
    const { decideTerms } = await import("@/lib/server/terms");
    const { dev, testId } = await setup();
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Ward", "he");
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { writtenCents: "12.00" }, seenAt: seen(), confirmed: true })).status).toBe(200);
    await later();
    const loaded = seen();
    await later();
    for (const [x, choice] of [[a, "switch"], [b, "keep"]] as const) {
      const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: x.sessionId, status: "open" } });
      await decideTerms({ id: x.tester.user.id }, x.sessionId, { offerId: offer.id, choice, seenAt: seen(), confirmed: true });
    }
    await later(); // (as above: let the database clock's last write settle before the live route's "now")
    const live = await json(await liveGET(req(`/api/live?scope=test:${testId}&since=${encodeURIComponent(loaded)}`, { cookie: dev.cookie, method: "GET" })));
    const lines = live.body.changes as { text: string; quiet?: boolean }[];
    expect(lines.filter((l) => /terms/.test(l.text))).toEqual([expect.objectContaining({ text: "Ana Silva switched to the new terms", quiet: true })]);
    const t = await makeUser({ tester: true, name: "Gil" });
    expect(texts(await act(testId, "invite", dev.cookie, { testerIds: [t.user.id], seenAt: loaded, tab: "B" }))).toEqual([]);
    expect(texts(await act(testId, "end-early", dev.cookie, { contractIds: [b.sessionId], reason: "Thanks, that's enough.", seenAt: loaded, tab: "B" }))).toEqual([]);
    expect(src("lib/live.ts")).toContain("const added = ((e as CustomEvent<Change[]>).detail ?? []).filter((c) => !c.quiet);");
  });

  it("(audit) every developer stop kind has an Alerts type, except the deliberate always-stop ones", async () => {
    const { DEV_STOP_KINDS } = await import("@/lib/rules");
    const { alertOf } = await import("@/lib/alerts");
    expect([...DEV_STOP_KINDS].filter((k) => !alertOf(k))).toEqual(["chargeback", "subscription"]);
  });
});

describe("batch 20 section 26: Send my updated answers / recording waits until something changed", () => {
  it("sent → refused identical; edit → goes; a new attachment → goes; the buttons grey with the tooltip", async () => {
    const { NOTHING_CHANGED_LINE } = await import("@/lib/rules");
    expect(NOTHING_CHANGED_LINE).toBe("Nothing has changed since you sent it.");
    const { testId } = await setup();
    const j = await joined(testId);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"], notes: "n", seenAt: seen(), confirmed: true })).status).toBe(200);
    const same = await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"], notes: "n", seenAt: seen(), confirmed: true });
    expect(same.body.error).toMatchObject({ code: "unchanged", message: NOTHING_CHANGED_LINE });
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b2"], notes: "n", seenAt: seen(), confirmed: true })).status).toBe(200);
    // A new attachment uploaded since: goes.
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId, kind: "written" } });
    await db.recording.create({ data: { contractId: j.sessionId, storageKey: `k-${randomUUID()}`, filename: "shot.png", sizeBytes: 10, contentType: "image/png", uploadedAt: new Date(), part: "written" } });
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b2"], notes: "n", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await db.recording.count({ where: { contractId: j.sessionId, submissionId: sub.id } })).toBe(1);
    const form = src("app/app/sessions/[id]/SessionActions.tsx");
    expect(form).toContain("const unchanged = update && sentSame && !newFiles && same;");
    expect(form).toContain("title={unchanged ? NOTHING_CHANGED_LINE : undefined}");
    const rec = src("app/app/sessions/[id]/RecordingUpload.tsx");
    expect(rec).toContain("const unchanged = sentBefore && uploaded.every((r) => r.sent) && !removedSince;");
    expect(src("lib/server/recordings.ts")).toContain('throw new HttpError(409, "unchanged", NOTHING_CHANGED_LINE);');
  });
});

describe("batch 20 section 27: End early's and Stop's reason need at least 5 characters", () => {
  it("0, 4 and 5 characters for both", async () => {
    const { dev, testId } = await setup({ spots: 5 });
    const a = await joined(testId, "Ana Silva");
    const ee = (reason: string) => act(testId, "end-early", dev.cookie, { contractIds: [a.sessionId], reason, seenAt: seen(), confirmed: true });
    expect((await ee("")).body.error.message).toBe("Say why you're ending their work (they read it).");
    expect((await ee("Done")).body.error.message).toBe("Say a little more: at least 5 characters.");
    expect((await ee(" Done  ")).body.error.message).toBe("Say a little more: at least 5 characters.");
    expect((await ee("Done.")).status).toBe(200);
    const st = (reason: string) => act(testId, "stop", dev.cookie, { reason, seenAt: seen(), confirmed: true });
    expect((await st("")).body.error.message).toBe("Say why you're stopping the test (testers read it).");
    expect((await st("Over")).body.error.message).toBe("Say a little more: at least 5 characters.");
    expect((await st("Over.")).status).toBe(200);
    expect(src("components/WhyBox.tsx")).toContain("data-min-chars={String(WHY_MIN_CHARS)} data-msg={WHY_TOO_SHORT}");
    expect(src("app/app/tests/[id]/TopPanel.tsx")).toContain("disabled={busy || reason.trim().length < WHY_MIN_CHARS || !picked.length");
  });
});

describe("batch 20 section 28: Send isn't refused when the required question is answered", () => {
  it("an unlisted part's default question answered sends; a missing required answer is named (red at it); a short list never loses what was typed", async () => {
    const u = await setup({ writtenCents: null, questions: [] });
    const a = await joined(u.testId);
    expect((await sact(a.sessionId, "written", a.tester.cookie, { answers: ["ee"], notes: "" })).status).toBe(200);
    // (Batch 26 section 14) Required only when ticked.
    const l = await setup({ questions: ["One?", "[required] Two?", "Three?"] });
    const b = await joined(l.testId);
    const r = await sact(b.sessionId, "written", b.tester.cookie, { answers: ["x", "", "z"], notes: "" });
    expect(r.body.error).toMatchObject({ code: "bad_answers", message: "Answer every required question before sending.", missing: 1 });
    // Fewer answers than questions: the missing one is blank (named), never a count mismatch refusal for answered ones.
    const c = await setup({ questions: ["[required] One?", "Two?"] });
    const d = await joined(c.testId);
    expect((await sact(d.sessionId, "written", d.tester.cookie, { answers: ["x"], notes: "" })).status).toBe(200);
    const form = src("app/app/sessions/[id]/SessionActions.tsx");
    expect(form).toContain('const answers = questions.map((_, i) => answers0[i] ?? "");');
    expect(form).toContain("(missingAt != null ? document.getElementById(`a${missingAt}`) : null)");
    // (Batch 26 sections 11 and 14) The "*" right after the question's words, only on a Required question.
    expect(form).toContain('<label className="label flex items-start gap-0.5" htmlFor={`a${i}`} data-question-label=""><ScrollText className="min-w-0" text={qText(q)} label={`Question ${i + 1}`} />{qRequired(q) && <span className="req shrink-0" data-required-star="" aria-label="required" />}</label>');
  });
});
