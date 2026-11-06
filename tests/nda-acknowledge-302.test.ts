import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { NdaNotice } from "@/components/NdaNotice";
import { Err } from "@/components/Err";
import { api, ApiError, offerShown, PRESS_REFUSED_EVENT } from "@/lib/client";
import { refusalLine } from "@/lib/pressLabels";
import { lineFallbacks } from "@/lib/lineAnchors";
import { NDA_BLOCK_CODE, NDA_BLOCK_EVENT, NDA_BLOCK_FIRST, ndaBlockedPath, ndaChangedLine, ndaNoticeHref, ndaNoticeLine } from "@/lib/ndaNotice";
import { act, joined, sact, seen, settle, setup } from "./fixtures";
import { json, makeUser, req } from "./helpers";

// (Owner, Nov 6, batch 35 §302) Every NDA save (added, removed or changed) blocks the tester's presses on the test, except Rate and Leave, like an open contract
// change: the press is refused with one short line, "Acknowledge the NDA change first.", and the page goes up to the NDA notice and marks it. One notice: "<dev>
// changed the NDA. Click here to acknowledge you've seen the change." (the same words for added, removed and changed), the line a link to the NDA (#info-nda, navigation only), with ONE
// button, Acknowledge, which records it (an added NDA: accepted too) and lifts the block at once. The bell / top box: "<dev> changed the NDA", to the notice.
// Testers who join afterwards accept at join and are never blocked.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/s", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const NDA = "Keep it secret.";
const KINDS = ["added", "removed", "changed"] as const;
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  const r = await act(testId, "edit", cookie, { version: v, fields, seenAt: seen(), confirmed: true });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  await settle();
};
const sessionPage = async (sessionId: string, userId: string) => {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
  return unescape(renderToStaticMarkup(await SessionPage({ params: Promise.resolve({ id: sessionId }) })));
};
async function joinedNda(testId: string, name: string) {
  const t = await makeUser({ tester: true, name, pronoun: "she" });
  const test = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const r = await act(testId, "join", t.cookie, { listingVersion: test.listingVersion, ndaAccepted: true });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  await settle();
  return { tester: t, sessionId: r.body.sessionId as string };
}
/** A working tester, then the Save that makes `kind` of NDA change. */
async function changed(kind: (typeof KINDS)[number]) {
  const s = await setup(kind === "added" ? {} : { ndaText: NDA });
  const j = kind === "added" ? await joined(s.testId) : await joinedNda(s.testId, "Ana Silva");
  await edit(s.testId, s.dev.cookie, { ndaText: kind === "added" ? NDA : kind === "removed" ? "" : "Keep it very secret." });
  return { ...s, ...j };
}
const press = (sessionId: string, cookie: string, action: string, body: Record<string, unknown> = {}) => sact(sessionId, action, cookie, { seenAt: seen(), ...body });

describe("§302 every NDA change blocks like new terms", () => {
  it.each(KINDS)("%s: every press is refused with the one terms-like line, its code and the session to go to", async (kind) => {
    const x = await changed(kind);
    expect(await db.termsOffer.count({ where: { contractId: x.sessionId } })).toBe(0);
    for (const [action, body] of [["request-time", {}], ["message", { body: "hi" }], ["written-add", { text: "more", question: "else" }], ["recording-send", {}]] as const) {
      const r = await press(x.sessionId, x.tester.cookie, action, body);
      expect(r.status, `${action}: ${JSON.stringify(r.body)}`).toBe(409);
      expect(r.body.error).toMatchObject({ code: NDA_BLOCK_CODE, message: NDA_BLOCK_FIRST, sessionId: x.sessionId });
    }
    // The bell: "Nora Lane changed the NDA" whatever the kind, linking to the session page's notice.
    const bell = await db.notification.findMany({ where: { userId: x.tester.user.id, text: { contains: "NDA" } } });
    expect(bell.map((b) => [b.text, b.link])).toEqual([["Nora Lane changed the NDA", `/app/sessions/${x.sessionId}#nda-notice`]]);
    // The page: the notice, blocking; (§314) its line is the press, no button.
    const page = await sessionPage(x.sessionId, x.tester.user.id);
    expect(page).toContain(`id="nda-notice"`);
    expect(page).toContain(`data-nda-block="${kind}"`);
    expect(page).toContain('<a href="#info-nda" role="button" data-nda-ack="">');
    expect(page).not.toContain(">Acknowledge</button>");
  });

  it("the words: the line, the bell / top box line and the refusal", () => {
    expect(ndaChangedLine("fbbb")).toBe("fbbb changed the NDA");
    expect(ndaNoticeLine("fbbb")).toBe("fbbb changed the NDA. Click here to acknowledge you've seen the change.");
    expect(ndaNoticeHref("s1")).toBe("/app/sessions/s1#nda-notice");
    // Under the pressed button exactly as it is (never "Your Send didn't go through: …"), like "Answer the new terms first: Switch or Keep.".
    expect(refusalLine("Request a time", NDA_BLOCK_FIRST)).toBe("Acknowledge the NDA change first.");
    expect(unescape(renderToStaticMarkup(h(Err, { text: NDA_BLOCK_FIRST, press: "Send" })))).toBe('<p class="err" data-nda-refusal="">Acknowledge the NDA change first.</p>');
    // The top box's link lands on the notice, else (acknowledged) on the NDA line.
    expect(lineFallbacks("nda-notice")).toEqual(["nda-notice", "info-nda"]);
  });

  // (Owner, Nov 6, §314) No button, no separate link: the one line acknowledges, leaves the page and goes to the NDA.
  it("the notice: ONE clickable line that acknowledges and goes to the NDA, no button, no banner; marked when the page goes up to it", () => {
    for (const kind of KINDS) {
      const html = unescape(renderToStaticMarkup(h(NdaNotice, { sessionId: "s1", dev: "fbbb", kind, open: true, block: true })));
      // One wording for every kind (the owner's, Nov 6), the whole line one press.
      expect(html).toContain(`<p class="min-w-0"><a href="#info-nda" role="button" data-nda-ack="">${ndaNoticeLine("fbbb")}</a></p>`);
      expect(html.match(/<a /g)).toHaveLength(1);
      expect(html).not.toContain("<button");
      expect(html).toMatch(/^<div id="nda-notice" class="info scroll-mt-24 [^"]*data-\[marked\]:ring-2 data-\[marked\]:ring-sky-300" data-nda-notice="[a-z]+" data-session="s1" data-nda-block="[a-z]+">/);
    }
    expect(renderToStaticMarkup(h(NdaNotice, { sessionId: "s1", dev: "fbbb", kind: "changed", open: false, block: false }))).toBe("");
    // Not blocking (the tester no longer works on the test): the notice, without the block mark.
    expect(renderToStaticMarkup(h(NdaNotice, { sessionId: "s1", dev: "fbbb", kind: "changed", open: true, block: false }))).not.toContain("data-nda-block");
    // The source: the press goes up to the notice and marks it, as TesterTop does for Switch / Keep; an older page loads it first.
    const src = readFileSync(path.resolve(__dirname, "../src/components/NdaNotice.tsx"), "utf8");
    expect(src).toContain("window.addEventListener(NDA_BLOCK_EVENT, on);");
    expect(src).toContain("setTimeout(() => jumpTo(NDA_NOTICE), 30);");
    expect(src).toContain("router.refresh();");
    // The line is the only thing that records it (no banner, no button); a double press sends once; after it, the line goes and the page goes to the NDA.
    expect(src.match(/nda-seen/g)).toHaveLength(1);
    expect(src).toContain("if (sending.current) return;");
    expect(src).toContain("setTimeout(() => jumpTo(NDA_INFO), 60);");
    expect(readFileSync(path.resolve(__dirname, "../src/app/app/sessions/[id]/page.tsx"), "utf8").match(/<NdaNotice /g)).toHaveLength(1);
  });

  it.each(KINDS)("%s: pressing the notice (§314: its line) lifts the block at once (an added NDA counts as accepted)", async (kind) => {
    const x = await changed(kind);
    const before = await db.contract.findUniqueOrThrow({ where: { id: x.sessionId } });
    expect((await press(x.sessionId, x.tester.cookie, "nda-seen")).status).toBe(200);
    const after = await db.contract.findUniqueOrThrow({ where: { id: x.sessionId } });
    expect(after.ndaNoticeSeenAt).not.toBeNull();
    if (kind === "added") expect(after.ndaAcceptedAt).not.toBeNull();
    if (kind === "changed") expect(after.ndaAcceptedAt).toEqual(before.ndaAcceptedAt); // accepted at join, kept
    if (kind === "removed") expect(after.ndaAcceptedAt).toBeNull();
    const r = await press(x.sessionId, x.tester.cookie, "message", { body: "hi" });
    expect(r.body.error?.code, JSON.stringify(r.body)).not.toBe(NDA_BLOCK_CODE);
    expect(await sessionPage(x.sessionId, x.tester.user.id)).not.toContain('id="nda-notice"');
  });

  it("opening the link alone (the bell's, the notice's, an old ?nda=open one) doesn't unblock", async () => {
    const x = await changed("added");
    await sessionPage(x.sessionId, x.tester.user.id); // the page the link lands on
    const c = await db.contract.findUniqueOrThrow({ where: { id: x.sessionId } });
    expect(c.ndaNoticeSeenAt).toBeNull();
    expect(c.ndaAcceptedAt).toBeNull();
    expect((await press(x.sessionId, x.tester.cookie, "request-time")).body.error?.code).toBe(NDA_BLOCK_CODE);
  });

  it("a second change after acknowledging blocks again", async () => {
    const x = await changed("changed");
    expect((await press(x.sessionId, x.tester.cookie, "nda-seen")).status).toBe(200);
    await edit(x.testId, x.dev.cookie, { ndaText: "Keep it secret, again." });
    expect((await press(x.sessionId, x.tester.cookie, "request-time")).body.error?.code).toBe(NDA_BLOCK_CODE);
  });

  it.each(["changed", "removed"] as const)("Rate and Leave are never blocked (%s)", async (kind) => {
    for (const action of ["rate", "leave"] as const) {
      const s = await setup({ ndaText: NDA });
      const j = await joinedNda(s.testId, "Ana Silva");
      expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
      const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
      const paid = await json(await reviewPOST(req("/api/review", { cookie: s.dev.cookie, body: { payKey: randomUUID(), kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, confirmed: true } })));
      expect(paid.status).toBe(200);
      await edit(s.testId, s.dev.cookie, { ndaText: kind === "removed" ? "" : "Keep it very secret." });
      expect((await press(j.sessionId, j.tester.cookie, "request-time")).body.error?.code).toBe(NDA_BLOCK_CODE);
      const shown = seen();
      const r = await sact(j.sessionId, action, j.tester.cookie, { ...(action === "rate" ? { stars: 5, comment: "" } : {}), seenAt: shown, pageSeenAt: shown, loadedAt: shown });
      expect(r.status, `${action}: ${JSON.stringify(r.body)}`).toBe(200);
    }
  });

  it.each(["changed", "removed"] as const)("a tester who joins after the NDA was %s isn't blocked", async (kind) => {
    const s = await setup({ ndaText: NDA });
    const first = await joinedNda(s.testId, "Ana Silva");
    await edit(s.testId, s.dev.cookie, { ndaText: kind === "removed" ? "" : "Keep it very secret." });
    const later = kind === "removed" ? await joined(s.testId, "Bea Stone") : await joinedNda(s.testId, "Bea Stone");
    expect((await db.contract.findUniqueOrThrow({ where: { id: later.sessionId } })).ndaChangedAt).toBeNull();
    expect((await press(later.sessionId, later.tester.cookie, "request-time")).body.error?.code).not.toBe(NDA_BLOCK_CODE);
    expect(await sessionPage(later.sessionId, later.tester.user.id)).not.toContain('id="nda-notice"');
    expect((await press(first.sessionId, first.tester.cookie, "request-time")).body.error?.code).toBe(NDA_BLOCK_CODE);
  });
});

describe("§302 the page's side of the refusal (as for an open offer)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const page = (notice: { session: string } | null) => {
    const events: string[] = [];
    const win = Object.assign(new EventTarget(), { location: { pathname: "/app/sessions/s1", href: "/app/sessions/s1", search: "" }, sessionStorage: { getItem: () => null, setItem() {} }, localStorage: { getItem: () => null, setItem() {} } });
    for (const e of [NDA_BLOCK_EVENT, PRESS_REFUSED_EVENT]) win.addEventListener(e, () => events.push(e));
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", { getElementById: () => null, querySelector: (q: string) => (notice && q === "#nda-notice[data-nda-block]" ? { dataset: { session: notice.session } } : null) });
    return events;
  };

  it("the blocked paths: every session press but Rate, Leave, Acknowledge and the page's own sends; Join call", () => {
    for (const a of ["written", "written-add", "recording-send", "request-time", "answer-request", "cancel-call", "choose", "dispute", "message", "terms"]) expect(ndaBlockedPath(`/api/sessions/s1/${a}`), a).toBe(true);
    for (const a of ["rate", "leave", "nda-seen", "terms-pill", "recording-alive", "recording-done", "recording-abandon", "dismiss-removed"]) expect(ndaBlockedPath(`/api/sessions/s1/${a}`), a).toBe(false);
    expect(ndaBlockedPath("/api/calls/c1/join")).toBe(true);
    expect(ndaBlockedPath("/api/sessions/s2/request-time", "s1")).toBe(false); // another session's
    expect(ndaBlockedPath("/api/tests/t1/request-time")).toBe(false); // the developer's
  });

  it("a press on a page that shows the blocking notice doesn't go out: the one line, and the page goes up to the notice", async () => {
    const events = page({ session: "s1" });
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetcher);
    expect(offerShown()).toBe(true); // the press skips its own form checks, as with an open offer
    const e = await api("/api/sessions/s1/request-time", { seenAt: seen() }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ code: NDA_BLOCK_CODE, message: NDA_BLOCK_FIRST });
    expect(fetcher).not.toHaveBeenCalled();
    expect(events).toEqual([NDA_BLOCK_EVENT]);
    // Rate goes out.
    await api("/api/sessions/s1/rate", { stars: 5 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("the server's refusal (an older page without the notice) sends the page up to it too, without the ordinary refused-press redraw", async () => {
    const events = page(null);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: NDA_BLOCK_CODE, message: NDA_BLOCK_FIRST, sessionId: "s1" } }, { status: 409 })));
    const e = await api("/api/sessions/s1/message", { body: "hi" }).catch((x) => x);
    expect(e).toMatchObject({ code: NDA_BLOCK_CODE, message: NDA_BLOCK_FIRST });
    expect(events).toEqual([NDA_BLOCK_EVENT]);
  });
});
