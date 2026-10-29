import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { signUp } from "@/lib/server/passwords";
import { TERMS_AGREE_LABEL, TERMS_CHANGED_HREF, TERMS_UPDATED_CODE, TERMS_UPDATED_LINE, TERMS_VERSION, WHAT_CHANGED, WHAT_CHANGED_ID } from "@/lib/termsOfUse";
import { json, makeUser, req } from "./helpers";
import { act, joined, listingBody, sact, seen, setup } from "./fixtures";

// Batch 18 sections 1 and 2 (owner, Oct 28 evening): re-accepting updated Terms of Use, and the Terms' content rule matching the Mature line.
const src = (p: string) => fs.readFileSync(path.join(__dirname, "..", "src", p), "utf8");
const lv = async (testId: string) => (await db.test.findUniqueOrThrow({ where: { id: testId } })).listingVersion;
const oldTerms = (userId: string) => db.user.update({ where: { id: userId }, data: { termsVersion: TERMS_VERSION - 1 } });
const versionOf = async (userId: string) => (await db.user.findUniqueOrThrow({ where: { id: userId } })).termsVersion;
const refusedForTerms = (r: { status: number; body: { error?: { code: string; message: string } } }) => {
  expect(r.status).toBe(409);
  expect(r.body.error).toMatchObject({ code: TERMS_UPDATED_CODE, message: TERMS_UPDATED_LINE });
};

describe("batch 18 section 1: re-accepting updated Terms of Use", () => {
  it("the version: stored at sign-up; the constant is 2 after section 2's change; the box's words", async () => {
    expect(TERMS_VERSION).toBe(2);
    expect(TERMS_UPDATED_LINE).toBe("We updated our Terms of Use. Read what changed.");
    expect(TERMS_AGREE_LABEL).toBe("I agree to the updated Terms");
    expect(TERMS_CHANGED_HREF).toBe("/terms#what-changed");
    const r = await signUp({ email: `terms-${Date.now()}@test.playtest.test`, password: "longenough1", role: "tester", name: "Ana Silva", acceptTerms: "yes" }, "http://localhost:3400");
    const u = await db.user.findUniqueOrThrow({ where: { id: r.user.id } });
    expect(u.termsVersion).toBe(TERMS_VERSION);
    expect(u.termsAcceptedAt).not.toBeNull();
  });

  it("Post a test: unticked is refused with the box's line; ticked posts and records the version; the next post needs nothing", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane", termsVersion: 1 });
    refusedForTerms(await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody() }))));
    expect(await db.test.count({ where: { developerId: dev.user.id } })).toBe(0);
    const ok = await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ agreeTerms: true }) })));
    expect(ok.status).toBe(200);
    expect(await versionOf(dev.user.id)).toBe(TERMS_VERSION);
    expect((await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ title: "Second" }) })))).status).toBe(200);
  });

  it("post a draft (Next round's draft): refused unticked, goes through ticked", async () => {
    const { dev, testId } = await setup();
    const draft = await act(testId, "next-round", dev.cookie, { seenAt: seen(), confirmed: true });
    expect(draft.status).toBe(200);
    await oldTerms(dev.user.id);
    refusedForTerms(await act(draft.body.id, "post-draft", dev.cookie, listingBody({ title: "Round 2" })));
    expect((await db.test.findUniqueOrThrow({ where: { id: draft.body.id } })).status).toBe("draft");
    expect((await act(draft.body.id, "post-draft", dev.cookie, listingBody({ title: "Round 2", agreeTerms: true }))).status).toBe(200);
    expect(await versionOf(dev.user.id)).toBe(TERMS_VERSION);
  });

  it("Join: refused unticked (nothing joined), ticked joins", async () => {
    const { testId } = await setup();
    const ana = await makeUser({ tester: true, name: "Ana Silva", termsVersion: 1 });
    refusedForTerms(await act(testId, "join", ana.cookie, { listingVersion: await lv(testId) }));
    expect(await db.contract.count({ where: { testId, testerId: ana.user.id } })).toBe(0);
    const ok = await act(testId, "join", ana.cookie, { listingVersion: await lv(testId), agreeTerms: true });
    expect(ok.status).toBe(200);
    expect(await versionOf(ana.user.id)).toBe(TERMS_VERSION);
  });

  it("Apply: refused unticked, ticked applies", async () => {
    const { testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", termsVersion: 0 }); // never accepted (a Google sign-up): asked the same way
    refusedForTerms(await act(testId, "apply", ana.cookie, { note: "I love boat games" }));
    expect(await db.application.count({ where: { testId, testerId: ana.user.id } })).toBe(0);
    expect((await act(testId, "apply", ana.cookie, { note: "I love boat games", agreeTerms: true })).status).toBe(200);
  });

  it("Accept an invite (Join with the invite): refused unticked, ticked joins on it", async () => {
    const { dev, testId } = await setup({ joinMode: "invite" });
    const ben = await makeUser({ tester: true, name: "Ben Carter", termsVersion: 1 });
    expect((await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [ben.user.id] })).status).toBe(200);
    const inv = await db.invite.findFirstOrThrow({ where: { testId, testerId: ben.user.id, status: "sent" } });
    const body = { inviteId: inv.id, listingVersion: await lv(testId), seenAt: seen(), confirmed: true };
    refusedForTerms(await act(testId, "join", ben.cookie, body));
    expect((await db.invite.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("sent");
    expect((await act(testId, "join", ben.cookie, { ...body, agreeTerms: true })).status).toBe(200);
    expect((await db.invite.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("joined");
  });

  it("Ask to rejoin: refused unticked, ticked asks", async () => {
    const { testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    expect((await sact(sessionId, "leave", tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    await oldTerms(tester.user.id);
    const body = { listingVersion: await lv(testId), seenAt: seen(), confirmed: true, anyway: true };
    refusedForTerms(await act(testId, "rejoin-ask", tester.cookie, body));
    expect(await db.application.count({ where: { testId, testerId: tester.user.id } })).toBe(0);
    expect((await act(testId, "rejoin-ask", tester.cookie, { ...body, agreeTerms: true })).body).toEqual({ asked: true });
  });

  it("nothing else is blocked: work, chat, Edit and Stop carry on under the terms they started with", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await oldTerms(tester.user.id);
    await oldTerms(dev.user.id);
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
    expect((await sact(sessionId, "message", tester.cookie, { body: "Sent!" })).status).toBe(200);
    expect((await act(testId, "message", dev.cookie, { contractId: sessionId, body: "Thanks" })).status).toBe(200);
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { description: "Sail further" }, confirmed: true })).status).toBe(200);
    expect((await act(testId, "stop", dev.cookie, { reason: "We found what we needed.", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await versionOf(tester.user.id)).toBe(TERMS_VERSION - 1);
    expect(await versionOf(dev.user.id)).toBe(TERMS_VERSION - 1);
  });

  it("the pages: the box (link + tick) under Post the test and Join / Apply / Ask to rejoin, sending the tick with the press", () => {
    const box = src("components/TermsAgainBox.tsx");
    expect(box).toContain("We updated our Terms of Use. <a href={TERMS_CHANGED_HREF}");
    expect(box).toContain("Read what changed.</a>");
    expect(box).toContain("{TERMS_AGREE_LABEL}");
    const join = src("app/app/find/[id]/JoinBox.tsx");
    expect(join).toContain("{termsAsk && <TermsAgainBox agreed={agreeTerms} onAgree={setAgreeTerms} />}");
    expect(join.match(/inviteId, agreeTerms \}/g)).toHaveLength(2); // the button's press and the needs pop-up's
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain("{termsAsk && !edit && <TermsAgainBox agreed={agreeTerms} onAgree={setAgreeTerms} />}");
    expect(form).toContain("timeZone: browserZone(), agreeTerms });");
  });
});

describe("batch 18 section 2: the Terms' content rule matches the Mature line", () => {
  it("reworded, DRAFT kept, the version shown, and a short What changed note at the top (the box's link opens there)", () => {
    const terms = src("app/terms/page.tsx");
    expect(terms).not.toContain("No graphic content");
    expect(terms).toContain("\"Never allowed: sexual content involving minors, illegal content, real-world gore. Other graphic or mature content must be marked Mature (18+), with a reason.\"");
    expect(terms).toContain("Version {TERMS_VERSION} · DRAFT");
    expect(terms).toContain("<section id={WHAT_CHANGED_ID}");
    expect(WHAT_CHANGED_ID).toBe("what-changed");
    expect(WHAT_CHANGED[0].version).toBe(TERMS_VERSION);
    expect(WHAT_CHANGED[0].points[0]).toContain("Never allowed: sexual content involving minors, illegal content, real-world gore.");
    // The same rule as Post / Edit's Mature line.
    expect(src("app/app/tests/TestForm.tsx")).toContain("Never allowed: sexual content involving minors, illegal content, real-world gore.");
  });
});
