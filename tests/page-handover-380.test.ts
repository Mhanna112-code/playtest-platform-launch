import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as claimGET, POST as claimPOST } from "@/app/api/page-claim/route";
import { POST as handoverPOST } from "@/app/api/page-handover/route";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { POST as testAction } from "@/app/api/tests/[id]/[action]/route";
import { BUSY_STALE_MS, HANDOVER_CAP_MS, HANDOVER_LINE, OWN_PAGES, PAGE_MOVED_CODE, joinScope, ownPageScope, profileScope, testScope } from "@/lib/pageClaim";
import { json, makeUser, req } from "./helpers";
import { seen, setup } from "./fixtures";

// (Owner, Nov 11, §380 J) The new-tab handover; (§380 K) the pages that are one at a time too.

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const claim = (cookie: string, scope: string, tab: string, now = false) => claimPOST(req("/api/page-claim", { cookie, body: { scope, ...(now ? { now: true } : {}) }, headers: { "x-tab": tab } })).then(json);
const handover = (cookie: string, scope: string, tab: string, release = false) => handoverPOST(req("/api/page-handover", { cookie, body: { scope, ...(release ? { release: true } : {}) }, headers: { "x-tab": tab } })).then(json);
const pulse = (cookie: string, query: string, scope: string, tab: string) => pulseGET(req(`/api/pulse?${query}`, { cookie, headers: { "x-tab": tab, "x-page": scope } })).then(json);
const act = (id: string, action: string, cookie: string, body: Record<string, unknown>, headers: Record<string, string>) =>
  testAction(req(`/api/tests/${id}/${action}`, { cookie, body, headers }), { params: Promise.resolve({ id, action }) }).then(json);
/** A press from the holder that locks its page (x-press): the holder is busy until it says "done". */
const busyPress = (id: string, cookie: string, scope: string, tab: string) => act(id, "invite-search", cookie, { q: "" }, { "x-tab": tab, "x-page": scope, "x-press": "1" });

describe("§380 J: the new-tab handover", () => {
  it("the old copy has a press on its way: the new copy waits; the old one says done (a copy is waiting), hands over, and the new copy holds the page", async () => {
    const { dev, testId } = await setup();
    const scope = testScope(testId);
    expect((await claim(dev.cookie, scope, "old")).body).toEqual({ claimed: true });
    expect((await busyPress(testId, dev.cookie, scope, "old")).status).toBe(200);
    expect((await db.pageClaim.findUniqueOrThrow({ where: { userId_scope: { userId: dev.user.id, scope } } })).busy).toBe(true);
    const w = await claim(dev.cookie, scope, "new");
    expect(w.body.claimed).toBe(false);
    expect(w.body.waiting).toBe(true);
    expect((await claim(dev.cookie, scope, "new")).body.waiting).toBe(true);
    // The old copy still holds the page while it finishes.
    expect((await pulse(dev.cookie, `test=${testId}`, scope, "old")).body.moved).toBeUndefined();
    // Its press is over: a copy is waiting; it keeps its drafts, then hands over.
    expect((await handover(dev.cookie, scope, "old")).body).toEqual({ wanted: true });
    expect((await claim(dev.cookie, scope, "new")).body.waiting).toBe(true); // still busy until it handed over
    expect((await handover(dev.cookie, scope, "old", true)).status).toBe(200);
    expect((await claim(dev.cookie, scope, "new")).body).toEqual({ claimed: true });
    expect((await pulse(dev.cookie, `test=${testId}`, scope, "old")).body.moved).toBe(true);
    const r = await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen() }, { "x-tab": "old", "x-page": scope });
    expect(r.body.error.code).toBe(PAGE_MOVED_CODE);
    expect((await handover(dev.cookie, scope, "old")).body).toEqual({ moved: true });
  });

  it("no press on its way: the new copy takes the page at once; a press that is over (done) frees it too; a free press never makes it wait", async () => {
    const { dev, testId } = await setup();
    const scope = testScope(testId);
    await claim(dev.cookie, scope, "a");
    expect((await claim(dev.cookie, scope, "b")).body).toEqual({ claimed: true });
    await claim(dev.cookie, scope, "a");
    await busyPress(testId, dev.cookie, scope, "a");
    expect((await handover(dev.cookie, scope, "a")).body).toEqual({}); // nobody waiting: just no longer busy
    expect((await claim(dev.cookie, scope, "b")).body).toEqual({ claimed: true });
    // Without x-press (the open bank check's own Confirm, a background request): never waited for.
    await claim(dev.cookie, scope, "a");
    await act(testId, "invite-search", dev.cookie, { q: "" }, { "x-tab": "a", "x-page": scope });
    expect((await claim(dev.cookie, scope, "b")).body).toEqual({ claimed: true });
  });

  it("the old copy is silent (closed or asleep): taken over at the cap; Open now takes it at once; a stale busy mark is never waited for", async () => {
    const { dev, testId } = await setup();
    const scope = testScope(testId);
    const where = { userId_scope: { userId: dev.user.id, scope } };
    await claim(dev.cookie, scope, "old");
    await busyPress(testId, dev.cookie, scope, "old");
    expect((await claim(dev.cookie, scope, "new")).body.waiting).toBe(true);
    await db.pageClaim.update({ where, data: { wantAt: new Date(Date.now() - HANDOVER_CAP_MS - 100) } });
    expect((await claim(dev.cookie, scope, "new")).body).toEqual({ claimed: true });
    // Open now.
    await claim(dev.cookie, scope, "old");
    await busyPress(testId, dev.cookie, scope, "old");
    expect((await claim(dev.cookie, scope, "new")).body.waiting).toBe(true);
    expect((await claim(dev.cookie, scope, "new", true)).body).toEqual({ claimed: true });
    // A busy mark from a copy gone long ago.
    await claim(dev.cookie, scope, "old");
    await busyPress(testId, dev.cookie, scope, "old");
    await db.pageClaim.update({ where, data: { beatAt: new Date(Date.now() - BUSY_STALE_MS - 100) } });
    expect((await claim(dev.cookie, scope, "new")).body).toEqual({ claimed: true });
  });

  it("the copies: the old one keeps its drafts and leaves once its press is over; Back (pageshow persisted) re-claims with the same handover; a waiting copy shows the line and Open now", () => {
    const one = src("components/OnePage.tsx");
    expect(one).toContain("const offIdle = onPressIdle(() => {");
    expect(one).toContain('await flushKept().catch(() => null);\n      await post("/api/page-handover", { scope, release: true });\n      leaveMovedPage();');
    expect(one).toMatch(/if \(!e\.persisted\) return;[\s\S]*releaseAll\(\);\s+resetMovedPage\(\);[\s\S]*void claim\(\)/);
    expect(one).toContain("<span>{HANDOVER_LINE}</span>");
    expect(one).toContain("{HANDOVER_OPEN_NOW}</button>");
    expect(HANDOVER_LINE).toBe("Saving changes in other tab…");
    expect(HANDOVER_CAP_MS).toBe(10_000);
    const client = src("lib/client.ts");
    expect(client).toContain('...(press && PAGE_SCOPE ? { "x-press": "1" } : {})');
    expect(client).toContain('w.dispatchEvent?.(new CustomEvent("kept-flush", { detail: { waits } }));');
  });

  it("the page lock tells when the page's presses are all over (answer and redraw)", async () => {
    const { onPressIdle, pressStarted, pressAnswered, holdForRedraw, redrawLanded, releaseAll } = await import("@/lib/pageLock");
    releaseAll();
    let n = 0;
    const off = onPressIdle(() => n++);
    pressStarted(undefined);
    pressAnswered(true);
    holdForRedraw();
    expect(n).toBe(0);
    redrawLanded();
    expect(n).toBe(1);
    pressStarted(undefined);
    pressAnswered(false);
    expect(n).toBe(2);
    off();
  });

  it("a moved copy keeps its drafts before it leaves", async () => {
    const { leaveMovedPage, resetMovedPage, setPageScope } = await import("@/lib/client");
    resetMovedPage();
    setPageScope("test:abc");
    const went: string[] = [];
    let flushed = 0;
    let done: () => void = () => {};
    const w = {
      document: { querySelectorAll: () => [], querySelector: () => null },
      location: { replace: (u: string) => went.push(u) },
      dispatchEvent: (e: CustomEvent<{ waits: Promise<unknown>[] }>) => {
        flushed++;
        e.detail.waits.push(new Promise<void>((r) => (done = r)));
        return true;
      },
    } as unknown as Window & typeof globalThis;
    expect(leaveMovedPage(w)).toBe(true);
    expect(flushed).toBe(1);
    expect(went).toEqual([]); // waits for the drafts
    done();
    await new Promise((r) => setTimeout(r, 0));
    expect(went).toEqual(["/app?moved=1"]);
    resetMovedPage();
  });
});

describe("§380 K: more pages are one at a time", () => {
  it("the join page (per test), Payments, Blocked people, Contact us, the profile and notifications settings, and each profile page", async () => {
    const { dev, testId } = await setup();
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    for (const scope of [joinScope(testId), ...OWN_PAGES.map(ownPageScope), profileScope("developer", dev.user.id), profileScope("tester", t.user.id)]) {
      expect((await claim(t.cookie, scope, "one")).status, scope).toBe(200);
      expect((await claim(t.cookie, scope, "two")).body, scope).toEqual({ claimed: true });
      const r = await claimGET(req(`/api/page-claim?scope=${encodeURIComponent(scope)}`, { cookie: t.cookie, headers: { "x-tab": "one" } })).then(json);
      expect(r.body.moved, scope).toBe(true);
    }
    expect((await claim(t.cookie, "page:settings", "x")).status).toBe(404); // the Settings index is not one
    expect((await claim(t.cookie, joinScope("nope"), "x")).status).toBe(404);
    // A page with its own poll (Payments): the poll says it moved.
    expect((await pulse(t.cookie, "fresh=payments", ownPageScope("payments"), "one")).body.moved).toBe(true);
    expect((await pulse(t.cookie, "fresh=payments", ownPageScope("payments"), "two")).body.moved).toBeUndefined();
    // Each page names itself; the dashboard, Find tests, chat, Post a test, the Settings index and the team console don't.
    for (const [f, mark] of [["app/app/find/[id]/page.tsx", "<OnePage scope={joinScope(t.id)} />"], ["app/app/payments/page.tsx", '<OnePage scope={ownPageScope("payments")} />'], ["app/app/account/blocked/page.tsx", '<OnePage scope={ownPageScope("blocked")} />'],
      ["app/app/help/page.tsx", '<OnePage scope={ownPageScope("contact")} poll />'], ["app/app/profile/page.tsx", '<OnePage scope={ownPageScope("profile")} poll />'], ["app/app/notifications/page.tsx", '<OnePage scope={ownPageScope("notifications")} />'],
      ["app/app/testers/[id]/page.tsx", '<OnePage scope={profileScope("tester", id)} />'], ["app/app/developers/[id]/page.tsx", '<OnePage scope={profileScope("developer", id)} />']] as const) expect(src(f), f).toContain(mark);
    for (const f of ["app/app/page.tsx", "app/app/find/page.tsx", "app/app/chat/[id]/page.tsx", "app/app/tests/new/page.tsx", "app/app/account/page.tsx", "app/admin/page.tsx"]) expect(src(f), f).not.toContain("<OnePage");
    expect(src("app/app/find/[id]/JoinWatch.tsx")).toContain("headers: pageHeaders()");
  });
});
