import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as claimPOST } from "@/app/api/page-claim/route";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { POST as testAction } from "@/app/api/tests/[id]/[action]/route";
import { PAGE_MOVED_CODE, PAGE_MOVED_LINE, testScope } from "@/lib/pageClaim";
import { json, req } from "./helpers";
import { seen, setup } from "./fixtures";

// (Owner, Dec 10 2026) A copy whose claim failed (offline at open) claims again when the connection returns and before its next press, like a fresh open, except
// the copy opened later wins: another copy that claimed after this one loaded keeps the page (`moved`). Its presses name the page all along (x-page), so one
// that does go out while another tab holds the page is refused. The page side: tests/claim-again-page-380.test.ts.

const claim = (cookie: string, scope: string, tab: string, extra: Record<string, unknown> = {}) =>
  claimPOST(req("/api/page-claim", { cookie, body: { scope, ...extra }, headers: { "x-tab": tab } })).then(json);
const pulse = (cookie: string, testId: string, scope: string, tab: string) => pulseGET(req(`/api/pulse?test=${testId}`, { cookie, headers: { "x-tab": tab, "x-page": scope } })).then(json);
const stop = (id: string, cookie: string, tab: string, scope: string) =>
  testAction(req(`/api/tests/${id}/stop`, { cookie, body: { reason: "We have what we need.", seenAt: seen() }, headers: { "x-tab": tab, "x-page": scope, "x-press": "1" } }), { params: Promise.resolve({ id, action: "stop" }) }).then(json);
const busyPress = (id: string, cookie: string, scope: string, tab: string) =>
  testAction(req(`/api/tests/${id}/invite-search`, { cookie, body: { q: "" }, headers: { "x-tab": tab, "x-page": scope, "x-press": "1" } }), { params: Promise.resolve({ id, action: "invite-search" }) }).then(json);

describe("(owner, Dec 10 2026) claiming again after a failed claim", () => {
  it("nobody claimed since this copy loaded (no claim yet, or an older copy's): claims as a fresh open; its own claim simply holds", async () => {
    const { dev, testId } = await setup();
    const scope = testScope(testId);
    const where = { userId_scope: { userId: dev.user.id, scope } };
    // Nobody has claimed it.
    expect((await claim(dev.cookie, scope, "late", { loadedAgo: 5_000 })).body).toEqual({ claimed: true });
    // An older copy claimed before this copy loaded (two minutes ago; this one loaded a minute ago): taken at once.
    expect((await claim(dev.cookie, scope, "old")).body).toEqual({ claimed: true });
    await db.pageClaim.update({ where, data: { claimedAt: new Date(Date.now() - 120_000) } });
    expect((await claim(dev.cookie, scope, "late", { loadedAgo: 60_000 })).body).toEqual({ claimed: true });
    expect((await pulse(dev.cookie, testId, scope, "old")).body.moved).toBe(true);
    // ... and with a press on its way there: waits for it, as a fresh open does.
    expect((await claim(dev.cookie, scope, "old")).body).toEqual({ claimed: true });
    await busyPress(testId, dev.cookie, scope, "old");
    await db.pageClaim.update({ where, data: { claimedAt: new Date(Date.now() - 120_000) } });
    expect((await claim(dev.cookie, scope, "late", { loadedAgo: 60_000 })).body).toMatchObject({ claimed: false, waiting: true });
    // This copy's own claim (claimed after it loaded, by itself): holds it.
    expect((await claim(dev.cookie, scope, "mine", { now: true })).body).toEqual({ claimed: true });
    expect((await claim(dev.cookie, scope, "mine", { loadedAgo: 60_000 })).body).toEqual({ claimed: true });
  });

  it("another copy claimed the page after this copy loaded: this copy doesn't take it (moved), not even with Open now", async () => {
    const { dev, testId } = await setup();
    const scope = testScope(testId);
    expect((await claim(dev.cookie, scope, "newer")).body).toEqual({ claimed: true });
    expect((await claim(dev.cookie, scope, "late", { loadedAgo: 5_000 })).body).toEqual({ claimed: false, moved: true });
    expect((await claim(dev.cookie, scope, "late", { loadedAgo: 5_000, now: true })).body).toEqual({ claimed: false, moved: true });
    expect((await db.pageClaim.findUniqueOrThrow({ where: { userId_scope: { userId: dev.user.id, scope } } })).tabId).toBe("newer");
    expect((await pulse(dev.cookie, testId, scope, "newer")).body.moved).toBeUndefined();
    // A fresh open (no loadedAgo) is the newest copy: it takes the page as before.
    expect((await claim(dev.cookie, scope, "late")).body).toEqual({ claimed: true });
  });

  it("a press from a copy that never claimed (its claim failed) names its page: refused with the one line while another tab holds it, allowed when nobody claimed it", async () => {
    const { dev, testId } = await setup();
    const scope = testScope(testId);
    await claim(dev.cookie, scope, "holder");
    const r = await stop(testId, dev.cookie, "unclaimed", scope);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe(PAGE_MOVED_CODE);
    expect(r.body.error.message).toBe(PAGE_MOVED_LINE);
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).status).toBe("open");
    expect((await db.pageClaim.findUniqueOrThrow({ where: { userId_scope: { userId: dev.user.id, scope } } })).busy).toBe(false); // never marks the holder busy
    // Nobody claimed the page (as before): the press goes ahead.
    const other = await setup();
    expect((await stop(other.testId, other.dev.cookie, "unclaimed", testScope(other.testId))).status).toBe(200);
  });
});
