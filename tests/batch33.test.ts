import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { adminPage, disputeRow, type ChargebackVM, type ContactVM, type DisputeVM, type LiftVM, type MineVM, type ReportVM, type TestVM, type TextVM, type UserVM } from "@/lib/server/adminLists";
import { linkNames, stripeDashboardUrl } from "@/lib/server/adminLinks";
import { adminConsoleV, adminPersonV } from "@/lib/server/pulseV";
import { setStripeForTests } from "@/lib/server/stripe";
import { accountState } from "@/lib/server/accountState";
import { hrefsOf, plainOf, type Rich } from "@/lib/rich";
import { PagedList } from "@/app/admin/PagedList";
import { AccountActions } from "@/app/admin/AccountActions";
import { json, makeUser, req } from "./helpers";
import { bookCall, sact, seen, settle } from "./fixtures";
import { pay, sentWork, withCard } from "./b15";

// Batch 33: the admin console's links (§1), who wrote what in a dispute (§2), a developer's payment failures (§3), empty boxes (§4), the console's sections (§6)
// and admin pages following other admins' changes live (§7).

// The components are compiled for the browser's JSX runtime; rendering them here needs React in scope.
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
afterEach(() => setStripeForTests(null));

async function admin() {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test`, name: "Team Member" });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}
const aact = (cookie: string, action: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);
const dev = (id: string) => `/app/developers/${id}`;
const tester = (id: string) => `/app/testers/${id}`;
const testPage = (id: string) => `/app/find/${id}`;
const rowsOf = async <T,>(kind: Parameters<typeof adminPage>[0], adminId: string, arg = "") => (await adminPage(kind, adminId, null, arg)).rows as T[];

/** A Stripe stand-in whose charges are all declined, or all go through. */
function card(ok: boolean) {
  setStripeForTests({
    paymentIntents: {
      create: async () => {
        if (!ok) throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError", rawType: "card_error", code: "card_declined" });
        const id = "pi_" + randomUUID().replace(/-/g, "");
        return { id, status: "succeeded", latest_charge: id.replace(/^pi_/, "ch_") };
      },
      retrieve: async (id: string) => ({ id, status: "requires_payment_method" }),
      cancel: async (id: string) => ({ id, status: "canceled" }),
    },
    transfers: { create: async () => ({ id: "tr_" + randomUUID().replace(/-/g, "") }) },
  } as unknown as Stripe);
}

/** Written answers paid $5.00 ("Half of it") and disputed by the tester. */
async function disputed() {
  const w = await sentWork("10.00");
  expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "5.00", tickedCents: 500, reason: "Half of it" })).status).toBe(200);
  expect((await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.sub.id, reason: "I answered every question in full.", seenAt: seen(), confirmed: true })).status).toBe(200);
  return { ...w, dispute: await db.dispute.findFirstOrThrow({ where: { submissionId: w.sub.id } }) };
}

describe("batch 33 §2: open disputes say who wrote what", () => {
  it("the test and the part above, the people with their emails, and “Ana Silva's reason” / “Nora Lane's note when paying”, the names and the test as links", async () => {
    const w = await disputed();
    const row = await disputeRow(w.dispute);
    expect(plainOf(row.top!)).toBe("“Harbor Run” · Ana Silva's written answers · paid $5.00");
    expect(row.head).toBe(plainOf(row.top!));
    expect(hrefsOf(row.top!)).toEqual([testPage(w.testId), tester(w.tester.user.id)]);
    expect(row.said).toBe("Ana Silva's reason: “I answered every question in full.” · Nora Lane's note when paying: “Half of it”");
    expect(row.said).not.toMatch(/Tester:|Developer's note/);
    expect(hrefsOf(row.saidParts!)).toEqual([tester(w.tester.user.id), dev(w.dev.user.id)]);
    expect(plainOf(row.people!)).toBe(`Ana Silva (${w.tester.user.email}) vs Nora Lane (${w.dev.user.email})`);
    expect(hrefsOf(row.people!)).toEqual([tester(w.tester.user.id), dev(w.dev.user.id)]);
    // The console's list carries the same view model; "See the work" stays.
    const a = await admin();
    const listed = (await rowsOf<DisputeVM>("disputes", a.user.id)).find((r) => r.id === w.dispute.id)!;
    expect(listed.saidParts).toEqual(row.saidParts);
    expect(listed.work).toMatchObject({ kind: "submission", part: "written" });
    const list = src("app/admin/PagedList.tsx");
    expect(list).toContain("<AdminRich parts={d.saidParts} />");
    expect(list).toContain("<DisputeWork work={d.work ?? null} />");
  });
});

describe("batch 33 §1: every person, test and payment the team reads is a link", () => {
  it("person boxes: payments, payouts, disputes, chargebacks, tests, reports and parts name people as “Name (email)” with the name as the link, tests as their page", async () => {
    const a = await admin();
    const w = await disputed();
    const devId = w.dev.user.id, testerId = w.tester.user.id;
    const pi = "pi_" + randomUUID().replace(/-/g, ""), tr = "tr_" + randomUUID().replace(/-/g, "");
    await db.payment.create({ data: { kind: "review", contractId: w.sessionId, submissionId: w.sub.id, developerId: devId, testerId, amountCents: 700, feeCents: 140, testerCents: 560, status: "charged", stripePaymentIntentId: pi, stripeTransferId: tr, transferStatus: "sent", chargeback: "open", chargebackAt: new Date() } });
    await db.report.create({ data: { reporterId: testerId, reportedId: devId, note: "Rude in chat" } });
    const pays = await rowsOf<TextVM>("u-payments", a.user.id, devId);
    const withIds = pays.find((p) => p.text.includes(pi))!;
    expect(withIds.text).toContain(`to Ana Silva (${w.tester.user.email}) on “Harbor Run”`);
    expect(hrefsOf(withIds.parts!)).toEqual([tester(testerId), testPage(w.testId), `https://dashboard.stripe.com/payments/${pi}`, `https://dashboard.stripe.com/connect/transfers/${tr}`]);
    expect(withIds.parts!.filter((s) => typeof s !== "string" && "ext" in s && s.ext)).toHaveLength(2); // the Stripe ids open in a new tab
    const outs = await rowsOf<TextVM>("u-payouts", a.user.id, testerId);
    expect(outs.find((p) => p.text.includes(pi))!.text).toContain(`from Nora Lane (${w.dev.user.email}) (review) on “Harbor Run”`);
    const ds = await rowsOf<TextVM>("u-disputes", a.user.id, devId);
    expect(hrefsOf(ds[0].parts!)).toEqual([testPage(w.testId), tester(testerId)]);
    expect(ds[0].href).toBeUndefined();
    const cbs = await rowsOf<TextVM>("u-chargebacks", a.user.id, devId);
    expect(hrefsOf(cbs[0].parts!)).toEqual([`https://dashboard.stripe.com/payments/${pi}`, `https://dashboard.stripe.com/connect/transfers/${tr}`]);
    const tests = await rowsOf<TextVM>("u-tests", a.user.id, testerId);
    expect(tests[0].text).toContain(`Joined “Harbor Run” by Nora Lane (${w.dev.user.email})`);
    expect(hrefsOf(tests[0].parts!)).toEqual([testPage(w.testId), dev(devId)]);
    const reports = await rowsOf<TextVM>("u-reports", a.user.id, devId);
    expect(reports[0].text).toContain(`Reported by Ana Silva (${w.tester.user.email}): “Rude in chat”`);
    expect(hrefsOf(reports[0].parts!)).toEqual([tester(testerId)]);
    const parts = await rowsOf<TextVM>("u-parts", a.user.id, testerId);
    expect(hrefsOf(parts[0].parts!)).toEqual([testPage(w.testId), dev(devId)]);
    // A test's boxes: the testers as profile links.
    const contracts = await rowsOf<TextVM>("t-contracts", a.user.id, w.testId);
    expect(contracts[0].text).toContain(`Ana Silva (${w.tester.user.email}) joined on:`);
    const tpays = await rowsOf<TextVM>("t-payments", a.user.id, w.testId);
    expect(tpays.some((p) => hrefsOf(p.parts!).includes(tester(testerId)))).toBe(true);
    const timeline = await rowsOf<TextVM>("t-timeline", a.user.id, w.testId);
    const disputeLine = timeline.find((x) => x.em === "I answered every question in full.")!;
    expect(disputeLine.text).toMatch(new RegExp(`· Ana Silva \\(${esc(w.tester.user.email)}\\) disputed the pay for their written answers:$`));
    // The rendered box: each link is an <a>, the Stripe ones in a new tab.
    const html = renderToStaticMarkup(createElement(PagedList, { kind: "u-payments", initial: { rows: pays, next: null, total: pays.length }, title: "Payments they made", level: 3 }));
    expect(html).toContain(`<a href="${tester(testerId)}">Ana Silva</a> (${w.tester.user.email})`);
    expect(html).toContain(`<a href="https://dashboard.stripe.com/payments/${pi}" target="_blank" rel="noopener noreferrer" data-stripe-link="">${pi}</a>`);
  });

  it("console lists: accounts, reports, no-shows, lifts, chargebacks, contact and your actions link each person and test", async () => {
    const a = await admin();
    const w = await disputed();
    const devId = w.dev.user.id, testerId = w.tester.user.id;
    const users = (await adminPage("users", a.user.id, null, "", { q: w.tester.user.email })).rows as UserVM[];
    const me = users.find((u) => u.id === testerId)!;
    expect(plainOf(me.parts!)).toBe(`Ana Silva (${w.tester.user.email}) · tester`);
    expect(hrefsOf(me.parts!)).toEqual([tester(testerId)]);
    const r = await db.report.create({ data: { reporterId: devId, reportedId: testerId, note: "No-show twice" } });
    const rep = (await rowsOf<ReportVM>("reports", a.user.id)).find((x) => x.id === r.id)!;
    expect([rep.reporterHref, rep.reporterEmail, rep.reportedHref, rep.reportedEmail]).toEqual([dev(devId), w.dev.user.email, tester(testerId), w.tester.user.email]);
    const booked = await bookCall(w.testId, w.dev.cookie, w.sessionId, w.tester.cookie);
    const call = await db.call.update({ where: { id: booked.id }, data: { noShowBy: "tester", noShowAt: new Date(), noShowNote: "Nobody came" } });
    const ns = (await rowsOf<TextVM>("noshows", a.user.id)).find((x) => x.id === call.id)!;
    expect(hrefsOf(ns.parts!)).toEqual([testPage(w.testId), tester(testerId), dev(devId)]);
    expect(ns.text).toContain(`reported by the tester (Ana Silva (${w.tester.user.email})) against Nora Lane (${w.dev.user.email})`);
    const m = await db.contactMessage.create({ data: { userId: testerId, topic: "Payments", message: "Where is my payout?" } });
    const c = (await rowsOf<ContactVM>("contact", a.user.id)).find((x) => x.id === m.id)!;
    expect(hrefsOf(c.fromParts!)).toEqual([tester(testerId)]);
    // A 4th hold waiting for its Approve (Lifts), and a chargeback hold.
    await db.user.update({ where: { id: devId }, data: { holdStartedAt: new Date(), holdReason: "unpaid", holdCount: 4 } });
    const lift = (await rowsOf<LiftVM>("lifts", a.user.id)).find((x) => x.id === devId)!;
    expect(plainOf(lift.headParts!)).toBe(`Nora Lane (${w.dev.user.email}) · More than 3 holds`);
    expect(hrefsOf(lift.headParts!)).toEqual([dev(devId)]);
    const pi = "pi_" + randomUUID().replace(/-/g, "");
    await db.payment.create({ data: { kind: "review", developerId: devId, testerId, amountCents: 900, feeCents: 180, testerCents: 720, status: "charged", stripePaymentIntentId: pi, chargeback: "open", chargebackAt: new Date() } });
    await db.user.update({ where: { id: devId }, data: { holdReason: "chargeback" } });
    const cb = (await rowsOf<ChargebackVM>("chargebacks", a.user.id)).find((x) => x.id === devId)!;
    expect(hrefsOf(cb.who!)).toEqual([dev(devId)]);
    expect(cb.chargebackParts!.flatMap(hrefsOf)).toEqual([`https://dashboard.stripe.com/payments/${pi}`]);
    // Your actions: the test and its developer, and the person suspended.
    expect((await aact(a.cookie, "pause-test", { id: w.testId, note: "Checking" })).status).toBe(200);
    expect((await aact(a.cookie, "suspend", { id: testerId, note: "Spam answers", side: "tester" })).status).toBe(200);
    const mine = await rowsOf<MineVM>("mine", a.user.id);
    expect(hrefsOf(mine.find((x) => x.testId === w.testId)!.parts!)).toEqual([testPage(w.testId), dev(devId)]);
    expect(hrefsOf(mine.find((x) => !x.testId && x.title === w.tester.user.email)!.parts!)).toEqual([tester(testerId)]);
    // (Batch 35 §101) No Payment holds panel any more.
    expect(src("app/admin/page.tsx")).not.toContain("heldWho");
  });

  it("Stripe Dashboard links: test mode for a test key, live otherwise; built on the server and never carrying the key", () => {
    const was = process.env.STRIPE_SECRET_KEY;
    try {
      process.env.STRIPE_SECRET_KEY = "sk_test_secret123";
      expect(stripeDashboardUrl("pi_1")).toBe("https://dashboard.stripe.com/test/payments/pi_1");
      expect(stripeDashboardUrl("ch_1")).toBe("https://dashboard.stripe.com/test/payments/ch_1");
      expect(stripeDashboardUrl("tr_1")).toBe("https://dashboard.stripe.com/test/connect/transfers/tr_1");
      expect(stripeDashboardUrl("dp_1")).toBe("https://dashboard.stripe.com/test/disputes/dp_1");
      expect(stripeDashboardUrl("pi_1")).not.toContain("secret123");
      process.env.STRIPE_SECRET_KEY = "sk_live_secret456";
      expect(stripeDashboardUrl("pi_1")).toBe("https://dashboard.stripe.com/payments/pi_1");
      expect(stripeDashboardUrl("manual")).toBe("");
    } finally {
      process.env.STRIPE_SECRET_KEY = was;
    }
    expect(src("lib/rich.ts")).not.toMatch(/process\.env/); // the client side never sees the key
  });

  it("names in a written line become links with the email after them, never inside an email address", () => {
    const ana = { id: "u1", email: "ana@x.test", name: "Ana", isDeveloper: false, deletedAt: null };
    const r: Rich = linkNames("Ana paid · by ana@x.test · Banana", [ana]);
    expect(plainOf(r)).toBe("Ana (ana@x.test) paid · by ana@x.test · Banana");
    expect(hrefsOf(r)).toEqual(["/app/testers/u1"]);
  });
});

describe("batch 33 §3: a developer's admin box lists their payment failures", () => {
  it("“$10.00 to Ana Silva for their written answers on “Harbor Run” · failed …: <why> · still owed”, then paid later (the reason kept), or settled by the team", async () => {
    const a = await admin();
    const w = await sentWork("10.00");
    await withCard(w.dev.user.id);
    card(false);
    await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 });
    const failed = await db.payment.findFirstOrThrow({ where: { submissionId: w.sub.id, status: "failed" } });
    const line = async () => (await rowsOf<TextVM>("u-failures", a.user.id, w.dev.user.id)).find((x) => x.id === `failure-${failed.id}`)!;
    const head = `$10.00 to Ana Silva (${w.tester.user.email}) for their written answers on “Harbor Run” · failed `;
    const why = failed.failure.trim().replace(/\.$/, "");
    expect(why).not.toBe("");
    expect((await line()).text).toMatch(new RegExp(`^.+ · ${esc(head)}.+: ${esc(why)} · still owed$`));
    expect(hrefsOf((await line()).parts!)).toEqual([tester(w.tester.user.id), testPage(w.testId)]);
    // Paid later through Pay what you owe: the reason stays, the day it was paid follows.
    card(true);
    const { payOwed } = await import("@/lib/server/holds");
    await payOwed(w.dev.user);
    await settle();
    const paid = await db.payment.findUniqueOrThrow({ where: { id: failed.id } });
    expect(paid.status).toBe("charged");
    const day = paid.settledAt!.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    expect((await line()).text).toMatch(new RegExp(`: ${esc(why)} · paid later on ${esc(day)} · pi_`));
    // The team's Approve of a chargeback hold settled it from the reservation: "settled by the team".
    await db.adminAction.create({ data: { adminId: a.user.id, action: "approve-chargeback", targetId: w.dev.user.id, createdAt: paid.settledAt! } });
    expect((await line()).text).toContain("· settled by the team");
    // The admin console's Latest payments never shows the old reason on a payment that went through.
    expect(src("lib/server/adminLists.ts")).toContain('p.failure && p.status === "failed"');
    // On the developer's admin box, under the payments they made.
    const boxes = src("app/admin/AdminBoxes.tsx");
    expect(boxes).toContain('{developer && <Box title="Payment failures" kind="u-failures" arg={userId} page={failures} />}');
    expect(boxes.indexOf('title="Payments they made"')).toBeLessThan(boxes.indexOf('title="Payment failures"'));
  });
});

describe("batch 33 §4: an empty box is its heading with (0) alone", () => {
  it("no “None.” under an empty admin box or console list", () => {
    const html = renderToStaticMarkup(createElement(PagedList, { kind: "u-payments", initial: { rows: [], next: null, total: 0 }, title: "Payments they made", level: 3 }));
    expect(html).toContain("Payments they made (0)");
    expect(html).not.toMatch(/None\.|No open disputes|No lifts waiting|Nothing recorded|No testers yet/);
    expect(html).not.toContain('class="note"');
    for (const f of ["app/admin/AdminBoxes.tsx", "app/admin/page.tsx"]) {
      expect(src(f)).not.toContain("empty=");
      expect(src(f)).not.toContain(">None.<");
    }
    expect(src("app/admin/PagedList.tsx")).not.toContain('empty = "None."');
    expect(src("app/admin/page.tsx")).not.toContain("Payment holds ({held.length})"); // (batch 35 §101) removed
  });
});

describe("batch 33 §6: the console shows only its twelve sections, in order", () => {
  it("Chargeback holds first … Settings last; none of the removed lists", () => {
    const page = src("app/admin/page.tsx");
    const order = [...page.matchAll(/data-console-section="([a-z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["chargebacks", "mine", "mypaused", "suspensions", "outages", "disputes", "reports", "lifts", "noshows", "contact", "settings"]);
    for (const title of ['title="Chargeback holds"', 'title="Your actions"', 'title="Tests you paused"', 'title="Suspensions"', 'title="Open disputes"', 'title="Reports"', 'title="Lifts"', 'title="No-show reports"', 'title="Contact us"']) expect(page).toContain(title);
    for (const gone of ['kind="decided"', 'kind="paused"', 'kind="payments"', 'kind="payouts"', 'kind="users"', 'kind="tests"', "StatTile", "Needs the team today", "Free during launch"]) expect(page, gone).not.toContain(gone);
    // Settings holds the settings to fix, emails and storage, and only shows when one of them has something.
    expect(page).toContain("{settings && (");
    expect(page.indexOf("data-config-problems")).toBeGreaterThan(page.indexOf('data-console-section="settings"'));
    expect(page.indexOf("data-emails-box")).toBeGreaterThan(page.indexOf('data-console-section="settings"'));
    expect(page.indexOf("data-storage-box")).toBeGreaterThan(page.indexOf('data-console-section="settings"'));
    // Outages in a scroll box; the header row untouched.
    expect(page).toContain('data-scroll-box="outages"');
    expect(src("app/admin/AdminNav.tsx")).toContain('href="/app/find" data-admin-find=""');
  });

  it("“Tests you paused” lists only the signed-in admin's pauses still in place; Suspensions lists the accounts suspended now", async () => {
    const a = await admin(), b = await admin();
    const one = await sentWork("10.00"), two = await sentWork("10.00");
    expect((await aact(a.cookie, "pause-test", { id: one.testId, note: "Checking" })).status).toBe(200);
    expect((await aact(b.cookie, "pause-test", { id: two.testId, note: "Checking too" })).status).toBe(200);
    const mineA = await rowsOf<TestVM>("mypaused", a.user.id);
    expect(mineA.map((t) => t.id)).toContain(one.testId);
    expect(mineA.map((t) => t.id)).not.toContain(two.testId);
    expect(mineA.find((t) => t.id === one.testId)!.adminPaused).toBe(true);
    expect((await aact(b.cookie, "unpause-test", { id: one.testId })).status).toBe(200);
    expect((await rowsOf<TestVM>("mypaused", a.user.id)).map((t) => t.id)).not.toContain(one.testId);
    expect(src("app/admin/PagedList.tsx")).toContain('<div className="flex flex-wrap items-center gap-2"><PauseToggle t={t} /></div>');
    // Suspensions
    expect((await aact(a.cookie, "suspend", { id: one.tester.user.id, note: "Spam answers", side: "tester" })).status).toBe(200);
    const s = (await rowsOf<UserVM>("suspensions", a.user.id)).find((x) => x.id === one.tester.user.id)!;
    expect(s.acct.suspended.tester).not.toBe("");
    expect(hrefsOf(s.parts!)).toEqual([tester(one.tester.user.id)]);
    expect((await aact(b.cookie, "unsuspend", { id: one.tester.user.id, side: "tester" })).status).toBe(200);
    expect((await rowsOf<UserVM>("suspensions", a.user.id)).map((x) => x.id)).not.toContain(one.tester.user.id);
  });
});

describe("batch 33 §7: admin pages follow other admins' changes live", () => {
  it("the profile's fingerprint changes on another admin's suspend, reinstate and delete; the console's on any admin's action", async () => {
    const a = await admin(), b = await admin();
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    const v0 = await adminPersonV(t.user.id), c0 = await adminConsoleV();
    expect((await aact(b.cookie, "suspend", { id: t.user.id, note: "Spam answers", side: "tester" })).status).toBe(200);
    const v1 = await adminPersonV(t.user.id), c1 = await adminConsoleV();
    expect(v1).not.toBe(v0);
    expect(c1).not.toBe(c0);
    expect((await aact(b.cookie, "unsuspend", { id: t.user.id, side: "tester" })).status).toBe(200);
    const v2 = await adminPersonV(t.user.id);
    expect(v2).not.toBe(v1);
    expect((await aact(b.cookie, "delete-account", { id: t.user.id, note: "Fraud" })).status).toBe(200);
    expect(await adminPersonV(t.user.id)).not.toBe(v2);
    void a;
  });

  it("the box and the console poll like the other live pages, and a redraw keeps what was typed", () => {
    expect(src("app/admin/AdminBoxes.tsx")).toContain("<AutoRefresh query={`adminPerson=${userId}`} v={liveV} />");
    expect(src("app/admin/page.tsx")).toContain('<AutoRefresh query="adminConsole=1" v={liveV} />');
    expect(src("app/api/pulse/route.ts")).toContain("pv.adminPersonV(adminPerson)");
    const acc = src("app/admin/AccountActions.tsx");
    // The fresher state is taken in place: no key on the whole block (which threw away every typed box); only a box whose side changed starts afresh.
    expect(acc).not.toContain("key={acct.at}");
    expect(acc).toContain("setAcct((now) => (initial.at > now.at ? initial : now));");
    expect(acc).toContain('key={`suspend:${open.join(",")}`}');
    // The lists take the redraw's first rows, each row keeping its own state by its id; a press from before still sends its old "since" (today's refusal).
    const list = src("app/admin/PagedList.tsx");
    expect(list).toContain("setRows([...initial.rows, ...below]);");
    expect(list).toContain("<Row key={r.id} kind={kind} row={r} />");
    expect(acc).toContain("since: previewAt ?? acct.at");
  });
});

describe("batch 33: no <div> inside a <p> on the admin rows (hydration)", () => {
  it("a suspended side's line and Delete are <div>s around their buttons", async () => {
    const a = await admin();
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    expect((await aact(a.cookie, "suspend", { id: t.user.id, note: "Spam answers", side: "tester" })).status).toBe(200);
    const html = renderToStaticMarkup(createElement(AccountActions, { initial: (await accountState(t.user.id))! }));
    expect(html).toContain('<div class="flex flex-wrap items-center gap-2" data-suspended-side="tester">');
    expect(html).not.toMatch(/<p[^>]*data-suspended-side/);
    for (const f of ["app/admin/AccountActions.tsx", "app/admin/PagedList.tsx"]) expect(src(f)).not.toMatch(/<p className="flex flex-wrap items-center gap-2">\s*<(AdminButton|PauseToggle)/);
  });
});
