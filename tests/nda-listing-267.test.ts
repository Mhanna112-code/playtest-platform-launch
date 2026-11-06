import { readFileSync } from "node:fs";
import path from "node:path";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { Err } from "@/components/Err";
import { OpenTermsNotice, openTermsLine } from "@/components/OpenTerms";
import { NDA_BLOCK_FIRST, ndaChangedLine, ndaNoticeHref } from "@/lib/ndaNotice";
import { act, joined, sact, seen, settle, setup } from "./fixtures";
import { makeUser } from "./helpers";

// (Owner, Nov 5, batch 35 §267) The NDA is a listing change: a Save that adds, removes or changes it applies to every working tester at once (no offer), with its
// own notice "<developer> changed the NDA" (bell, the page's top), its link to the NDA line in "The listing information". An added or removed NDA blocks every
// press but Rate and Leave until the notice is opened; a changed text only notifies. A tester who joins afterwards accepts it at join and is never blocked.
// (§268) The contract box's "New terms" pill while an offer is open (until pressed); Rate / Leave pop-ups' open-terms notice (information only).
// (Owner, Nov 6, §302) Updated: every NDA change blocks (changed too), refused with "Acknowledge the NDA change first."; one notice with an Acknowledge button
// (no banner), "<dev> changed the NDA. Click here to acknowledge you've seen the change." for every kind; the bell's line "<dev> changed the NDA", to the notice. More in nda-acknowledge-302.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/s", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const NDA = "Keep it secret.";
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  const r = await act(testId, "edit", cookie, { version: v, fields, seenAt: seen(), confirmed: true });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  await settle();
  return r;
};
const sessionPage = async (sessionId: string, userId: string) => {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
  return unescape(renderToStaticMarkup(await SessionPage({ params: Promise.resolve({ id: sessionId }) })));
};
/** Join a test that has an NDA (accepted at join, as the join page asks). */
async function joinedNda(testId: string, name: string) {
  const t = await makeUser({ tester: true, name, pronoun: "she" });
  const test = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const r = await act(testId, "join", t.cookie, { listingVersion: test.listingVersion, ndaAccepted: true });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  await settle();
  return { tester: t, sessionId: r.body.sessionId as string };
}
const press = (sessionId: string, cookie: string, action: string, body: Record<string, unknown> = {}) => sact(sessionId, action, cookie, { seenAt: seen(), ...body });

describe("§267 a Save that changes the NDA", () => {
  it("makes no offer, copies it into the contract and sends its own notice; adding blocks every press but Rate and Leave until acknowledged", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await press(j.sessionId, j.tester.cookie, "written", { answers: ["the boats", "level two gate"], confirmed: true })).status).toBe(200);
    await edit(testId, dev.cookie, { ndaText: NDA });
    expect(await db.termsOffer.count({ where: { contractId: j.sessionId } })).toBe(0);
    const c = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } });
    expect(c).toMatchObject({ ndaText: NDA, ndaChangeKind: "added", ndaNoticeSeenAt: null });
    // The bell: its own line (not "updated the listing"), "changed the NDA" even for an added one (§302), linking to the session page's notice.
    const bell = await db.notification.findMany({ where: { userId: j.tester.user.id, text: { contains: "NDA" } } });
    expect(bell.map((b) => b.text)).toEqual([ndaChangedLine("Nora Lane")]);
    expect(bell[0].text).toBe("Nora Lane changed the NDA");
    expect(bell[0].link).toBe(ndaNoticeHref(j.sessionId));
    expect(bell[0].link).toBe(`/app/sessions/${j.sessionId}#nda-notice`);
    // Every press is refused with the one line (§302): Add to this answer, messages, call requests, recordings.
    const line = NDA_BLOCK_FIRST;
    expect(line).toBe("Acknowledge the NDA change first.");
    for (const [action, body] of [["written-add", { text: "more", question: "else" }], ["message", { body: "hi" }], ["request-time", {}], ["recording-send", {}]] as const) {
      const r = await press(j.sessionId, j.tester.cookie, action, body);
      expect(r.body.error?.code, `${action}: ${JSON.stringify(r.body)}`).toBe("nda_block");
      expect(r.body.error?.message).toBe(line);
    }
    // The page: the one notice, its line the press (§302, §314: no button); the NDA line in "The listing information" (not in "Your contract"), with its box.
    const page = await sessionPage(j.sessionId, j.tester.user.id);
    // (§270) The developer's name is a green link to their profile.
    expect(page).toMatch(/data-nda-block="added"><p class="min-w-0"><a href="#info-nda" role="button" data-nda-ack="">Nora Lane changed the NDA. Click here to acknowledge you've seen the change.<\/a><\/p>/); // (§314) one clickable line
    const info = page.slice(page.indexOf('data-scope-info=""'), page.indexOf('data-terms-history=""'));
    expect(info).toMatch(/<li id="info-nda" data-nda=""[^>]*data-info-line="nda"/);
    expect(info).toContain(NDA);
    const contract = page.slice(page.indexOf('data-scope-contract=""'), page.indexOf('data-scope-info=""'));
    expect(contract).not.toContain("data-nda");
    // Pressing the notice (§314: its line, no button) lifts the block (and counts as reading it).
    expect((await press(j.sessionId, j.tester.cookie, "nda-seen")).status).toBe(200);
    expect((await press(j.sessionId, j.tester.cookie, "written-add", { text: "more on it", question: "else", confirmed: true })).status).toBe(200);
    expect((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).ndaAcceptedAt).not.toBeNull();
    expect(await sessionPage(j.sessionId, j.tester.user.id)).not.toContain("data-nda-notice");
  });

  it("removing the NDA blocks too, and (§302) so does changing its text; each notice in its own words", async () => {
    const { dev, testId } = await setup({ ndaText: NDA });
    const j = await joinedNda(testId, "Ana Silva");
    await edit(testId, dev.cookie, { ndaText: "Keep it very secret." });
    let r = await press(j.sessionId, j.tester.cookie, "request-time", {});
    expect(r.body.error?.code).toBe("nda_block");
    let page = await sessionPage(j.sessionId, j.tester.user.id);
    expect(page).toMatch(/data-nda-notice="changed" data-session="[^"]+" data-nda-block="changed"><p class="min-w-0"><a href="#info-nda" role="button" data-nda-ack="">Nora Lane changed the NDA. Click here to acknowledge you've seen the change.<\/a><\/p>/); // (§314) one clickable line
    await edit(testId, dev.cookie, { ndaText: "" });
    r = await press(j.sessionId, j.tester.cookie, "request-time", {});
    expect(r.body.error?.code).toBe("nda_block");
    expect(r.body.error?.message).toBe(NDA_BLOCK_FIRST);
    page = await sessionPage(j.sessionId, j.tester.user.id);
    expect(page).toContain('data-nda-block="removed"');
    expect(await db.termsOffer.count({ where: { contractId: j.sessionId } })).toBe(0);
  });

  it("a tester who joins after the NDA was added accepts it at join and is never blocked", async () => {
    const { dev, testId } = await setup();
    const first = await joined(testId);
    await edit(testId, dev.cookie, { ndaText: NDA });
    const later = await joinedNda(testId, "Bea Stone");
    const c = await db.contract.findUniqueOrThrow({ where: { id: later.sessionId } });
    expect(c.ndaChangedAt).toBeNull();
    expect((await press(later.sessionId, later.tester.cookie, "request-time", {})).body.error?.code).not.toBe("nda_block");
    expect((await press(first.sessionId, first.tester.cookie, "request-time", {})).body.error?.code).toBe("nda_block");
  });

  it("(§302) the refusal box draws the line as it is, like the new-terms line (no blue notice, no link)", () => {
    const html = renderToStaticMarkup(h(Err, { text: NDA_BLOCK_FIRST, press: "Request a time" }));
    expect(html).toBe('<p class="err" data-nda-refusal="">Acknowledge the NDA change first.</p>');
  });
});

describe("§268 the contract box's New terms pill and the Rate / Leave notice", () => {
  it("the pill shows while an offer is open, stays until pressed, and a newer offer brings it back", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    await edit(testId, dev.cookie, { writtenCents: "12.00" });
    expect(await sessionPage(j.sessionId, j.tester.user.id)).toContain('data-terms-pill="">New terms</button>');
    expect(await sessionPage(j.sessionId, j.tester.user.id)).toContain('data-terms-pill=""'); // across reloads
    expect((await press(j.sessionId, j.tester.cookie, "terms-pill")).status).toBe(200);
    expect(await sessionPage(j.sessionId, j.tester.user.id)).not.toContain("data-terms-pill");
    await edit(testId, dev.cookie, { writtenCents: "14.00" });
    expect(await sessionPage(j.sessionId, j.tester.user.id)).toContain('data-terms-pill=""');
  });

  it("the pop-ups' notice: information only, with a link to the new terms; only while an offer is open", () => {
    expect(openTermsLine("Nora Lane", "rate")).toBe("Nora Lane offered new terms you haven't answered: rating closes them unanswered.");
    expect(openTermsLine("Nora Lane", "leave")).toBe("Nora Lane offered new terms you haven't answered: leaving closes them unanswered.");
    const html = renderToStaticMarkup(h(OpenTermsNotice, { dev: "Nora Lane", press: "rate" }));
    expect(html).toContain('class="info text-xs" data-open-terms-notice="rate"');
    expect(html).toContain('<a href="#terms-offer">See the new terms</a>');
    const page = readFileSync(path.resolve(__dirname, "../src/app/app/sessions/[id]/page.tsx"), "utf8");
    expect(page).toContain('notice={offer && !refusal ? <OpenTermsNotice dev={dev} press="rate" /> : undefined}');
    expect(page).toContain('notice={offer && !refusal ? <OpenTermsNotice dev={dev} press="leave" /> : undefined}');
  });
});
