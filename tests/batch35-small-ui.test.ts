import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type Stripe from "stripe";
import type { User } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as signupPOST } from "@/app/api/auth/signup/route";
import { POST as googleFinishPOST } from "@/app/api/auth/google/finish/route";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import SignupPage from "@/app/signup/page";
import { FormMistakes } from "@/components/FormMistakes";
import { callOverBadge } from "@/lib/callMeasure";
import { ALL_BACK, ALL_NOT_CONFIRMED } from "@/lib/confirmAllText";
import { CANCELLED_NOTHING_CHARGED, STILL_WAITS, alreadyConfirmedLine, cancelledCheckLine, cancelledStillWaitsLine } from "@/lib/bankNotice";
import { DEVICES_MISSING, LANGUAGES_MISSING } from "@/lib/options";
import { DISPUTE_PRESS, PRESS_VERBS, pressLabelOf, refusalLine } from "@/lib/pressLabels";
import { BANK_NOT_CONFIRMED } from "@/lib/rules";
import { confirmFinish } from "@/lib/server/confirm";
import { GOOGLE_SIGNUP_COOKIE, startGoogleSignup } from "@/lib/server/google";
import { BIO_TOO_LONG, EMAIL_BAD, EMAIL_TAKEN, NAME_MISSING, PASSWORD_LONG, PASSWORD_SHORT, PRONOUN_BAD, ROLE_MISSING, TERMS_MISSING } from "@/lib/server/passwords";
import { setStripeForTests } from "@/lib/server/stripe";
import { LIMITS } from "@/lib/limits";
import { AGE_LINE } from "@/lib/termsOfUse";
import { json, makeUser, req, uniq } from "./helpers";
import { joined, sact, seen, setup } from "./fixtures";

// Batch 35 §170 (owner, Nov 4): five small fixes. Sign-up lists every mistake on the first press; a paid call's row says its amount once; the Dispute
// refusal names the press Dispute; Cancel this check in another tab says plainly that it worked; an open bank check isn't squeezed by its panel.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, adminAway: () => {}, getPageUser: async () => null }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: (to: string) => { throw Error(`redirect:${to}`); } }));
(globalThis as unknown as { React: typeof React }).React = React;
afterEach(() => setStripeForTests(null));

const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", "src", p), "utf8");
const mail = () => `b35-170-${uniq()}@test.playtest.test`;
const signup = (body: Record<string, unknown>) => signupPOST(req("/api/auth/signup", { body })).then(json);
const finishGoogle = (token: string, body: Record<string, unknown>) => googleFinishPOST(req("/api/auth/google/finish", { body, headers: { cookie: `${GOOGLE_SIGNUP_COOKIE}=${token}` } })).then(json);
/** Does the box `id` on the page take this server line (its data-match)? */
const matches = (markup: string, id: string, line: string) => {
  const m = markup.match(new RegExp(`id="${id}"[^>]*data-match="([^"]+)"`)) ?? markup.match(new RegExp(`data-match="([^"]+)"[^>]*id="${id}"`));
  return !!m && new RegExp(m[1], "i").test(line);
};

describe("§170 (1) sign-up: every mistake on the first press, in the form's order", () => {
  it("an all-empty press returns every line at once: choice, name, email, password, Terms, 18 or older; nothing is made", async () => {
    const r = await signup({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: "bad_field", message: [ROLE_MISSING, NAME_MISSING, EMAIL_BAD, PASSWORD_SHORT, TERMS_MISSING, AGE_LINE].join("\n") });
    // A tester with nothing else: devices and languages come first, then the rest.
    const t = await signup({ role: "tester", email: "", password: "" });
    expect(t.body.error.message).toBe([DEVICES_MISSING, LANGUAGES_MISSING, NAME_MISSING, EMAIL_BAD, PASSWORD_SHORT, TERMS_MISSING, AGE_LINE].join("\n"));
  });

  it("every kind of line together, in order (choice, devices, languages, name, pronoun, bio, email, password, Terms, 18 or older)", async () => {
    const all = await signup({ role: "tester", devices: [], languages: ["Klingon"], name: " ", pronoun: "xe", bio: "x".repeat(LIMITS.bio + 1), email: "not-an-email", password: "x".repeat(201) });
    expect(all.body.error.message).toBe([DEVICES_MISSING, LANGUAGES_MISSING, NAME_MISSING, PRONOUN_BAD, BIO_TOO_LONG, EMAIL_BAD, PASSWORD_LONG, TERMS_MISSING, AGE_LINE].join("\n"));
    // An email already in use is its own line at Email, listed with the others (it used to wait for them).
    const taken = await makeUser();
    const r = await signup({ email: taken.user.email, password: "short" });
    expect(r.body.error.message).toBe([ROLE_MISSING, NAME_MISSING, EMAIL_TAKEN, PASSWORD_SHORT, TERMS_MISSING, AGE_LINE].join("\n"));
    // Only the email and password wrong: just those two (the rest given).
    const email = mail();
    const two = await signup({ email: "nope", password: "", role: "developer", name: "Nora", acceptTerms: "yes", over18: "yes" });
    expect(two.body.error.message).toBe([EMAIL_BAD, PASSWORD_SHORT].join("\n"));
    // All given: made, as before.
    expect((await signup({ email, password: "harbor-run-1", role: "developer", name: "Nora", acceptTerms: "yes", over18: "yes" })).status).toBe(200);
    expect(await db.user.count({ where: { email } })).toBe(1);
    expect(await db.user.count({ where: { email: { in: ["not-an-email", "nope"] } } })).toBe(0);
  });

  it("Google's step (no email or password there): every line at once, in the same order", async () => {
    const who = mail();
    const r = await finishGoogle(await startGoogleSignup(who), {});
    expect(r.body.error).toMatchObject({ code: "bad_field", message: [ROLE_MISSING, NAME_MISSING, TERMS_MISSING, AGE_LINE].join("\n") });
    const t = await finishGoogle(await startGoogleSignup(who), { role: "tester", pronoun: "xe" });
    expect(t.body.error.message).toBe([DEVICES_MISSING, LANGUAGES_MISSING, NAME_MISSING, PRONOUN_BAD, TERMS_MISSING, AGE_LINE].join("\n"));
    expect(await db.user.count({ where: { email: who } })).toBe(0);
  });

  it("the form sends the press even with boxes red, and each line goes red at its own field", async () => {
    const form = renderToStaticMarkup(await SignupPage());
    expect(form).toContain("data-red-and-blue");
    for (const line of [EMAIL_BAD, EMAIL_TAKEN]) expect(matches(form, "email", line)).toBe(true);
    for (const line of [PASSWORD_SHORT, PASSWORD_LONG]) expect(matches(form, "password", line)).toBe(true);
    expect(matches(form, "email", PASSWORD_SHORT)).toBe(false);
    expect(matches(form, "password", EMAIL_BAD)).toBe(false);
    expect(matches(form, "name", NAME_MISSING)).toBe(true);
    expect(matches(form, "acceptTerms", TERMS_MISSING)).toBe(true);
    expect(matches(form, "over18", AGE_LINE)).toBe(true);
  });
});

describe("§170 (2) a paid call's row says its amount once", () => {
  it("the badge 'Took place · 20 min · paid $10.00' and no second 'paid $10.00' on the right; an unpaid call keeps its amount on the right", async () => {
    const f = await setup();
    const j = await joined(f.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["answer", "answer"] });
    const slot = await db.callSlot.create({ data: { testId: f.testId, startsAt: new Date(Date.now() - 3_600_000), minutes: 20, allowedTesterIds: [] } });
    const call = await db.call.create({ data: { slotId: slot.id, contractId: j.sessionId, startsAt: new Date(Date.now() - 3_600_000), minutes: 20, actualMinutes: 20, rateCents: 3000, measuredAt: new Date(), status: "booked" } });
    const dev = await db.user.update({ where: { id: f.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_test" } });
    setStripeForTests({ paymentIntents: {
      create: async () => ({ id: "pi_" + randomUUID(), status: "requires_action", client_secret: "secret_test" }),
      retrieve: async (id: string) => ({ id, status: "succeeded" }),
      cancel: async (id: string) => ({ id, status: "canceled" }),
    } } as unknown as Stripe);
    auth.user = dev;
    const { default: DevPage } = await import("@/app/app/tests/[id]/page");
    const row = async () => {
      const html = renderToStaticMarkup(await DevPage({ params: Promise.resolve({ id: f.testId }), searchParams: Promise.resolve({}) }));
      const at = html.indexOf(`data-over-call="${call.id}"`);
      expect(at).toBeGreaterThan(-1);
      return html.slice(at, html.indexOf("</summary>", at));
    };
    // Not paid yet: the badge says so, the amount so far on the right (unchanged).
    expect(await row()).toContain("not paid yet");
    const r = await reviewPOST(req("/api/review", { cookie: f.dev.cookie, body: { kind: "call", id: call.id, amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true, payKey: randomUUID() } })).then(json);
    if (r.body.requiresAction) await confirmFinish(dev, r.body.paymentId);
    const paid = await row();
    expect(paid).toContain("Took place · 20 min · paid $10.00");
    expect(paid.match(/paid \$10\.00/g)).toHaveLength(1);
    expect(paid).toMatch(/data-call-paid="">\s*<\/span>/);
  });

  it("the badge marks the labels that already name the amount", () => {
    const over = { status: "booked", cancelledBy: null, cancelledAt: null, cancelNote: "" };
    const fmt = (d: Date) => d.toISOString();
    expect(callOverBadge({ ...over, review: { amountCents: 1500, rejected: false, reason: "" } }, { developer: "Nora", tester: "Ana" }, "developer", fmt, 1500, 30)).toMatchObject({ label: "Took place · 30 min · paid $15.00", paidShown: true });
    expect(callOverBadge({ ...over, review: { amountCents: 0, rejected: false, reason: "" } }, { developer: "Nora", tester: "Ana" }, "developer", fmt, 0, 30)).toMatchObject({ label: "Took place · 30 min · Paid $0", paidShown: true });
    expect("paidShown" in callOverBadge({ ...over, review: null }, { developer: "Nora", tester: "Ana" }, "developer", fmt, 0, 30)).toBe(false);
    expect("paidShown" in callOverBadge({ ...over, review: { amountCents: 0, rejected: true, reason: "" } }, { developer: "Nora", tester: "Ana" }, "developer", fmt, 0, 30)).toBe(false);
  });
});

describe("§170 (3) refusals name the press, not the button's sentence", () => {
  const html = (el: React.ReactElement) => renderToStaticMarkup(el);
  it("the tester's Dispute: 'Your Dispute didn't go through: …' (the button still reads Send the dispute)", () => {
    expect(DISPUTE_PRESS).toBe("Dispute");
    expect(DISPUTE_PRESS).toBe(pressLabelOf("/api/sessions/s1/dispute"));
    expect(refusalLine(DISPUTE_PRESS, "This part was already disputed.")).toBe("Your Dispute didn't go through: This part was already disputed.");
    const box = html(createElement(FormMistakes, { text: "This part was already disputed.", press: "Send the dispute", named: DISPUTE_PRESS }));
    expect(box).toContain("Your Dispute didn&#x27;t go through: This part was already disputed.");
    expect(box).not.toContain("Send the dispute didn");
    const form = src("app/app/sessions/[id]/SessionActions.tsx");
    expect(form).toContain('<FormMistakes text={err} press="Send the dispute" named={DISPUTE_PRESS} />');
    expect(form).toContain("refusalLine(DISPUTE_PRESS, meanwhile)");
    expect(form).not.toContain('refusalLine("Send the dispute"');
  });

  it("the written answers' Send my answers and Add to my answer: named Send and Add, as the server's own lines", () => {
    expect(html(createElement(FormMistakes, { text: "The test is paused.", press: "Send my answers", named: PRESS_VERBS.written }))).toContain("Your Send didn&#x27;t go through: The test is paused.");
    expect(html(createElement(FormMistakes, { text: "The test is paused.", press: "Add to my answer", named: PRESS_VERBS["written-add"] }))).toContain("Your Add didn&#x27;t go through: The test is paused.");
    const form = src("app/app/sessions/[id]/SessionActions.tsx");
    expect(form).toContain('press={update ? "Send my answers to the new questions" : "Send my answers"} named={PRESS_VERBS.written}');
    expect(form).toContain('<FormMistakes text={err} press={ADD_PRESS} named={PRESS_VERBS["written-add"]} />');
    // Without `named`, FormMistakes names the button as before.
    expect(html(createElement(FormMistakes, { text: "Your account is paused.", press: "Save profile" }))).toContain("Your Save profile didn&#x27;t go through: Your account is paused.");
  });

  it("guard: no refusal under a button names a sentence ('Send the …', '… my …') as its press", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(d, e.name));
        else if (e.name.endsWith(".tsx")) files.push(path.join(d, e.name));
      }
    };
    walk(path.resolve(__dirname, "..", "src"));
    const bad: string[] = [];
    const sentence = (label: string) => /^Send the |\bmy\b/.test(label);
    for (const f of files) {
      const s = fs.readFileSync(f, "utf8");
      for (const m of s.matchAll(/refusalLine\("([^"]+)"/g)) if (sentence(m[1])) bad.push(`${path.basename(f)}: refusalLine("${m[1]}")`);
      for (const m of s.matchAll(/<(?:FormMistakes|Err)\b[^>]*?press=("([^"]+)"|\{[^}]*"([^"]+)"[^}]*\})[^>]*?\/>/g)) if (!/\bnamed=/.test(m[0]) && sentence(m[2] ?? m[3] ?? "")) bad.push(`${path.basename(f)}: ${m[0].slice(0, 80)}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("§170 (4) Cancel this check in another tab says plainly that it worked", () => {
  const TAB = "tab-small-ui";
  const finish = (cookie: string, body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie, headers: { "x-tab": TAB }, body })).then(json);
  /** Written answers sent, and the developer's Pay of them waiting at the bank (its window open in another tab). */
  async function payOpen(status: { value: string }) {
    const s = await setup({ writtenCents: "10.00" });
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["answer", "answer"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_old" } });
    setStripeForTests({ paymentIntents: {
      create: async () => ({ id: "pi_" + randomUUID(), status: "requires_action", client_secret: "secret", next_action: { type: "redirect_to_url", redirect_to_url: { url: "https://hooks.stripe.com/x", return_url: "http://localhost:3400/api/payments/bank-return" } } }),
      retrieve: async (id: string) => ({ id, status: status.value, client_secret: "secret" }),
      cancel: async (id: string) => ({ id, status: "canceled" }),
    } } as unknown as Stripe);
    const r = await reviewPOST(req("/api/review", { cookie: s.dev.cookie, headers: { "x-tab": TAB }, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 } })).then(json);
    expect(r.body.requiresAction).toBe(true);
    return { ...s, ...j, sub, paymentId: r.body.paymentId as string };
  }

  it("the developer's own Pay, not finished at the bank: 'Cancelled: nothing was charged.' (never 'Your Confirm with your bank didn't go through')", async () => {
    const o = await payOpen({ value: "requires_action" });
    const r = await finish(o.dev.cookie, { paymentId: o.paymentId });
    expect(r.status).toBe(402);
    expect(r.body.error).toMatchObject({ code: "not_confirmed", message: BANK_NOT_CONFIRMED });
    expect(cancelledCheckLine(r.body.error.message, r.body.error.by)).toBe("Cancelled: nothing was charged.");
    expect(await db.payment.findUniqueOrThrow({ where: { id: o.paymentId } })).toMatchObject({ status: "cancelled", actionPi: null });
  });

  it("a charge made while away keeps waiting: 'Cancelled: nothing was charged. It still waits for your bank until <date>.'", async () => {
    const o = await payOpen({ value: "requires_action" });
    await db.payment.update({ where: { id: o.paymentId }, data: { status: "cancelled", actionPi: null } });
    const by = new Date(Date.now() + 2 * 86_400_000);
    const away = await db.payment.create({ data: { kind: "review", developerId: o.dev.user.id, testerId: o.tester.user.id, contractId: o.sessionId, submissionId: o.sub.id, amountCents: 1000, feeCents: 0, testerCents: 1000, status: "needs_confirmation", actionPi: "pi_away_" + randomUUID(), actionBy: by } });
    const r = await finish(o.dev.cookie, { paymentId: away.id });
    expect(r.status).toBe(402);
    expect(r.body.error.message.startsWith(STILL_WAITS)).toBe(true);
    expect(typeof r.body.error.by).toBe("string");
    expect(r.body.error.message).toBe(`${STILL_WAITS} Confirm with your bank by ${r.body.error.by}.`);
    expect(cancelledCheckLine(r.body.error.message, r.body.error.by)).toBe(`Cancelled: nothing was charged. It still waits for your bank until ${r.body.error.by}.`);
    expect(await db.payment.findUniqueOrThrow({ where: { id: away.id } })).toMatchObject({ status: "needs_confirmation", actionBy: by });
  });

  it("Stripe says it had gone through: 'Your bank already confirmed it: paid $10.00.'", async () => {
    const o = await payOpen({ value: "succeeded" });
    const r = await finish(o.dev.cookie, { paymentId: o.paymentId });
    expect(r.status).toBe(200);
    expect(r.body.amountCents).toBe(1000);
    expect(alreadyConfirmedLine("$10.00")).toBe("Your bank already confirmed it: paid $10.00.");
  });

  it("the lines, and the button uses them (BankWaiting); Confirm all's one check keeps its 'each payment is back' tail", () => {
    expect(CANCELLED_NOTHING_CHARGED).toBe("Cancelled: nothing was charged.");
    expect(cancelledStillWaitsLine("Fri, Nov 6, 4:26 PM")).toBe("Cancelled: nothing was charged. It still waits for your bank until Fri, Nov 6, 4:26 PM.");
    expect(cancelledCheckLine(BANK_NOT_CONFIRMED)).toBe(CANCELLED_NOTHING_CHARGED);
    expect(cancelledCheckLine(ALL_NOT_CONFIRMED)).toBe(`Cancelled: nothing was charged. ${ALL_BACK}`);
    expect(cancelledCheckLine(`${STILL_WAITS} Confirm with your bank by Fri, Nov 6, 4:26 PM.`)).toBe(CANCELLED_NOTHING_CHARGED); // no date given: still plain
    const box = src("components/BankWaiting.tsx");
    // (Owner, Nov 4, §188 B) The cancel is one shared function (cancelOwnCheck), used by BankWaiting and the Pay more box.
    expect(box).toContain('if (e instanceof ApiError && e.code === "not_confirmed") return { ok: true, paid: false, line: cancelledCheckLine(e.message, e.data.by) };');
    expect(box).toContain("if (r.ok) finish(r.line);");
    expect(box).toContain("alreadyConfirmedLine(money(r.amountCents))");
  });
});

describe("§170 (5) an open bank check is never squeezed by the panel holding it", () => {
  it("a panel (ResizeBox) or a scroll list holding an open bank check grows to fit it; the cap comes back when the check closes", () => {
    const css = src("app/globals.css");
    expect(css).toMatch(/\[data-panel-box\]:has\(\[data-bank-check\]\),\s*\[data-scroll-list\]:has\(\[data-bank-check\]\)\s*\{[^}]*max-height:\s*none !important;[^}]*height:\s*auto !important;/);
    expect(src("components/Panel.tsx")).toContain("data-panel-box=");
    expect(src("components/ScrollList.tsx")).toContain("data-scroll-list={size}");
    const check = src("components/BankCheck.tsx");
    expect(check).toContain('data-bank-check="bank"');
    expect(check).toContain('data-bank-check="stand-in"');
  });
});
