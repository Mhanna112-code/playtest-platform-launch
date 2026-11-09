import React, { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as sessionPOST } from "@/app/api/sessions/[id]/[action]/route";
import { PART_ENDED_TERMS, termsRowLines } from "@/lib/server/terms";
import { adminPage, type MineVM } from "@/lib/server/adminLists";
import { callCharge, testerShare } from "@/lib/rules";
import { money } from "@/lib/format";
import { goToMine } from "@/app/admin/MineLine";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => auth.user, requireOpenPage: async () => auth.user, adminAway: () => {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), redirect: () => { throw Error("redirect"); }, notFound: () => { throw Error("not found"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

async function serverTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(React.Children.toArray(node).map(serverTree));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (typeof element.type === "function" && element.type.constructor.name === "AsyncFunction") {
    const resolved = await (element.type as (props: unknown) => Promise<ReactNode>)(element.props);
    return serverTree(isValidElement(resolved) && element.key !== null ? cloneElement(resolved, { key: element.key }) : resolved);
  }
  return element.props.children === undefined ? element : cloneElement(element, {}, await serverTree(element.props.children));
}
async function dashboard(user: User) {
  auth.user = user;
  const { default: Page } = await import("@/app/app/page");
  return renderToStaticMarkup(await serverTree(await Page({ searchParams: Promise.resolve({}) })));
}

const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "../src", p), "utf8");
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  return act(testId, "edit", cookie, { version: v, fields, seenAt: seen(), confirmed: true });
};
const pay = (cookie: string, id: string) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), kind: "submission", id, amount: "10.00", tickedCents: 1000, confirmed: true } })).then(json);
const rate = (sessionId: string, cookie: string) => {
  const at = seen();
  return sessionPOST(req(`/api/sessions/${sessionId}/rate`, { cookie, body: { stars: 5, seenAt: at, pageSeenAt: at, loadedAt: at, confirmed: true } }), { params: Promise.resolve({ id: sessionId, action: "rate" }) }).then(json);
};
/** A working tester with an open new-terms offer. */
async function offered(sendWritten = false) {
  const s = await setup();
  const j = await joined(s.testId, "Ana Silva", "they");
  if (sendWritten) expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
  await settle();
  expect((await edit(s.testId, s.dev.cookie, { writtenCents: "12.00" })).status).toBe(200);
  await settle();
  const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: j.sessionId, status: "open" } });
  return { ...s, ...j, offer };
}

describe("batch 35 §118 (1): a part that ended closes its new-terms offer", () => {
  it("Leave closes the open offer; an old page's Switch is refused plainly; the developer's row says closed", async () => {
    const x = await offered();
    expect((await sact(x.sessionId, "leave", x.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    const o = await db.termsOffer.findUniqueOrThrow({ where: { id: x.offer.id } });
    expect(o.status).toBe("closed");
    expect(o.decidedAt).not.toBeNull();
    const r = await sact(x.sessionId, "terms", x.tester.cookie, { choice: "switch", offerId: x.offer.id, seenAt: seen(), confirmed: true });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toBe(PART_ENDED_TERMS);
    expect(r.body.error.message).toBe("Your part on this test has ended, so these terms no longer apply.");
    // Nothing switched.
    expect((await db.contract.findUniqueOrThrow({ where: { id: x.sessionId } })).termsSwitchedAt).toBeNull();
    expect((await termsRowLines([x.sessionId])).get(x.sessionId)).toMatch(/\(closed: their part ended\)$/);
  });

  it("rating the test closes the offer; Keep from an old page is refused; the dashboard has no Switch or keep row", async () => {
    const x = await offered(true);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: x.sessionId } });
    expect((await pay(x.dev.cookie, sub.id)).status).toBe(200);
    await settle();
    const r = await rate(x.sessionId, x.tester.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await db.contract.findUniqueOrThrow({ where: { id: x.sessionId } })).status).toBe("left");
    expect((await db.termsOffer.findUniqueOrThrow({ where: { id: x.offer.id } })).status).toBe("closed");
    const k = await sact(x.sessionId, "terms", x.tester.cookie, { choice: "keep", offerId: x.offer.id, seenAt: seen(), confirmed: true });
    expect(k.body.error?.message).toBe(PART_ENDED_TERMS);
    const html = await dashboard(x.tester.user);
    expect(html).not.toContain("Switch or keep your terms");
  });

  it("an ended part whose offer row was left open (older data) never shows Switch or keep, and a press closes it", async () => {
    const x = await offered();
    await db.contract.update({ where: { id: x.sessionId }, data: { status: "left", endKind: "rated", endedAt: new Date() } });
    expect(await dashboard(x.tester.user)).not.toContain("Switch or keep your terms");
    const r = await sact(x.sessionId, "terms", x.tester.cookie, { choice: "switch", offerId: x.offer.id, seenAt: seen(), confirmed: true });
    expect(r.body.error?.message).toBe(PART_ENDED_TERMS);
    expect((await db.termsOffer.findUniqueOrThrow({ where: { id: x.offer.id } })).status).toBe("closed");
  });

  // (Codex eb8ca7cd, docs/NOV7-DASHBOARD-CHANGES.md) To do is one row per working test with no Switch/Keep: the offer is answered on the session page.
  it("a working tester's offer: the test stays in To do (Switch or keep is on its session page)", async () => {
    const x = await offered();
    const html = await dashboard(x.tester.user);
    expect(html).toContain(`data-todo-test="${x.sessionId}"`);
    expect(html).not.toContain("Switch or keep your terms");
  });

  it("every place a contract ends closes its offers", () => {
    for (const f of ["lib/server/ratings.ts", "lib/server/tests.ts", "lib/server/restrictions.ts", "lib/server/workWindow.ts", "lib/server/pauseClosure.ts", "lib/server/blocks.ts"]) expect(src(f), f).toContain("closeOffersOfEnded(");
    // Leave, Stop and End early in tests.ts; removal and both team stops in restrictions.ts.
    expect(src("lib/server/tests.ts").match(/closeOffersOfEnded\(/g)).toHaveLength(3);
    expect(src("lib/server/restrictions.ts").match(/closeOffersOfEnded\(/g)).toHaveLength(3);
  });
});

describe("batch 35 §118 (2): a call that took place waits for review on the tester's dashboard", () => {
  it("lists the call, counts its amount and counts it as a part", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva", "they");
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie);
    const startsAt = new Date(Date.now() - 2 * 3_600_000);
    await db.call.update({ where: { id: call.id }, data: { startsAt, measuredAt: new Date(Date.now() - 3_600_000), measuredMinutes: 25 } });
    const html = await dashboard(j.tester.user);
    expect(html).toContain(`data-waiting-call="${call.id}"`);
    expect(html).toContain(`href="/app/sessions/${j.sessionId}#call-${call.id}"`);
    expect(html).toMatch(/Live call on [A-Z][a-z]{2} \d{1,2} · 25 min: waiting for review/);
    const callCents = testerShare(callCharge(call.rateCents!, 25));
    expect(html).toContain(`data-waiting-call-amount="">${money(callCents)}<`);
    expect(html).toContain("2 parts");
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    const { compactMoney } = await import("@/lib/format");
    expect(html).toContain(compactMoney(testerShare(sub.agreedCents!) + callCents));
  });

  it("an unlisted call shows no amount; a paid call or one still being measured isn't listed", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva", "they");
    const a = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 48);
    const b = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 72);
    const past = new Date(Date.now() - 3 * 3_600_000);
    await db.call.update({ where: { id: a.id }, data: { startsAt: past, measuredAt: new Date(), measuredMinutes: 20, rateCents: null } });
    await db.call.update({ where: { id: b.id }, data: { startsAt: past, measuredAt: null, measuredMinutes: null } });
    const html = await dashboard(j.tester.user);
    expect(html).toContain(`data-waiting-call="${a.id}"`);
    expect(html).not.toContain(`data-waiting-call="${b.id}"`);
    expect(html).not.toContain("data-waiting-call-amount");
    expect(html).toContain("1 part");
  });
});

describe("batch 35 §118 (3): Your actions jump to their row on the console", () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
  });

  it("a test still paused jumps to Tests you paused; a suspended account to Suspensions; a stopped test opens its page", async () => {
    const ad = await makeUser({ name: "Team Admin" });
    await db.user.update({ where: { id: ad.user.id }, data: { isAdmin: true } });
    const paused = await setup();
    await db.test.update({ where: { id: paused.testId }, data: { adminPausedAt: new Date(), adminPausedById: ad.user.id } });
    const stopped = await setup();
    await db.test.update({ where: { id: stopped.testId }, data: { status: "stopped", stoppedAt: new Date(), adminStoppedAt: new Date(), adminStoppedById: ad.user.id } });
    const t = await makeUser({ tester: true, name: "Sam Reed" });
    const at = new Date();
    await db.user.update({ where: { id: t.user.id }, data: { testerSuspendedAt: at } });
    await db.accountEvent.create({ data: { userId: t.user.id, kind: "suspended", side: "tester", byId: ad.user.id, note: "spam", createdAt: at } });
    const rows = (await adminPage("mine", ad.user.id, null)).rows as unknown as MineVM[];
    const p = rows.find((r) => r.testId === paused.testId)!;
    expect(p.jump).toBe(`mypaused-${paused.testId}`);
    expect(p.href).toBe(`/app/find/${paused.testId}`);
    const st = rows.find((r) => r.testId === stopped.testId)!;
    expect(st.jump).toBeUndefined();
    const acct = rows.find((r) => r.id.startsWith("acct-"))!;
    expect(acct.jump).toBe(`suspension-${t.user.id}`);
    // A lifted suspension has no row in Suspensions (and leaves Your actions).
    await db.user.update({ where: { id: t.user.id }, data: { testerSuspendedAt: null } });
    expect(((await adminPage("mine", ad.user.id, null)).rows as unknown as MineVM[]).some((r) => r.jump === `suspension-${t.user.id}`)).toBe(false);
  });

  it("the line's links point at the same-page anchor and only open the page when that row isn't there", () => {
    const line = src("app/admin/MineLine.tsx");
    expect(line).toContain("href={`#${jump}`}");
    expect(src("app/admin/PagedList.tsx")).toContain("<MineLine m={m} />");
    // The rows it jumps to carry their ids and the See it ring.
    expect(src("app/admin/PagedList.tsx")).toMatch(/id=\{`mypaused-\$\{t\.id\}`\}[^>]*data-\[marked\]:ring-2/);
    expect(src("app/admin/PagedList.tsx")).toMatch(/id=\{`suspension-\$\{u\.id\}`\}[^>]*data-\[marked\]:ring-2/);
    const el = { parentElement: null, scrollIntoView: vi.fn(), setAttribute: vi.fn(), removeAttribute: vi.fn(), querySelectorAll: vi.fn(() => []) }; // (§139) folds under the row open too
    const assign = vi.fn();
    const ids = new Map<string, unknown>([["mypaused-t1", el]]);
    (globalThis as { document?: unknown }).document = { getElementById: (id: string) => ids.get(id) ?? null };
    (globalThis as { window?: unknown }).window = { location: { assign } };
    (globalThis as { HTMLDetailsElement?: unknown }).HTMLDetailsElement ??= class {};
    goToMine("mypaused-t1", "/app/find/t1");
    expect(el.scrollIntoView).toHaveBeenCalled();
    expect(el.setAttribute).toHaveBeenCalledWith("data-marked", "");
    expect(assign).not.toHaveBeenCalled();
    goToMine("suspension-u9", "/app/testers/u9");
    expect(assign).toHaveBeenCalledWith("/app/testers/u9");
  });
});
