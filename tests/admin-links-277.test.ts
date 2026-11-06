import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { adminBellLinks, adminPool, linkRich } from "@/lib/server/adminLinks";
import { adminPage, disputeRow, type ChargebackVM } from "@/lib/server/adminLists";
import { PagedList } from "@/app/admin/PagedList";
import { chargebackHolds } from "@/lib/server/chargeback";
import { hrefsOf, plainOf, type Rich } from "@/lib/rich";
import { makeUser } from "./helpers";
import { joined, sact, settle, setup } from "./fixtures";

// (Owner, Nov 5, §277) Green links on every person and test in the team's bells and console lines; each developer's open chargebacks newest first; the daily
// suspended reminder stays as it is (§277 revised: its point 3 dropped). (Revised) Chargebacks in one "Chargebacks (N)" drop-down and the dispute chat, each in the shared
// draggable, resizable panel.
(globalThis as unknown as { React: typeof React }).React = React;
vi.mock("next/navigation", () => ({ usePathname: () => "/admin", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams() }));

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const admin = async () => {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test`, name: "Team Admin" });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
};
/** A test ("Harbor Run: first 3", by Nora Lane) with Ana Silva's and Ben Okafor's written answers sent. */
async function world() {
  const s = await setup({ title: "Harbor Run: first 3" });
  const t = [];
  for (const name of ["Ana Silva", "Ben Okafor"]) {
    const j = await joined(s.testId, name);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["answer", "answer"] });
    t.push({ ...j, sub: await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } }) });
  }
  await settle();
  return { ...s, t };
}
const links = (r: Rich) => r.filter((x): x is { t: string; href: string } => typeof x !== "string" && "href" in x && !("ext" in x && x.ext)).map((x) => [x.t, x.href]);

describe("§277 the team's bells: every person and test a line names is a green link to their place for the team", () => {
  it("an old stored dispute line, a hold lift and a report: the pool comes from the line's own data, never the reader's tests", async () => {
    const w = await world();
    const a = await admin();
    const [ana, ben] = w.t;
    const d = await db.dispute.create({ data: { contractId: ana.sessionId, testerId: ana.tester.user.id, submissionId: ana.sub.id, reason: "Too low" } });
    const r = await db.report.create({ data: { reporterId: ben.tester.user.id, reportedId: w.dev.user.id, note: "Rude in chat, said nothing useful" } });
    // Lines written before §277 (stored as they were; the dispute's has no testId), and one cut by an older 50 cut ("“Harbor…").
    const mk = (text: string, link: string, testId: string | null = null) => db.notification.create({ data: { userId: a.user.id, text, link, testId } });
    const n1 = await mk("Dispute on “Harbor Run: first 3”: Ana Silva says the pay should be higher (Nora Lane)", `/admin#dispute-${d.id}`);
    const n2 = await mk("Hold lift waiting: Nora Lane paid what she owes (Many holds)", `/admin#lift-${w.dev.user.id}`);
    const n3 = await mk("New report: Ben Okafor reported Nora Lane", `/admin#report-${r.id}`);
    const n4 = await mk("Dispute on “Harbor…”: Ana Silva says the pay should be higher", `/admin?dispute=${d.id}#dispute-${d.id}`);
    // A line about the admin's own account (not the console's) keeps §270's pool: not in the map.
    const n5 = await mk("Your password was changed", "/app/settings");
    const got = await adminBellLinks([n1, n2, n3, n4, n5]);
    const as = (id: string) => got.get(id)?.map((l) => [l.text, l.href, l.kind]);
    const test = `/app/find/${w.testId}`, nora = `/app/developers/${w.dev.user.id}`, anaP = `/app/testers/${ana.tester.user.id}`, benP = `/app/testers/${ben.tester.user.id}`;
    expect(as(n1.id)).toEqual([["Harbor Run: first 3", test, "test"], ["Ana Silva", anaP, "person"], ["Nora Lane", nora, "person"]]);
    expect(as(n2.id)).toEqual([["Nora Lane", nora, "person"]]);
    expect(as(n3.id)).toEqual([["Ben Okafor", benP, "person"], ["Nora Lane", nora, "person"]]);
    expect(as(n4.id)).toEqual([["Harbor Run: first 3", test, "test"], ["Ana Silva", anaP, "person"]]); // the cut name by its visible start
    expect(got.has(n5.id)).toBe(false);
    // A bell with its test (testId) names that test's people too.
    const n6 = await mk("Ben Okafor sent work on “Harbor Run: first 3”", "/admin#disputes", w.testId);
    expect((await adminBellLinks([n6])).get(n6.id)?.map((l) => l.href)).toEqual([benP, test]);
  });

  it("the notifications page sends an admin's team lines these links, the rest §270's", () => {
    const page = src("app/app/notifications/page.tsx");
    expect(page).toContain("const team = isAdmin(u) ? await adminBellLinks(items) : new Map<string, LineLink[]>();");
    expect(page).toContain("links: team.get(n.id) ?? lineLinks(pool, n.text, n.testId)");
  });
});

describe("§277 the console's lines: the Chargeback holds row", () => {
  it("each chargeback line links the tester and the test (and keeps its Stripe id); a developer's open chargebacks are newest first, the holds oldest first", async () => {
    const w = await world();
    const a = await admin();
    const [ana, ben] = w.t;
    const pay = (i: number, at: Date) =>
      db.payment.create({ data: { kind: "review", contractId: w.t[i].sessionId, submissionId: w.t[i].sub.id, developerId: w.dev.user.id, testerId: w.t[i].tester.user.id, amountCents: 1250, feeCents: 125, testerCents: 1125, status: "charged", stripePaymentIntentId: "pi_" + randomUUID().slice(0, 12), chargeback: "open", chargebackAt: at } });
    const older = await pay(0, new Date(Date.now() - 3 * 3_600_000));
    const newer = await pay(1, new Date(Date.now() - 3_600_000));
    await db.user.update({ where: { id: w.dev.user.id }, data: { holdStartedAt: new Date(Date.now() - 4 * 3_600_000), holdReason: "chargeback", holdCount: 1 } });
    // chargebackHolds: newest chargeback first (it was findMany with no order).
    const holds = await chargebackHolds();
    expect(holds.find((h) => h.dev.id === w.dev.user.id)!.chargebacks.map((p) => p.id)).toEqual([newer.id, older.id]);
    const starts = holds.map((h) => h.dev.holdStartedAt!.getTime());
    expect(starts).toEqual([...starts].sort((x, y) => x - y)); // the holds stay oldest hold first
    // The console's row.
    let cursor: string | null = null, row: ChargebackVM | undefined;
    do {
      const page = (await adminPage("chargebacks", a.user.id, cursor)) as { rows: ChargebackVM[]; next: string | null };
      row = page.rows.find((x) => x.id === w.dev.user.id);
      cursor = page.next;
    } while (!row && cursor);
    expect(row).toBeTruthy();
    const [first, second] = row!.chargebackParts!;
    expect(plainOf(first)).toBe(`Chargeback open: $12.50 for Ben Okafor's written answers on “Harbor Run: first 3” · ${newer.stripePaymentIntentId}`);
    expect(links(first)).toEqual([["Ben Okafor", `/app/testers/${ben.tester.user.id}`], ["Harbor Run: first 3", `/app/find/${w.testId}`]]);
    expect(links(second)).toEqual([["Ana Silva", `/app/testers/${ana.tester.user.id}`], ["Harbor Run: first 3", `/app/find/${w.testId}`]]);
    expect(hrefsOf(second).some((h) => h.includes(older.stripePaymentIntentId!))).toBe(true); // the Stripe link kept
    // The plain words are the same as before.
    expect(row!.chargebacks[1]).toBe(`Chargeback open: $12.50 for Ana Silva's written answers on “Harbor Run: first 3” · ${older.stripePaymentIntentId}`);
    // The developer's name already linked (who); the profile's Chargebacks box links the names in its words too.
    expect(links(row!.who!)).toEqual([["Nora Lane", `/app/developers/${w.dev.user.id}`]]);
    const box = (await adminPage("u-chargebacks", a.user.id, null, w.dev.user.id)) as { rows: { parts?: Rich }[] };
    expect(box.rows.map((x) => links(x.parts ?? []).map(([t]) => t))).toEqual([["Ben Okafor", "Harbor Run: first 3"], ["Ana Silva", "Harbor Run: first 3"]]);
  });

  it("linkRich: a plain piece gains its links; existing links, Stripe ids, emails and typed reasons stay as they are", async () => {
    const w = await world();
    const pool = (await adminPool({ testIds: [w.testId] })).byTest.get(w.testId)!;
    const r: Rich = [{ t: "Nora Lane", href: "/x" }, " (nora.lane@x.test) paid Ana Silva on “Harbor Run: first 3”", { q: "Ana Silva was late" }, " · ", { t: "pi_1", href: "https://dashboard.stripe.com/payments/pi_1", ext: true }];
    const out = linkRich(r, pool);
    expect(out[0]).toEqual({ t: "Nora Lane", href: "/x" });
    expect(plainOf(out)).toBe(plainOf(r));
    expect(links(out).map(([t]) => t)).toEqual(["Nora Lane", "Ana Silva", "Harbor Run: first 3"]);
    expect(out).toContainEqual({ q: "Ana Silva was late" });
  });
});

describe("§277 the console's drop-downs: Chargebacks (N) and the dispute chat in the shared resizable panel", () => {
  it("a hold row's chargebacks are ONE drop-down, 'Chargebacks (N)', its lines (with their links) in ResizeBox in OwnPanel", async () => {
    const w = await world();
    const a = await admin();
    for (const [i, h] of [[0, 3], [1, 1]] as const)
      await db.payment.create({ data: { kind: "review", contractId: w.t[i].sessionId, submissionId: w.t[i].sub.id, developerId: w.dev.user.id, testerId: w.t[i].tester.user.id, amountCents: 1250, feeCents: 125, testerCents: 1125, status: "charged", stripePaymentIntentId: "pi_" + randomUUID().slice(0, 12), chargeback: "open", chargebackAt: new Date(Date.now() - h * 3_600_000) } });
    await db.user.update({ where: { id: w.dev.user.id }, data: { holdStartedAt: new Date(Date.now() - 4 * 3_600_000), holdReason: "chargeback", holdCount: 1 } });
    let cursor: string | null = null, row: ChargebackVM | undefined;
    do {
      const page = (await adminPage("chargebacks", a.user.id, cursor)) as { rows: ChargebackVM[]; next: string | null };
      row = page.rows.find((x) => x.id === w.dev.user.id);
      cursor = page.next;
    } while (!row && cursor);
    const html = renderToStaticMarkup(createElement(PagedList, { kind: "chargebacks", initial: { rows: [row!], next: null, total: 1 }, fixed: true } as never));
    expect(html.match(/data-chargeback-list=/g)).toHaveLength(1);
    expect(html).toMatch(/<summary[^>]*>Chargebacks \(2\)<\/summary>/);
    const list = html.slice(html.indexOf("data-chargeback-list="));
    expect(list).toContain('data-panel-grip=""'); // the shared panel's grip (ResizeBox)
    const lines = [...list.matchAll(/<li class="text-slate-400" data-chargeback-line="">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(`<a href="/app/testers/${w.t[1].tester.user.id}">Ben Okafor</a>`); // newest first
    expect(lines[1]).toContain(`<a href="/app/testers/${w.t[0].tester.user.id}">Ana Silva</a>`);
    expect(lines[0]).toContain(`<a href="/app/find/${w.testId}">Harbor Run: first 3</a>`);
    expect(src("app/admin/PagedList.tsx")).toContain('<OwnPanel><ResizeBox id={`chargebacks-${c.id}`} label="Chargebacks" defaultMax="min(12rem, 40vh)">');
  });

  it("'Their chat on this test (N)' keeps its drop-down; the messages sit in the shared panel; the sender and the people a message names are green links", async () => {
    const w = await world();
    const [ana] = w.t;
    const d = await db.dispute.create({ data: { contractId: ana.sessionId, testerId: ana.tester.user.id, submissionId: ana.sub.id, reason: "Too low" } });
    await db.message.create({ data: { testId: w.testId, testerId: ana.tester.user.id, contractId: ana.sessionId, senderId: w.dev.user.id, body: "Hi Ana Silva, I'll pay $20 (ana@x.test)" } });
    await db.message.create({ data: { testId: w.testId, testerId: ana.tester.user.id, contractId: ana.sessionId, senderId: ana.tester.user.id, body: "Thanks!" } });
    const row = await disputeRow(d);
    expect(row.chat!.map((m) => m.whoHref)).toEqual([`/app/developers/${w.dev.user.id}`, `/app/testers/${ana.tester.user.id}`]);
    expect(row.chat![0].parts).toEqual(["Hi ", { t: "Ana Silva", href: `/app/testers/${ana.tester.user.id}` }, ", I'll pay $20 (ana@x.test)"]);
    expect(row.chat![1].parts).toBeUndefined(); // names no one
    const html = renderToStaticMarkup(createElement(PagedList, { kind: "disputes", initial: { rows: [row], next: null, total: 1 }, fixed: true } as never));
    const chat = html.slice(html.indexOf("data-dispute-chat="));
    expect(chat).toMatch(/^[^>]*>\s*<summary[^>]*>Their chat on this test <span[^>]*>\(2\)<\/span><\/summary>/);
    expect(chat).toContain('data-dispute-chat-panel=""');
    expect(chat).toContain('data-panel-grip=""');
    expect(chat).not.toContain("max-h-72");
    expect(chat).toContain(`<a href="/app/developers/${w.dev.user.id}" data-chat-who="">`);
    expect(chat).toContain(`<a href="/app/testers/${ana.tester.user.id}" data-chat-name="">Ana Silva</a>`);
  });
});

describe("§277 the daily suspended reminder stays as it is", () => {
  it("one line counting the sides, naming no one; its bell line gets no links", async () => {
    expect(src("lib/server/restrictions.ts")).toContain('await bell(a.id, `${sides} suspended account side${sides === 1 ? "" : "s"} to review`, "/admin#suspensions", undefined, { group: "suspendedreview", reminder: "suspended-review" });');
    const a = await admin();
    const n = await db.notification.create({ data: { userId: a.user.id, text: "2 suspended account sides to review", link: "/admin#suspensions" } });
    expect((await adminBellLinks([n])).get(n.id)).toEqual([]);
  });
});
