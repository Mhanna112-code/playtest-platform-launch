import fs from "node:fs";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { ListingPanel } from "@/app/app/tests/[id]/ListingPanel";
import { asListing } from "@/lib/server/tests";
import { panelRows } from "@/lib/listingPanel";
import { chargeOpensAt } from "@/lib/rules";
import { runDaily } from "@/lib/server/holds";
import { act, addTo, joined, sact, seen, setup } from "./fixtures";

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, adminAway() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tests/test", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;
const src = (file: string) => fs.readFileSync(path.join(process.cwd(), "src", file), "utf8");
afterEach(() => vi.useRealTimers());

describe("listing folds, paid parts and sent-part labels (owner, Nov 1)", () => {
  it.each(["developer", "tester"] as const)("%s Listing scrolls inside its fold, keeping its header and footer outside", async (side) => {
    const f = await setup();
    const listing = asListing(await db.test.findUniqueOrThrow({ where: { id: f.testId } }));
    const html = renderToStaticMarkup(createElement(ListingPanel, { listing, rows: panelRows(listing, null), when: () => "now", side, savedAt: "save-1", head: "Visible title", foot: "Visible reviews" }));
    expect(html).toMatch(/<details id="listing" data-saved-at="save-1"/);
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain('data-listing-scroll=""');
    expect(html.indexOf("Visible title")).toBeLessThan(html.indexOf("<details"));
    expect(html.indexOf("Visible reviews")).toBeGreaterThan(html.indexOf("</details>"));
    expect(src("components/ListingInfo.tsx")).toContain("HTMLDetailsElement");
  });

  it("paid written work and recordings stay scrollable above Pay more, including an unlisted sent part", async () => {
    const f = await setup(); const j = await joined(f.testId);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["Paid answer remains visible", "Second answer"] })).status).toBe(200);
    const written = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    const recording = await db.submission.create({ data: { contractId: j.sessionId, kind: "recording", notes: "Recording context remains visible", agreedCents: 1000 } });
    const video = await db.recording.create({ data: { contractId: j.sessionId, submissionId: recording.id, filename: "paid-screen.webm", storageKey: "test/paid-screen", contentType: "video/webm", sizeBytes: 1234, uploadedAt: new Date() } });
    for (const sub of [written, recording]) {
      await db.review.create({ data: { contractId: j.sessionId, submissionId: sub.id, amountCents: 1000, agreedCents: 1000, payKey: randomUUID() } });
      await db.payment.create({ data: { kind: "review", contractId: j.sessionId, submissionId: sub.id, developerId: f.dev.user.id, testerId: j.tester.user.id, amountCents: 1000, feeCents: 200, testerCents: 800, status: "charged" } });
    }
    auth.user = await db.user.findUniqueOrThrow({ where: { id: f.dev.user.id } });
    const { default: Page } = await import("@/app/app/tests/[id]/page");
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: f.testId }), searchParams: Promise.resolve({}) }));
    // (Owner, Nov 5, §239) Recordings carry no notes: an old recording's stored notes are never shown; its file is what stays above Pay more.
    expect(html).not.toContain("Recording context remains visible");
    for (const [sub, text] of [[written, "Paid answer remains visible"], [recording, "paid-screen.webm"]] as const) {
      const row = html.split(`id="part-${sub.id}"`)[1]?.split('id="part-')[0];
      expect(row).toBeTruthy();
      expect(row).toContain(text);
      expect(row).toContain("overflow-y-auto");
      expect(row).toContain("Pay more");
      expect(row!.indexOf(text)).toBeLessThan(row!.indexOf("Pay more"));
    }
    expect(html).toContain(`/api/recordings/${video.id}/file`);
    expect(html).toContain("paid-screen.webm");
  });

  it("sent parts omit the late badge while keeping the dated payment explanation", () => {
    for (const file of ["app/app/tests/[id]/page.tsx", "app/app/sessions/[id]/page.tsx"]) expect(src(file)).not.toContain("lateLabel");
    expect(src("lib/moneyLines.ts")).toContain("Sent after the ${date} deadline");
    expect(src("lib/moneyLines.ts")).not.toContain("Sent late");
  });

  it("reproduces send, extend, resend three days before the new deadline, then Charge / Let it go seven days later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
    await db.outage.deleteMany();
    const f = await setup({ openUntil: "2026-11-10", timeZone: "UTC" });
    await db.user.update({ where: { id: f.dev.user.id }, data: { timeZone: "UTC" } });
    const j = await joined(f.testId);
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["First send", "First observations"], seenAt: seen(), confirmed: true })).status).toBe(200);
    vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
    const test = await db.test.findUniqueOrThrow({ where: { id: f.testId } });
    const edit = await act(f.testId, "edit", f.dev.cookie, { version: test.version, fields: { openUntil: "2026-11-15" }, seenAt: seen(), confirmed: true, timeZone: "UTC" });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const contract = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } });
    expect(contract.dueAt.toISOString().slice(0, 10)).toBe("2026-11-15");
    vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
    const resend = await addTo(j.sessionId, j.tester.cookie, { text: "Updated work: new observations", seenAt: seen(), confirmed: true }); // (batch 35 §136) added, as an update was
    expect(resend.status, JSON.stringify(resend.body)).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    expect(sub.late).toBe(false);
    const updatedTest = await db.test.findUniqueOrThrow({ where: { id: f.testId } });
    expect(chargeOpensAt(sub, updatedTest, contract)?.toISOString()).toBe("2026-11-19T12:00:00.000Z");
    vi.setSystemTime(new Date("2026-11-19T11:59:59Z"));
    await runDaily(new Date());
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).choiceOfferedAt).toBeNull();
    vi.setSystemTime(new Date("2026-11-19T12:00:01Z"));
    await runDaily(new Date());
    const opened = await db.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(opened.choiceOfferedAt).not.toBeNull();
    expect(opened.choiceBy).not.toBeNull();
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0);
  }, 120_000);
});
