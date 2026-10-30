import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as helpPOST } from "@/app/api/help/route";
import { TOPICS } from "@/lib/helpTopics";
import { notify, sendSummaries } from "@/lib/server/notify";
import { requestReset, sendVerification, hashPassword } from "@/lib/server/passwords";
import { adminDailyEmails } from "@/lib/server/adminDaily";
import { chargebackOpened } from "@/lib/server/holds";
import { pauseTest } from "@/lib/server/restrictions";
import { htmlOf } from "@/lib/server/email";
import { emailHtml, esc, EMAIL_FOOTER_LINE, EMAIL_FOOTER_SITE } from "@/lib/server/emailLayout";
import { email as mkEmail, json, makeUser, req, uniq } from "./helpers";
import { setup } from "./fixtures";

// (Owner, Oct 29, batch 30 §19) Branded HTML emails: every email the app sends has the shared layout (the owner's logo at the bottom on a light footer, the main link as a
// button with the plain link under it, the footer lines) beside the same plain text as before.

const BASE = "http://localhost:3400";
const LOGO = `${BASE}/email-logo-full.png`;
const SETTINGS = `${BASE}/app/notifications`;
const mails = (to: string) => db.outboxEmail.findMany({ where: { to }, orderBy: { createdAt: "asc" } });
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");

/** The HTML's visible words, tags dropped and entities read back. */
const words = (html: string) =>
  html
    .replace(/<head>[\s\S]*?<\/head>/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

/** Every email: the logo (absolute, linked to the site, at the bottom), the button with its link under it, the footer, and every line of its text. */
function branded(m: { text: string; html: string }, button: { label: string; url: string }, settings: boolean) {
  const h = m.html;
  expect(h).toMatch(/^<!DOCTYPE html>/);
  expect(h).toContain(`<img src="${LOGO}"`);
  expect(h).toContain('alt="PlaytestPlatform"');
  expect(h).toMatch(new RegExp(`<a href="${BASE}" target="_blank"[^>]*><img src="${LOGO.replace(/[.]/g, "\\.")}"`));
  expect(h).toContain('width="240" height="60"');
  // The logo is in the footer (light background), after the body and before the footer lines.
  const logoAt = h.indexOf(LOGO), footAt = h.indexOf('bgcolor="#f6f7f9"'), lineAt = h.indexOf(EMAIL_FOOTER_LINE);
  expect(footAt).toBeGreaterThan(0);
  expect(logoAt).toBeGreaterThan(footAt);
  expect(lineAt).toBeGreaterThan(logoAt);
  expect(h).toContain(EMAIL_FOOTER_SITE);
  // The button, then the plain link under it.
  const b = h.indexOf(`>${esc(button.label)}</a>`);
  expect(b).toBeGreaterThan(0);
  expect(h).toContain(`<a href="${esc(button.url)}" target="_blank"`);
  expect(h.indexOf(`>${esc(button.url)}</a>`, b)).toBeGreaterThan(b);
  // Notification settings: on summaries and notices, never on confirm / reset.
  expect(h.includes(`href="${SETTINGS}"`) && h.includes(">Notification settings</a>")).toBe(settings);
  expect(h).toContain("max-width:560px");
  // The same words as the plain text (an address on its own line is the button's link, or a link).
  const seen = words(h);
  for (const l of m.text.split("\n").map((x) => x.trim()).filter(Boolean)) {
    const plain = l.replace(/\s*https?:\/\/\S+$/, "").replace(/^https?:\/\/\S+$/, "");
    if (plain) expect(seen).toContain(plain.replace(/\s+/g, " "));
  }
}

describe("batch 30 §19: branded HTML emails", () => {
  it("the layout: user text is escaped; a line ending in a link links its words; the button takes the link's own line; the signature stays last", () => {
    const h = emailHtml("Hi", `Ana wrote <b>"hi"</b> & left\n• Ana sent her answers ${BASE}/app/tests/1\n\n${BASE}/x\n\nPlaytest`, { base: BASE, button: { label: "Open Playtest", url: `${BASE}/x` }, settings: true });
    expect(h).toContain("Ana wrote &lt;b&gt;&quot;hi&quot;&lt;/b&gt; &amp; left");
    expect(h).not.toContain("<b>");
    expect(h).toMatch(new RegExp(`<a href="${BASE}/app/tests/1"[^>]*>• Ana sent her answers</a>`));
    expect(h.indexOf(">Open Playtest</a>")).toBeLessThan(h.lastIndexOf(">Playtest</p>"));
    expect(h.match(/>Open Playtest<\/a>/g)).toHaveLength(1);
    // No header logo: the only image is the footer's.
    expect(h.match(/<img /g)).toHaveLength(1);
    // A subject with markup is escaped in the title.
    expect(emailHtml("<x>", "a", { base: BASE })).toContain("<title>&lt;x&gt;</title>");
  });

  it("confirm your email: button, link under it, no Notification settings; the text unchanged", async () => {
    const u = await makeUser({ unconfirmed: true });
    await sendVerification(u.user.id, BASE);
    const [m] = await mails(u.user.email);
    expect(m.subject).toBe("Confirm your email");
    const link = /(http:\/\/localhost:3400\/verify\/\S+)/.exec(m.text)![1];
    expect(m.text.replace(link, "<link>")).toMatch(/^Welcome to Playtest! Confirm your email:\n<link>\n\nThe link works for \d+ hours\.$/);
    branded(m, { label: "Confirm your email", url: link }, false);
  });

  it("reset your password, and choose a password (no password yet): buttons, no Notification settings", async () => {
    const a = await makeUser();
    await db.user.update({ where: { id: a.user.id }, data: { passwordHash: await hashPassword("a-long-password-1") } });
    await requestReset({ email: a.user.email }, BASE, `ip-${uniq()}`);
    const [r] = await mails(a.user.email);
    expect(r.subject).toBe("Reset your password");
    const link = /(http:\/\/localhost:3400\/reset\/\S+)/.exec(r.text)![1];
    expect(r.text).toContain(`Someone (hopefully you) asked to reset the password for ${a.user.email}.\n\nChoose a new one here`);
    branded(r, { label: "Reset your password", url: link }, false);

    const g = await makeUser();
    await requestReset({ email: g.user.email }, BASE, `ip-${uniq()}`);
    const [c] = await mails(g.user.email);
    expect(c.subject).toBe("Choose a password");
    branded(c, { label: "Choose a password", url: /(http:\/\/localhost:3400\/reset\/\S+)/.exec(c.text)![1] }, false);
  });

  it("the daily summary, the payment-updates email and the account-updates email: Open Playtest and Notification settings", async () => {
    const d = await makeUser();
    await db.user.update({ where: { id: d.user.id }, data: { emailPref: "daily", lastSummaryAt: null } });
    await db.notification.create({ data: { userId: d.user.id, text: "Ana sent her written answers for “Harbor <Run>”", link: "/app/tests/abc" } });
    await sendSummaries(new Date(), [d.user.id]);
    const [s] = await mails(d.user.email);
    expect(s.subject).toBe("Your Playtest summary: 1 update");
    expect(s.text).toBe(`• Ana sent her written answers for “Harbor <Run>” ${BASE}/app/tests/abc\n\nPlaytest`);
    expect(s.html).toContain("Harbor &lt;Run&gt;");
    branded(s, { label: "Open Playtest", url: SETTINGS }, true);

    const p = await makeUser();
    await db.user.update({ where: { id: p.user.id }, data: { emailPref: "off" } });
    await db.notification.create({ data: { userId: p.user.id, text: "Nora paid you $8.00", link: "/app/payments", payment: true } });
    await sendSummaries(new Date(), [p.user.id]);
    const [pm] = await mails(p.user.email);
    expect(pm.subject).toBe("Your Playtest payment updates: 1");
    branded(pm, { label: "Open Playtest", url: SETTINGS }, true);

    const o = await makeUser();
    await db.user.update({ where: { id: o.user.id }, data: { emailPref: "off" } });
    await db.notification.create({ data: { userId: o.user.id, text: "The team paused “Harbor Run”", link: "/app", mustEmail: true } });
    await sendSummaries(new Date(), [o.user.id]);
    const [am] = await mails(o.user.email);
    expect(am.subject).toBe("Your Playtest account updates: 1");
    branded(am, { label: "Open Playtest", url: SETTINGS }, true);
  });

  it("a notice to an address without an account: Open Playtest to its page", async () => {
    const to = mkEmail("nobody");
    await notify(to, "You're invited to “Harbor Run”", ["Nora invited you."], "/app/find/xyz");
    const [m] = await mails(to);
    expect(m.text).toBe(`Nora invited you.\n\n${BASE}/app/find/xyz\n\nPlaytest`);
    branded(m, { label: "Open Playtest", url: `${BASE}/app/find/xyz` }, false);
  });

  it("admin emails: the daily admin email, the chargeback email and Contact us messages", async () => {
    const adm = await makeUser({ email: `admin-${uniq()}@playtest.test` });
    await db.user.update({ where: { id: adm.user.id }, data: { isAdmin: true, emailPref: "daily" } });
    const { testId } = await setup();
    await pauseTest(adm.user.id, testId, "Looking");
    await adminDailyEmails(new Date());
    const daily = (await mails(adm.user.email)).filter((m) => m.subject.startsWith("Playtest admin:"));
    expect(daily.length).toBeGreaterThanOrEqual(1);
    branded(daily[0], { label: "Open the admin console", url: `${BASE}/admin` }, true);

    const dev = await makeUser({ dev: true });
    const payee = await makeUser({ tester: true });
    const pi = `pi_${uniq()}`;
    await db.payment.create({ data: { kind: "review", developerId: dev.user.id, testerId: payee.user.id, amountCents: 1234, feeCents: 0, testerCents: 0, status: "paid", stripePaymentIntentId: pi } });
    await chargebackOpened(pi);
    const cb = (await mails("owner@playtest.test")).filter((m) => m.text.includes(pi));
    expect(cb).toHaveLength(1);
    expect(cb[0].subject).toBe("Playtest: new chargeback of $12.34");
    branded(cb[0], { label: "Open the admin console", url: `${BASE}/admin#chargebacks` }, true);

    const sender = await makeUser({ name: "Ana <script>" });
    const message = `Something odd happened ${uniq()} <img src=x onerror=alert(1)>`;
    expect((await json(await helpPOST(req("/api/help", { cookie: sender.cookie, body: { topic: TOPICS[0], message } })))).status).toBe(200);
    const [c] = (await mails("owner@playtest.test")).filter((m) => m.text.includes(message));
    expect(c.subject).toBe(`Contact us: ${TOPICS[0]}`);
    expect(c.html).not.toContain("<img src=x");
    expect(c.html).not.toContain("<script>");
    branded(c, { label: "Open the admin console", url: `${BASE}/admin#contact` }, true);
  });

  it("every sendEmail call names its button; an email stored without HTML gets the layout when it's sent; the dev outbox shows the HTML", () => {
    const callers = ["lib/server/passwords.ts", "lib/server/notify.ts", "lib/server/adminDaily.ts", "lib/server/holds.ts", "app/api/help/route.ts"];
    for (const f of callers) {
      const s = src(f);
      const calls = s.split("sendEmail({").slice(1);
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) expect(c.slice(0, 900)).toContain("button: {");
    }
    // No other file sends email.
    const all: string[] = [];
    const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) && all.push(path.join(d, e.name))));
    walk(path.resolve(__dirname, "../src"));
    const senders = all.filter((f) => /sendEmail\(\{/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(path.resolve(__dirname, "../src"), f).replace(/\\/g, "/"));
    expect(senders.sort()).toEqual([...callers].sort());
    expect(src("lib/server/email.ts")).toContain("html: row.html || htmlOf(");
    expect(htmlOf({ to: "a@b.c", subject: "S", text: "Hello" })).toContain(LOGO);
    const outbox = src("app/dev/outbox/page.tsx");
    expect(outbox).toContain("srcDoc={m.html");
    expect(outbox).toContain('sandbox="allow-popups allow-popups-to-escape-sandbox"');
  });
});
