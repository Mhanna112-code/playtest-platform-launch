import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { pressLabelOf, refusalLine } from "@/lib/pressLabels";
import { keptRefusalLine } from "@/lib/keptRefusal";
import { failedLine } from "@/lib/server/users";
import { Err } from "@/components/Err";
import { FormMistakes } from "@/components/FormMistakes";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { POST as profilePOST } from "@/app/api/profile/route";
import { ALREADY_CONFIRMED } from "@/lib/server/confirm";
import { json, makeUser, req } from "./helpers";

// (Owner, Nov 3, batch 35 §156) "It should always name the refused press." Every press's refusal and stop-once box names its button first ("Your Block didn't go
// through: …"), on the page and in the dashboard top's failed-press line. This guard reads every API route (and every action of the tests / sessions / admin
// routes) and checks that each press has a real label, so a new press can't slip through unnamed.

(globalThis as unknown as { React: typeof React }).React = React;
const API = path.resolve(__dirname, "../src/app/api");
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

/** Every route file under src/app/api, as its path ("/api/calls/x/join") and the methods it exports. */
function routes() {
  const out: { path: string; file: string; methods: string[] }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name === "route.ts") {
        const rel = path.relative(API, dir).split(path.sep).map((s) => (/^\[.+\]$/.test(s) ? "x" : s));
        const src = fs.readFileSync(f, "utf8");
        const methods = [...src.matchAll(/export (?:async function|const) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
        out.push({ path: "/api/" + rel.join("/"), file: src, methods });
      }
    }
  };
  walk(API);
  return out;
}

/** Every press the app's buttons send: each changing route, and for the routes that take an action (tests, sessions, admin) every action they handle. */
function presses() {
  const list: string[] = [];
  for (const r of routes()) {
    if (!r.methods.some((m) => m !== "GET")) continue;
    if (r.path.endsWith("/x/x") || r.path === "/api/admin/x") {
      const base = r.path.slice(0, -1);
      for (const m of r.file.matchAll(/case "([a-z0-9-]+)":/g)) list.push(base + m[1]);
    } else list.push(r.path);
  }
  return [...new Set(list)];
}

/** Sent by no button (a read, or sent by the page itself): they never show a refusal under a press. Each says why. */
const NOT_PRESSES: Record<string, string> = {
  "/api/tests/x/my-gaps": "the join pop-up's check of what the test needs (a read)",
  "/api/tests/x/invite-check": "the invite panel's check of the ticked testers (a read)",
  "/api/tests/x/invite-search": "the invite panel's lists and name search (a read)",
  "/api/tests/x/invite-restore": "(§173) the invite panel's kept ticks after a reload: who is still invitable (a read)",
  "/api/sessions/x/recording-abandon": "sent by the page after an upload failed, to clear its row (the upload's own refusal is named)",
  "/api/sessions/x/terms-pill": "(§268) the contract box's New terms pill pressed (a link to the offer; never refused)",
  "/api/sessions/x/recording-alive": "sent by the page every 20 s while an upload goes up (§212); never shown, never refused to the tester",
  "/api/account/timezone": "sent by the page when the browser's time zone changes",
  "/api/notifications/read": "sent by the page when the bell's lines are shown",
  "/api/kept": "the drafts kept while typing",
  "/api/page-claim": "(§380) opening a test page or a session page claims it for this tab (never a press, never refused)",
  "/api/page-handover": "(§380 J) the copy holding a one-at-a-time page says its press is over, or hands the page to a newer copy",
  "/api/calls/x/room": "the call page's own connection updates",
  "/api/stripe/webhook": "Stripe's own calls",
  "/api/test/race-release": "(§369) the test harness's release of a race hold (404 unless RACE_HOLDS=1)",
  "/api/health/alert": "the monitor's own calls",
  "/api/dev/hook": "a development tool",
};

describe("§156 guard: every press names itself", () => {
  const all = presses();

  it("finds the presses (the parse works)", () => {
    for (const p of ["/api/tests/x/edit", "/api/sessions/x/recording-remove", "/api/admin/pause-test", "/api/blocks", "/api/payments/confirm", "/api/profile", "/api/recordings/x/upload"]) expect(all).toContain(p);
    expect(all.length).toBeGreaterThan(90);
  });

  it("every press has its button's label (never the bare “press”, which names nothing)", () => {
    const unnamed = all.filter((p) => !(p in NOT_PRESSES) && pressLabelOf(p) === "press");
    expect(unnamed).toEqual([]);
  });

  it("the list of non-presses has no stale entries (each is still a route or an action)", () => {
    for (const p of Object.keys(NOT_PRESSES)) expect(all).toContain(p);
  });

  it("the dashboard top's failed-press line names every press too (never “Save” for a press that isn't one)", async () => {
    for (const p of all.filter((x) => !(x in NOT_PRESSES) && !x.startsWith("/api/tests/x/") && !x.startsWith("/api/sessions/x/"))) {
      const line = await failedLine(new Request("http://localhost:3400" + p, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
      expect(line, p).toBe(`Your ${pressLabelOf(p)} didn't go through`);
    }
  });
});

describe("§156: the presses that named nothing now name their button", () => {
  it("route by route, with the body where one route serves several buttons", () => {
    const cases: [string, unknown, string][] = [
      ["/api/sessions/s1/recording-remove", { recordingId: "r" }, "Remove"],
      ["/api/sessions/s1/terms", { choice: "switch" }, "Switch to the new terms"],
      ["/api/sessions/s1/terms", { choice: "keep" }, "Keep my current terms"],
      ["/api/sessions/s1/choose", { choice: "letgo" }, "Let it go"],
      ["/api/sessions/s1/choose", { choice: "charge" }, "Charge"],
      // (Owner, Nov 5, §222) A written question's first answer (it had none) is Answer this question; any other addition is Add.
      ["/api/sessions/s1/written-add", { question: "q1", first: true }, "Answer this question"],
      ["/api/sessions/s1/written-add", { question: "q1" }, "Add"],
      // (Owner, Nov 5, §226) Needs you's Pay for what's new on a paid part (Pay more's route); the Testers list's is Pay more.
      ["/api/tests/t1/pay-extra", { submissionId: "s", press: "Pay" }, "Pay"],
      ["/api/tests/t1/pay-extra", { submissionId: "s" }, "Pay more"],
      ["/api/payments/confirm", { paymentId: "p", start: true }, "Confirm with your bank"],
      ["/api/payments/card", {}, "Add a card"],
      ["/api/payments/card", { press: "Change card" }, "Change card"],
      ["/api/payments/payout", {}, "Connect a payout account"],
      ["/api/payments/subscription", { action: "subscribe" }, "Subscribe for $7/month"],
      ["/api/payments/subscription", { action: "cancel" }, "Cancel subscription"],
      ["/api/payments/subscription", { action: "keep" }, "Keep my subscription"],
      ["/api/payments/verify-card", { check: true }, "Verify a card"],
      ["/api/payments/verify-card", { setupIntent: "s", paymentMethod: "pm" }, "Verify this card"],
      ["/api/payments/owed", { cancelCheck: "c" }, "Cancel this check"],
      ["/api/payments/confirm-all", { cancel: "c" }, "Cancel this check"],
      ["/api/profile", {}, "Save profile"],
      ["/api/account/delete", { confirmed: true }, "Delete account"],
      ["/api/account/side", { side: "tester", add: false }, "Switch to your tester side"],
      ["/api/account/side", { side: "tester", add: true }, "Start testing too"],
      ["/api/account/side", { side: "developer", add: true }, "Start posting tests too"],
      ["/api/account/alerts", { key: "k", off: true }, "Alerts"],
      ["/api/account/notify", { emailPref: "daily" }, "Save"],
      ["/api/blocks", { userId: "u" }, "Block"],
      ["/api/blocks", { userId: "u", action: "unblock" }, "Unblock"],
      ["/api/direct/u1", { body: "hi" }, "Send"],
      ["/api/excerpts", { action: "request" }, "Ask the developer"],
      ["/api/excerpts", { action: "decide", decision: "allow" }, "Allow"],
      ["/api/excerpts", { action: "decide", decision: "deny" }, "Deny"],
      ["/api/excerpts", { action: "remove" }, "Remove"],
      ["/api/reports", { userId: "u" }, "Send to the team"],
      ["/api/help", { topic: "x" }, "Send to the team"],
      ["/api/visits/t1", {}, "Remove"],
      ["/api/chat/open", { contractId: "c" }, "Chat"],
      ["/api/admin/pause-test", {}, "Pause"],
      ["/api/admin/unsuspend", {}, "Reinstate"],
      ["/api/admin/team-close", { scope: "developer" }, "Close all open reviews for $0"],
      ["/api/admin/team-close", { scope: "test" }, "Close this test's open reviews for $0"],
      ["/api/auth/resend", {}, "Resend the link"],
      ["/api/auth/logout", { everywhere: true }, "Sign out of all devices"],
    ];
    for (const [p, body, label] of cases) expect([p, pressLabelOf(p, body)]).toEqual([p, label]);
  });

  it("refusalLine names them first; a line that already names its press anywhere isn't named twice", () => {
    expect(refusalLine("Remove", "This recording was already sent.")).toBe("Your Remove didn't go through: This recording was already sent.");
    expect(refusalLine("Confirm with your bank", "This payment was cancelled.")).toBe("Your Confirm with your bank didn't go through: This payment was cancelled.");
    expect(refusalLine("Save profile", "Your account is paused.")).toBe("Your Save profile didn't go through: Your account is paused.");
    expect(refusalLine("Block", "You already blocked Ana Silva.")).toBe("Your Block didn't go through: You already blocked Ana Silva.");
    expect(refusalLine("Pay", "Your bank didn't confirm the payment, so nothing was charged.")).toBe("Your Pay didn't go through: Your bank didn't confirm the payment, so nothing was charged.");
    const stopped = "Nora Lane stopped the test on Nov 3, so your Send didn't go through. Work you sent is still reviewed.";
    expect(refusalLine("Send my answers", stopped)).toBe(stopped);
  });

  it("Err and FormMistakes name the press under the button (a red form mistake reads as it is)", () => {
    expect(html(createElement(Err, { text: "You already blocked Ana Silva.", press: "Block" }))).toContain("Your Block didn't go through: You already blocked Ana Silva.");
    expect(html(createElement(Err, { text: "\u0001Choose someone to block.", press: "Block" }))).not.toContain("didn't go through");
    expect(html(createElement(FormMistakes, { text: "Your account is paused.", press: "Save profile" }))).toContain("Your Save profile didn't go through: Your account is paused.");
    // The confirm-email refusal keeps its Resend link.
    const confirm = html(createElement(Err, { text: "Confirm your email first. We sent a link to a@b.test.", press: "Post the test" }));
    expect(confirm).toContain("Your Post the test didn't go through: Confirm your email first.");
    expect(confirm).toContain("Resend the link");
  });

  it("the page's components pass their press (source)", () => {
    const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
    expect(src("components/BlockButton.tsx")).toContain('<Err text={err} press="Block" />');
    expect(src("components/BlockButton.tsx")).toContain('<Err text={err} press="Unblock" />');
    expect(src("app/app/sessions/[id]/RecordingUpload.tsx")).toContain('<Err text={err} press="Remove" />');
    expect(src("components/BankWaiting.tsx")).toContain("refusalLine(CONFIRM_WITH_BANK, err)");
    expect(src("components/Excerpts.tsx")).not.toContain('press="Allow / Deny"');
    expect(src("app/admin/AdminButton.tsx")).toContain("refusalLine(label, msg.text)");
    expect(src("app/app/payments/page.tsx")).toContain("refusalLine(refusedPress(code)");
  });
});

describe("§156 end to end: refusals read “Your … didn't go through: …”", () => {
  it("a refused Confirm with your bank (already confirmed in another tab) names it, under the button and kept after the redraw", async () => {
    const dev = await makeUser({ dev: true });
    const tester = await makeUser({ tester: true });
    const p = await db.payment.create({ data: { kind: "review", developerId: dev.user.id, testerId: tester.user.id, amountCents: 500, feeCents: 0, testerCents: 0, status: "charged" } });
    const body = { paymentId: p.id, start: true };
    const r = await json(await confirmPOST(req("/api/payments/confirm", { cookie: dev.cookie, body })));
    expect([r.status, r.body.error.message]).toEqual([409, ALREADY_CONFIRMED]);
    const label = pressLabelOf("/api/payments/confirm", body);
    expect(refusalLine(label, r.body.error.message)).toBe(`Your Confirm with your bank didn't go through: ${ALREADY_CONFIRMED}`);
    expect(keptRefusalLine(label, r.body.error.message)).toMatch(/^Your Confirm with your bank didn't go through: /);
  });

  it("a refused Block names Block; a suspended tester's Block and Save profile reach the dashboard top named (not “Save”)", async () => {
    const me = await makeUser({ tester: true, name: "Ana Silva" });
    const other = await makeUser({ dev: true, name: "Nora Lane" });
    const body = { userId: other.user.id };
    expect((await json(await blocksPOST(req("/api/blocks", { cookie: me.cookie, body })))).status).toBe(200);
    // (Owner, Nov 11, §380) Already blocked is silent now; any refusal still names Block.
    expect((await json(await blocksPOST(req("/api/blocks", { cookie: me.cookie, body })))).body.already).toBe(true);
    expect(html(createElement(Err, { text: "This person isn't available.", press: pressLabelOf("/api/blocks", body) }))).toContain("Your Block didn't go through: This person isn't available.");

    const s = await makeUser({ tester: true });
    await db.user.update({ where: { id: s.user.id }, data: { testerSuspendedAt: new Date() } });
    const blocked = await json(await blocksPOST(req("/api/blocks", { cookie: s.cookie, body })));
    expect(blocked.body.error).toMatchObject({ code: "suspended", failed: "Your Block didn't go through" });
    const unblock = await json(await blocksPOST(req("/api/blocks", { cookie: s.cookie, body: { ...body, action: "unblock" } })));
    expect(unblock.body.error).toMatchObject({ code: "suspended", failed: "Your Unblock didn't go through" });
    const profile = await json(await profilePOST(req("/api/profile", { cookie: s.cookie, body: { name: "X", isTester: true } })));
    expect(profile.body.error).toMatchObject({ code: "suspended", failed: "Your Save profile didn't go through" });
  });
});
