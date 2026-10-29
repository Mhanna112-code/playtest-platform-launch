import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as webhookPOST } from "@/app/api/stripe/webhook/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { POST as forgotPOST } from "@/app/api/auth/forgot/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { GET as switchGET, POST as switchPOST } from "@/app/app/switch/route";
import { GET as cardGET, POST as cardPOST } from "@/app/api/payments/card/route";
import { POST as alertPOST } from "@/app/api/health/alert/route";
import { finishGoogle, GOOGLE_COOKIE } from "@/lib/server/google";
import { adminUsers } from "@/lib/server/notify";
import { isAdmin, getUserFromRequest } from "@/lib/server/session";
import { PAYMENTS_PROBLEM, fakeOn, setStripeForTests } from "@/lib/server/stripe";
import { clientPressKey, serverKey } from "@/lib/server/pressKeys";
import { approveOutage, recordAlert, alertRefusal, parseAlert } from "@/lib/server/outages";
import { presign, viewUrl } from "@/lib/server/storage";
import { DAILY_UPLOAD_BYTES, UPLOAD_QUOTA_LINE, purgeUploads } from "@/lib/server/recordings";
import { CHAT_PER_MINUTE, CHAT_TOO_FAST } from "@/lib/server/messages";
import { MAX_KEPT, setKept } from "@/lib/server/kept";
import { clientIp } from "@/lib/server/passwords";
import { appUrl } from "@/lib/server/auth";
import { json, makeUser, req } from "./helpers";
import { joined, sact, seen, setup } from "./fixtures";
import { DAY, pay, payMore, sentWork, withCard } from "./b15";

// Batch 15 section 41: the pre-launch security fixes, one block per finding.
afterEach(() => {
  setStripeForTests(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const okStripe = () => {
  const keys: string[] = [];
  setStripeForTests({ paymentIntents: { create: async (_p: unknown, o: { idempotencyKey: string }) => { keys.push(o.idempotencyKey); return { id: "pi_" + randomUUID(), status: "succeeded" }; } } } as unknown as Stripe);
  return keys;
};
const stripeThrowing = (e: Record<string, unknown>) => setStripeForTests({ paymentIntents: { create: async () => { throw Object.assign(new Error("boom"), e); } } } as unknown as Stripe);

describe("C1: press keys can't collide with the server's own keys", () => {
  it("a Pay's key must be a UUID, and is stored wrapped for the developer; a forged 'choice:' / 'dispute-' key is refused", async () => {
    const { dev, sub } = await sentWork();
    for (const forged of [`choice-${sub.id}`, `choice:${sub.id}`, `dispute-${randomUUID()}`, "abcdefgh12"]) {
      const r = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "0", reason: "Not usable", payKey: forged });
      expect(r.status, forged).toBe(400);
    }
    const key = randomUUID();
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, payKey: key })).status).toBe(200);
    expect((await db.review.findFirstOrThrow({ where: { submissionId: sub.id } })).payKey).toBe(`press:${dev.user.id}:${key}`);
    expect(clientPressKey("u1", key)).toBe(`press:u1:${key}`);
    expect(clientPressKey("u1", `choice:${sub.id}`)).toBeNull();
    expect(serverKey("choice", sub.id)).toBe(`choice:${sub.id}`);
  });
  it("the tester's Charge uses its own 'choice:' key, which no developer press can take", async () => {
    const { dev, tester, sessionId, sub } = await sentWork();
    await db.submission.update({ where: { id: sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY) } });
    void dev;
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", tickedCents: 1000, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await db.review.findFirstOrThrow({ where: { submissionId: sub.id } })).payKey).toBe(`choice:${sub.id}`);
  });
});

describe("H1: admin by a confirmed email only; a suspended admin has no access", () => {
  it("ADMIN_EMAILS counts only once the email is confirmed", async () => {
    const owner = await makeUser({ email: "owner@playtest.test", unconfirmed: true }).catch(async () => ({ user: await db.user.update({ where: { email: "owner@playtest.test" }, data: { emailVerifiedAt: null } }), cookie: "" }));
    const u = await db.user.findUniqueOrThrow({ where: { id: owner.user.id } });
    expect(isAdmin(u)).toBe(false);
    expect((await adminUsers()).some((a) => a.id === u.id)).toBe(false);
    const confirmed = await db.user.update({ where: { id: u.id }, data: { emailVerifiedAt: new Date() } });
    expect(isAdmin(confirmed)).toBe(true);
    expect((await adminUsers()).some((a) => a.id === u.id)).toBe(true);
  });
  it("a suspended admin: every admin action is refused with 'Your account is paused.'", async () => {
    const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true, devSuspendedAt: new Date() } });
    const r = await adminPOST(req("/api/admin/stop-test", { cookie: a.cookie, body: { id: "x", note: "x" } }), { params: Promise.resolve({ action: "stop-test" }) }).then(json);
    expect(r).toMatchObject({ status: 403, body: { error: { message: "Your account is paused." } } });
    expect((await adminUsers()).some((x) => x.id === a.user.id)).toBe(false);
  });
});

describe("H2: Google into an unconfirmed account ends the pre-hijack", () => {
  it("clears the password, every session and any payout account, then confirms the email", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    const squat = await makeUser({ unconfirmed: true, tester: true });
    await db.user.update({ where: { id: squat.user.id }, data: { passwordHash: "x", stripeAccountId: "acct_" + randomUUID(), payoutsReady: true } });
    const claims = { iss: "https://accounts.google.com", aud: "cid", exp: Math.floor(Date.now() / 1000) + 600, email: squat.user.email, email_verified: true };
    const idToken = `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id_token: idToken }), { status: 200 }));
    const r = new Request("http://localhost:3400/api/auth/google/callback?code=c&state=s", { headers: { cookie: `${GOOGLE_COOKIE}=s.v` } });
    const done = await finishGoogle(r);
    if (!("user" in done)) throw new Error("expected a sign-in");
    const { user } = done;
    expect(user.id).toBe(squat.user.id);
    expect(user).toMatchObject({ passwordHash: "", stripeAccountId: null, payoutsReady: false });
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(await getUserFromRequest(req("/app", { cookie: squat.cookie }))).toBeNull(); // the squatter's session ended
  });
  it("payout setup needs a confirmed email", () => {
    expect(fs.readFileSync(path.resolve(__dirname, "../src/app/api/payments/payout/route.ts"), "utf8")).toContain("if (!u.emailVerifiedAt && !confirmSkipped()) return Response.redirect(`${base}/app/payments?error=confirm`, 303);");
  });
});

describe("M1: only a card error is a decline", () => {
  it("a rate limit (or any other Stripe problem) fails the Pay with the plain line: no hold, nothing owed, no raw Stripe text", async () => {
    const { dev, sub } = await sentWork();
    await withCard(dev.user.id);
    stripeThrowing({ type: "StripeRateLimitError", message: "Too many requests to api.stripe.com (req_123)" });
    const r = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(r).toMatchObject({ status: 503, body: { error: { code: "payments_problem", message: PAYMENTS_PROBLEM } } });
    expect(JSON.stringify(r.body)).not.toContain("req_123");
    const u = await db.user.findUniqueOrThrow({ where: { id: dev.user.id } });
    expect(u.holdStartedAt).toBeNull();
    expect(await db.payment.count({ where: { submissionId: sub.id, owedUntil: { not: null } } })).toBe(0);
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0); // free to press again
  });
  it("a card error is the decline: the hold starts", async () => {
    const { dev, sub } = await sentWork();
    await withCard(dev.user.id);
    stripeThrowing({ type: "StripeCardError", rawType: "card_error", message: "Your card was declined." });
    const r = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(r.body.error.code).toBe("card_failed");
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).not.toBeNull();
  });
  it("a tester's Charge with a Stripe problem: nothing charged, no hold, it can be pressed again", async () => {
    const { dev, tester, sessionId, sub } = await sentWork();
    await withCard(dev.user.id);
    await db.submission.update({ where: { id: sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY) } });
    stripeThrowing({ type: "StripeAuthenticationError" });
    const r = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", tickedCents: 1000, seenAt: seen(), confirmed: true });
    expect(r.body.error).toMatchObject({ code: "payments_problem", message: PAYMENTS_PROBLEM });
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).toBeNull();
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0);
  });
});

describe("M2: Pay more can't race past its cap or charge twice", () => {
  it("two presses at once over the room: one goes through; the same press repeated charges once", async () => {
    const { dev, testId, sub } = await sentWork();
    await withCard(dev.user.id);
    const keys = okStripe();
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    // Room above the $10 listing: $10 more. Two $6 presses at once: only one fits.
    const [a, b] = await Promise.all([payMore(testId, dev.cookie, { submissionId: sub.id, contractId: sub.contractId, amount: "6.00", tickedCents: 600 }), payMore(testId, dev.cookie, { submissionId: sub.id, contractId: sub.contractId, amount: "6.00", tickedCents: 600 })]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    expect(await db.payment.count({ where: { submissionId: sub.id, kind: "extra", status: { in: ["charged", "not_set_up"] } } })).toBe(1);
    // The same press (same key) again: never twice.
    const key = randomUUID();
    const one = await payMore(testId, dev.cookie, { submissionId: sub.id, contractId: sub.contractId, amount: "1.00", tickedCents: 100, payKey: key });
    const two = await payMore(testId, dev.cookie, { submissionId: sub.id, contractId: sub.contractId, amount: "1.00", tickedCents: 100, payKey: key });
    expect(one.status).toBe(200);
    expect(two.body.repeated).toBe(true);
    expect(keys.filter((k) => k.includes(key))).toHaveLength(1);
  });
});

describe("M3: fail-open settings", () => {
  it("the fake Stripe never runs in production; appUrl never trusts the Host header there", () => {
    vi.stubEnv("STRIPE_FAKE", "1");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(fakeOn()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(fakeOn()).toBe(false);
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(() => appUrl(new Request("https://evil.example/x"))).toThrow("APP_URL is missing");
  });
  it("/dev/outbox is for admins only", () => {
    const page = fs.readFileSync(path.resolve(__dirname, "../src/app/dev/outbox/page.tsx"), "utf8");
    expect(page).toContain("if (!u || !isAdmin(u)) notFound();");
  });
});

describe("M4: outages on the server's clock", () => {
  it("an alert more than 10 minutes off is refused; the key works in a header; over 24 hours waits for an admin", async () => {
    vi.stubEnv("OUTAGE_CHECKS", "1");
    vi.stubEnv("HEALTH_KEY", "a-long-random-health-key-123456");
    const send = (type: number, at: Date, headers: Record<string, string> = {}, key = "") =>
      alertPOST(new Request(`http://localhost:3400/api/health/alert${key ? `?key=${key}` : ""}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ alertType: type, alertDateTime: Math.round(at.getTime() / 1000) }) }));
    expect((await send(1, new Date(Date.now() - 60 * 60_000), { "x-health-key": "a-long-random-health-key-123456" })).status).toBe(400); // an hour off
    expect(alertRefusal(parseAlert({ alertType: 1, alertDateTime: Math.round(Date.now() / 1000) - 300 }))).toBe("");
    expect((await send(1, new Date(), { "x-health-key": "wrong" })).status).toBe(403);
    expect((await send(1, new Date(), { "x-health-key": "a-long-random-health-key-123456" })).status).toBe(200);
    await db.appState.deleteMany({ where: { key: "outage-down" } });
    await db.outage.deleteMany({});
    const { testId } = await setup();
    const { sessionId } = await joined(testId);
    const due0 = (await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).dueAt.getTime();
    const t0 = new Date();
    await recordAlert("down", t0);
    const o = await recordAlert("up", new Date(t0.getTime() + 30 * 3_600_000));
    expect(o!.needsApproval).toBe(true);
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).dueAt.getTime()).toBe(due0); // nothing moved
    const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    await approveOutage(a.user.id, o!.id);
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).dueAt.getTime() - due0).toBe(30 * 3_600_000);
    await expect(approveOutage(a.user.id, o!.id)).rejects.toThrow();
  });
});

describe("M5 and M6: R2 types and clean-up", () => {
  const R2 = { R2_ACCOUNT_ID: "acc", R2_ACCESS_KEY_ID: "key", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "bucket" };
  it("the PUT signs content-type; the GET serves the stored type and disposition", () => {
    for (const [k, v] of Object.entries(R2)) vi.stubEnv(k, v);
    const put = new URL(presign("PUT", "recordings/x/a.pdf", 3600, 10, { contentType: "application/pdf" }));
    expect(put.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    const get = new URL(viewUrl("r1", "recordings/x/a.pdf", "application/pdf", "notes.pdf"));
    expect(get.searchParams.get("response-content-type")).toBe("application/pdf");
    expect(get.searchParams.get("response-content-disposition")).toBe('attachment; filename="notes.pdf"');
    expect(new URL(viewUrl("r1", "recordings/x/a.mp4", "video/mp4", "run.mp4")).searchParams.get("response-content-disposition")).toBe('inline; filename="run.mp4"');
  });
  it("removing a recording deletes its file; the daily purge takes unfinished uploads and files with no row; 3 GB a day", async () => {
    const { testId } = await setup({ recordingCents: "5.00" });
    const { tester, sessionId } = await joined(testId);
    const up = path.resolve(__dirname, "../.test-uploads");
    const s = await sact(sessionId, "recording-start", tester.cookie, { size: 4, contentType: "video/mp4", filename: "a.mp4" });
    const rec = await db.recording.findUniqueOrThrow({ where: { id: s.body.recordingId } });
    fs.mkdirSync(path.dirname(path.join(up, rec.storageKey)), { recursive: true });
    fs.writeFileSync(path.join(up, rec.storageKey), "abcd");
    await db.recording.update({ where: { id: rec.id }, data: { uploadedAt: new Date() } });
    expect((await sact(sessionId, "recording-remove", tester.cookie, { recordingId: rec.id })).status).toBe(200);
    expect(fs.existsSync(path.join(up, rec.storageKey))).toBe(false);
    // An upload never finished (4 hours old), and a file nobody owns.
    const s2 = await sact(sessionId, "recording-start", tester.cookie, { size: 4, contentType: "video/mp4", filename: "b.mp4" });
    await db.recording.update({ where: { id: s2.body.recordingId }, data: { createdAt: new Date(Date.now() - 4 * 3_600_000) } });
    const orphan = path.join(up, "recordings", sessionId, "orphan.mp4");
    fs.writeFileSync(orphan, "x");
    expect(await purgeUploads()).toBeGreaterThanOrEqual(2);
    expect(await db.recording.findUnique({ where: { id: s2.body.recordingId } })).toBeNull();
    expect(fs.existsSync(orphan)).toBe(false);
    // The quota.
    await db.recording.create({ data: { contractId: sessionId, storageKey: "recordings/big", filename: "big.mp4", sizeBytes: 2_000_000_000, contentType: "video/mp4", uploadedAt: new Date() } });
    await db.recording.create({ data: { contractId: sessionId, storageKey: "recordings/big2", filename: "big2.mp4", sizeBytes: DAILY_UPLOAD_BYTES - 2_000_000_000 - 10, contentType: "video/mp4", part: "written", uploadedAt: new Date() } });
    const r = await sact(sessionId, "recording-start", tester.cookie, { size: 100, contentType: "video/mp4", filename: "c.mp4", part: "written" });
    expect(r.body.error.message).toBe(UPLOAD_QUOTA_LINE);
  });
});

describe("L1: headers", () => {
  it("HSTS, Permissions-Policy and the CSP are on every response; no x-powered-by", async () => {
    const cfg = (await import("../next.config")).default;
    expect(cfg.poweredByHeader).toBe(false);
    const [{ headers }] = await cfg.headers!();
    const h = Object.fromEntries(headers.map((x) => [x.key, x.value]));
    expect(h["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains; preload");
    expect(h["Permissions-Policy"]).toContain("geolocation=()");
    expect(h["Permissions-Policy"]).toContain('payment=(self "https://js.stripe.com")');
    for (const part of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "https://js.stripe.com", "https://meet.jit.si"]) expect(h["Content-Security-Policy"]).toContain(part);
  });
});

describe("L2: rate limits", () => {
  it("forgot password: 10 per network an hour (batch 16 section 7: no waitlist any more)", async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 250)}-${randomUUID().slice(0, 6)}`;
    const forgot = () => forgotPOST(req("/api/auth/forgot", { body: { email: `x-${randomUUID()}@playtest.test` }, headers: { "x-real-ip": ip } })).then(json);
    for (let i = 0; i < 10; i++) expect((await forgot()).status).toBe(200);
    expect((await forgot()).status).toBe(429);
  });
  it("chat: 30 messages a minute; kept forms: 50, the oldest dropped; clientIp uses the trusted hop", async () => {
    const { testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await db.message.createMany({ data: Array.from({ length: CHAT_PER_MINUTE }, () => ({ testId, testerId: tester.user.id, contractId: sessionId, senderId: tester.user.id, body: "x" })) });
    expect((await sact(sessionId, "message", tester.cookie, { body: "one more" })).body.error.message).toBe(CHAT_TOO_FAST);
    for (let i = 0; i < MAX_KEPT + 3; i++) await setKept(tester.user.id, `chat:t${i}`, { text: "x" });
    expect(await db.keptForm.count({ where: { userId: tester.user.id } })).toBe(MAX_KEPT);
    expect(await db.keptForm.findUnique({ where: { userId_key: { userId: tester.user.id, key: "chat:t0" } } })).toBeNull();
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" } }))).toBe("2.2.2.2");
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "1.1.1.1", "x-real-ip": "3.3.3.3" } }))).toBe("3.3.3.3");
  });
});

describe("L3: duplicates", () => {
  it("a webhook event delivered twice runs once", async () => {
    const { dev, sub } = await sentWork();
    okStripe();
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    const pi = "pi_" + randomUUID();
    await db.payment.updateMany({ where: { submissionId: sub.id }, data: { stripePaymentIntentId: pi } });
    setStripeForTests({ webhooks: { constructEvent: (raw: string) => JSON.parse(raw) } } as unknown as Stripe);
    const evt = JSON.stringify({ id: "evt_" + randomUUID(), type: "charge.dispute.created", data: { object: { payment_intent: pi } } });
    const send = () => webhookPOST(new Request("http://localhost:3400/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": "t" }, body: evt })).then((r) => r.json());
    expect(await send()).toEqual({ received: true });
    expect(await send()).toEqual({ received: true, duplicate: true });
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { contains: "reversed" } } })).toBeLessThanOrEqual(1);
  });
  it("a doubled Confirm finishes the payment once", async () => {
    const { dev, tester, sub } = await sentWork();
    await withCard(dev.user.id);
    setStripeForTests({ paymentIntents: { create: async () => ({ id: "pi_" + randomUUID(), status: "requires_action", client_secret: "s" }), retrieve: async (id: string) => ({ id, status: "succeeded" }) } } as unknown as Stripe);
    const r = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    const c = () => confirmPOST(req("/api/payments/confirm", { cookie: dev.cookie, body: { paymentId: r.body.paymentId } })).then(json);
    await Promise.all([c(), c()]);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { startsWith: "Nora Lane paid you $10.00" } } })).toBe(1);
  });
});

describe("L5 and L6", () => {
  it("/app/switch changes sides only on a POST from this site; card setup makes Stripe objects only on POST", async () => {
    const both = await makeUser({ dev: true, tester: true });
    await db.user.update({ where: { id: both.user.id }, data: { side: "developer" } });
    const get = await switchGET(req("/app/switch?to=tester&next=/app/find", { cookie: both.cookie }));
    expect(get.headers.get("content-type")).toContain("text/html");
    expect((await db.user.findUniqueOrThrow({ where: { id: both.user.id } })).side).toBe("developer");
    const evil = await switchPOST(new Request("http://localhost:3400/app/switch", { method: "POST", headers: { cookie: both.cookie, origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" }, body: "to=tester&next=/app" }));
    expect(evil.status).toBe(403);
    const ok = await switchPOST(new Request("http://localhost:3400/app/switch", { method: "POST", headers: { cookie: both.cookie, origin: "http://localhost:3400", "content-type": "application/x-www-form-urlencoded" }, body: "to=tester&next=/app/find" }));
    expect(ok.status).toBe(303);
    expect((await db.user.findUniqueOrThrow({ where: { id: both.user.id } })).side).toBe("tester");
    expect((await cardGET(req("/api/payments/card", { cookie: both.cookie }))).headers.get("location")).toContain("/app/payments");
    expect((await cardPOST(new Request("http://localhost:3400/api/payments/card", { method: "POST", headers: { cookie: both.cookie, origin: "https://evil.example" } }))).status).toBe(403);
  });
  it("Sign out of all devices ends every session", async () => {
    const u = await makeUser();
    const { createSession, SESSION_COOKIE } = await import("@/lib/server/session");
    const other = await createSession(u.user.id);
    expect((await logoutPOST(req("/api/auth/logout", { cookie: u.cookie, body: { everywhere: true } }))).status).toBe(200);
    expect(await getUserFromRequest(req("/app", { cookie: `${SESSION_COOKIE}=${other.token}` }))).toBeNull();
    expect(await db.session.count({ where: { userId: u.user.id } })).toBe(0);
  });
});
