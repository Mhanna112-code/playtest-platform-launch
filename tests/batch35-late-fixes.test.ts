import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getKept, setKept } from "@/lib/server/kept";
import { DRAFT_START_LINE, START_EMPTY_LABEL } from "@/lib/useKept";
import { loginNext, resetToLogin, toLogin } from "@/lib/client";
import { EVERYONE_MEETS, everyoneMeets } from "@/lib/gaps";
import { CHARGEBACK_STEPS_HREF, checkListing, inviteTestRefusal, pausedUntil, type Listing } from "@/lib/rules";
import { BANNER_TITLES, TestBanner } from "@/app/app/tests/[id]/TestBanner";
import { startHold } from "@/lib/server/holds";
import { makeUser } from "./helpers";
import { act, setup } from "./fixtures";

(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [path.join(dir, d.name)] : []));

// Batch 35 §18-§23 (owner, Oct 31).

describe("batch 35 §18 / §23: a restored draft can always be discarded", () => {
  it("every form's DraftTag has its button whenever the draft came back, not only after a sign-in", () => {
    const files = walk(path.resolve(__dirname, "../src")).filter((f) => !f.endsWith("useKept.tsx"));
    const offenders = files.filter((f) => /onUseSaved=\{keep\w*\.signedIn \?/.test(fs.readFileSync(f, "utf8")) || /\{keep\w*\.signedIn && \w+ !== "" && <DraftTag/.test(fs.readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
    expect(src("app/app/tests/[id]/TopPanel.tsx")).toContain('{keepStop.restored && stopReason !== "" && <DraftTag kind="discard" onUseSaved={() => setStopReason("")} />}');
    expect(src("components/Chat.tsx")).toContain('<DraftTag kind="discard" onUseSaved={() => setText("")} />');
  });

  it("the kept draft says when it was kept; Post / Edit open with “Started from your unsent draft (<time>)” at the top", async () => {
    const u = await makeUser({ dev: true, name: "Nora Lane" });
    await setKept(u.user.id, "test:new", { f: { title: "Harbor Run" }, touched: ["title"], keysText: "" });
    const k = await getKept(u.user.id, "test:new");
    expect(k.data).toMatchObject({ f: { title: "Harbor Run" } });
    expect(new Date((k as { at?: string }).at ?? "").getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(await getKept(u.user.id, "test:none")).toEqual({ data: null });
    expect(DRAFT_START_LINE("Sat, Oct 31, 10:00 AM")).toBe("Started from your unsent draft (Sat, Oct 31, 10:00 AM)");
    expect(START_EMPTY_LABEL).toBe("Start empty");
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain("const fromDraft = keep.restored && (touched.size > 0 || keysChanged);");
    expect(form).toContain("{DRAFT_START_LINE(keep.restoredAt ? fmtDateTime(keep.restoredAt) : \"\")}");
    expect(form).toContain('data-discard-draft="" onClick={discardAll}>{isNew ? START_EMPTY_LABEL : USE_SAVED_ALL_LABEL}</button>');
    // Start empty: every field to the empty start (Edit / a saved draft: what is saved), the keys too, and the draft goes.
    const discard = form.slice(form.indexOf("const discardAll = () => {"), form.indexOf("void keep.clear();", form.indexOf("const discardAll")) + 20);
    expect(discard).toContain("setF(edit || draft ? base : toForm(init));");
    expect(discard).toContain("setTouched(new Set());");
    expect(discard).toContain("setKeysText(savedKeysText);");
    expect(form.indexOf("{fromDraft && (")).toBeLessThan(form.indexOf("marks the fields you have to fill in."));
    expect(src("lib/useKept.tsx")).toContain('setRestoredAt(r.at ?? "");');
  });

  it("(§23) a new Post has nothing saved: Discard at each field and Start empty, never Use saved; a saved draft and Edit keep Use saved", () => {
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain("const isNew = !edit && !draft;");
    expect(form).toContain('const draftKind = isNew ? "discard" : "saved";');
    expect(form).toContain("<DraftTag kind={draftKind} field={where} onUseSaved={() => putSaved(ks)} />");
    expect(form).toContain('<DraftTag kind={draftKind} field="keys"');
    expect(form).toContain("onClick={isNew ? discardAll : putAllSaved}>{isNew ? START_EMPTY_LABEL : USE_SAVED_ALL_LABEL}</button>");
    expect(form).not.toMatch(/<DraftTag kind="saved" field=\{where\}/);
  });
});

// ---- §19: a fake page for FieldChecks (the project has no DOM test environment) ----
class FakeNote { id = ""; textContent = ""; className = ""; isConnected = false; attrs: Record<string, string> = {}; setAttribute(k: string, v: string) { this.attrs[k] = v; } remove() { this.isConnected = false; } }
class FakeField {
  dataset: Record<string, string | undefined> = {}; value = ""; disabled = false; isConnected = true; id = ""; attrs: Record<string, string> = {}; classes = new Set<string>(); offByFieldset = false; note: FakeNote | null = null;
  classList = { add: (c: string) => void this.classes.add(c), remove: (c: string) => void this.classes.delete(c) };
  matches(sel: string) { return sel === ":disabled" && (this.disabled || this.offByFieldset); }
  closest() { return null; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  insertAdjacentElement(_where: string, n: FakeNote) { n.isConnected = true; this.note = n; return n; }
  get red() { return this.attrs["aria-invalid"] === "true" && this.classes.has("field-bad") && !!this.note?.isConnected; }
}
const g = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};
const GLOBALS = ["HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "document", "window"];
beforeAll(() => {
  for (const k of GLOBALS) saved[k] = g[k];
  g.HTMLInputElement = class extends FakeField { type = "text"; };
  g.HTMLTextAreaElement = class extends FakeField {};
  g.HTMLSelectElement = class extends FakeField {};
  g.document = { createElement: () => new FakeNote(), getElementById: () => null };
  g.window = new EventTarget();
});
afterAll(() => { for (const k of GLOBALS) { if (saved[k] === undefined) delete g[k]; else g[k] = saved[k]; } });

const RATE_MISSING = "Enter an hourly rate for live calls, or tick Free.";
/** The live call's rate box as TestForm draws it while its part is ticked and Free isn't. */
function rateBox() {
  const el = new (g.HTMLInputElement as new () => FakeField)();
  el.id = "liveRateCents";
  Object.assign(el.dataset, { money: "", min: "10", max: "200", zeroOk: "", required: "", requiredMsg: RATE_MISSING, match: "^Enter an hourly rate" });
  return el;
}
/** What TestForm does to the box when Free is ticked (or the part unticked): disabled, no longer required. */
const tickFree = (el: FakeField) => { el.disabled = true; delete el.dataset.required; delete el.dataset.requiredMsg; };
const untickFree = (el: FakeField) => { el.disabled = false; el.dataset.required = ""; el.dataset.requiredMsg = RATE_MISSING; };
const rootOf = (fields: FakeField[]) => ({ querySelectorAll: (sel: string) => (sel.includes("aria-invalid") ? fields.filter((f) => f.attrs["aria-invalid"] === "true" || f.dataset.redMsg != null) : sel === "[data-match]" ? fields.filter((f) => f.dataset.match) : fields), contains: () => true });

describe("batch 35 §19: a field that becomes disabled never keeps its red mark or line", () => {
  it("the rate box left empty is red; ticking Free clears it at once (no blur), every time; unticking and leaving it empty makes it red again", async () => {
    const fc = await import("@/components/FieldChecks");
    const rate = rateBox();
    const other = new (g.HTMLInputElement as new () => FakeField)();
    Object.assign(other.dataset, { required: "", requiredMsg: "Enter the product name." });
    const root = rootOf([rate, other]);
    // Leaving the empty box: red with its line, listed under the button.
    expect(fc.showField(rate as unknown as Element)).toBe(false);
    fc.showField(other as unknown as Element);
    expect(rate.red).toBe(true);
    expect(rate.note?.textContent).toBe(RATE_MISSING);
    expect(fc.redFields(root as unknown as Element).map((r) => r.text)).toEqual([RATE_MISSING, "Enter the product name."]);
    // Free ticked while the box still has the cursor: the box goes disabled; its red goes with the re-check (the change event / the attribute watch).
    tickFree(rate);
    fc.recheckRed();
    expect(rate.red).toBe(false);
    expect(rate.note?.isConnected).toBe(false);
    expect(rate.attrs["aria-invalid"]).toBeUndefined();
    expect(fc.redFields(root as unknown as Element).map((r) => r.text)).toEqual(["Enter the product name."]); // the other field keeps its own red
    // Free unticked: the box is back, not red until it's left empty again.
    untickFree(rate);
    fc.recheckRed();
    expect(rate.red).toBe(false);
    fc.showField(rate as unknown as Element); // left empty again
    expect(rate.red).toBe(true);
    // Free ticked again: cleared again, at once.
    tickFree(rate);
    fc.recheckRed();
    expect(rate.red).toBe(false);
    expect(fc.redFields(root as unknown as Element)).toHaveLength(1);
  });

  it("a part unticked (the box disabled, even through its fieldset) and a server line on a box that goes disabled: no red, never in the list; a press skips it", async () => {
    const fc = await import("@/components/FieldChecks");
    const rate = rateBox();
    const root = rootOf([rate]);
    fc.showField(rate as unknown as Element);
    expect(rate.red).toBe(true);
    rate.offByFieldset = true; // still data-required: disabled is enough
    fc.recheckRed();
    expect(rate.red).toBe(false);
    expect(fc.isOff(rate as unknown as Element)).toBe(true);
    expect(fc.checkFields(root as unknown as Element)).toBe(true);
    // The server's line for it.
    rate.offByFieldset = false;
    rate.value = "5";
    fc.markServerMistakes(root as unknown as Element, ["Enter an hourly rate of at least $10.00."], () => rate as unknown as Element);
    expect(rate.red).toBe(true);
    rate.disabled = true;
    fc.recheckRed();
    expect(rate.red).toBe(false);
    // A component's own red line on a disabled field isn't listed either.
    const own = new (g.HTMLInputElement as new () => FakeField)();
    own.dataset.redMsg = "Pick a time.";
    own.disabled = true;
    expect(fc.redFields(rootOf([own]) as unknown as Element)).toEqual([]);
  });

  it("the wiring: a change re-checks the red fields after the page redraws; a rule attribute changing re-checks them; TestForm's Free disables the box and drops its required mark", () => {
    const f = src("components/FieldChecks.tsx");
    expect(f).toContain("queueMicrotask(recheckRed); // (batch 35 §19) Free ticked, a part unticked");
    expect(f).toContain("watch?.observe(document.body, { attributes: true, subtree: true, attributeFilter: RULE_ATTRS });");
    expect(f).toContain('export const RULE_ATTRS = ["disabled", "data-required"');
    expect(f).toContain("if (isOff(el)) continue; // (batch 35 §19) a disabled field is never in the list");
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain("disabled={!on || free || pl}");
    expect(form).toContain('{...(on && !free ? { "data-required": "", "data-required-msg": PART_PRICE_MISSING[part.on] } : {})}');
  });
});

describe("batch 35 §20: a 401 keeps the tab's place, and goes to the sign-in page once", () => {
  it("/login?next=<path + hash>; a second redirect (SessionWatch, another request) does nothing; a deleted account: gone=1", () => {
    const calls: string[] = [];
    const w = { location: { pathname: "/app/tests/t1", hash: "#invite", replace: (u: string) => void calls.push(u) } };
    resetToLogin();
    expect(toLogin(false, w)).toBe(true);
    expect(toLogin(false, w)).toBe(false);
    expect(toLogin(true, w)).toBe(false);
    expect(calls).toEqual(["/login?next=%2Fapp%2Ftests%2Ft1%23invite"]);
    // The login page takes it back (its own check).
    const safe = /^\/(app|admin)([/?#]|$)/;
    expect(safe.test(decodeURIComponent(calls[0].slice("/login?next=".length)))).toBe(true);
    expect(src("app/login/page.tsx")).toContain("const safe = (n?: string) => (n && /^\\/(app|admin)([/?#]|$)/.test(n) ? n : undefined);");
    resetToLogin();
    toLogin(true, w);
    expect(calls[1]).toBe("/login?gone=1");
    expect(loginNext({ pathname: "/app" })).toBe("/login?next=%2Fapp");
    resetToLogin();
  });

  it("the wiring: client.ts's 401 and SessionWatch both go through toLogin", () => {
    const c = src("lib/client.ts");
    expect(c).toContain('if (res.status === 401 && typeof window !== "undefined") toLogin(data?.error?.code === "deleted");');
    expect(c).not.toMatch(/window\.location\.href = data\?\.error\?\.code === "deleted" \? "\/login\?gone=1" : "\/login"/);
    const w = src("components/SessionWatch.tsx");
    expect(w).toContain("toLogin(true);");
    expect(w).toContain("toLogin(); // (batch 35 §20)");
    expect(w).not.toContain("window.location.replace(`/login?next=");
  });
});

describe("batch 35 §21: “Everyone you ticked now meets this test's needs” only while it's true", () => {
  it("false after the test's needs changed (Spanish now), when nobody is ticked, or a ticked row isn't known; true when every ticked tester fits", () => {
    const shown = new Map([["ana", { devices: ["Mac"], languages: ["English"] }], ["ben", { devices: ["Mac"], languages: ["English", "Spanish"] }]]);
    expect(everyoneMeets({ devices: ["Mac"], languages: ["English"] }, ["ana", "ben"], shown)).toBe(true);
    expect(everyoneMeets({ devices: ["Mac"], languages: ["Spanish"] }, ["ana", "ben"], shown)).toBe(false); // Ana doesn't list Spanish
    expect(everyoneMeets({ devices: ["Mac"], languages: ["Spanish"] }, ["ben"], shown)).toBe(true);
    expect(everyoneMeets({ devices: [], languages: [] }, [], shown)).toBe(false);
    expect(everyoneMeets({ devices: [], languages: [] }, ["cy"], shown)).toBe(false);
    expect(EVERYONE_MEETS).toBe("Everyone you ticked now meets this test's needs. Press Invite to send.");
    expect(src("lib/server/invites.ts")).toContain(`"${EVERYONE_MEETS}"`); // the server's line reads the same
    const panel = src("app/app/tests/[id]/InvitePanel.tsx");
    expect(panel).toContain("const msgNow = msg === EVERYONE_MEETS && !everyoneMeets(p.options, ticked, shown.current) ? \"\" : msg;");
    expect(panel).toContain('{msgNow && <p className="info" data-invite-msg="">{msgNow}</p>}');
    expect(panel).not.toContain('{msg && <p className="info" data-invite-msg="">');
  });
});

describe("batch 35 §22: a chargeback hold says the chargeback steps, not only paying", () => {
  it("the banner, Invite's refusal and the calls line; a payment hold keeps “until you pay what you owe”", () => {
    expect(BANNER_TITLES.chargeback).toBe("Your tests are paused until the chargeback steps are done.");
    expect(BANNER_TITLES.hold).toBe("Your tests are paused until you pay what you owe.");
    const html = renderToStaticMarkup(createElement(TestBanner, { cause: "chargeback", allowed: "" }));
    expect(html).toContain(`Your tests are paused until <a href="${CHARGEBACK_STEPS_HREF}" class="underline" data-chargeback-steps="">the chargeback steps</a> are done.`);
    expect(CHARGEBACK_STEPS_HREF).toBe("/app/payments#chargeback-steps");
    const t = { status: "open", spots: 3, testersIn: 0, openUntil: null, stoppedAt: null, paused: true };
    expect(inviteTestRefusal({ ...t, chargeback: true }, new Date(), String)).toBe("This test is paused until the chargeback steps are done, so nobody can be invited.");
    expect(inviteTestRefusal(t, new Date(), String)).toBe("This test is paused until you pay what you owe, so nobody can be invited.");
    expect(`${pausedUntil(true)}: calls wait meanwhile.`).toBe("Your tests are paused until the chargeback steps are done: calls wait meanwhile.");
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page).toContain('u.holdStartedAt ? `${pausedUntil(u.holdReason === "chargeback")}: calls wait meanwhile.` : ""');
    expect(page.match(/chargeback: u\.holdReason === "chargeback" \}/g)?.length).toBe(2);
    expect(src("app/api/pulse/route.ts")).toContain('chargeback: u.holdReason === "chargeback" }');
    expect(src("lib/server/invites.ts")).toContain('chargeback: me.holdReason === "chargeback" }');
    expect(src("app/app/layout.tsx")).toContain('u.holdReason === "chargeback" ? <>Your tests are paused after a chargeback.');
  });

  it("the test's own line when the hold starts: by its reason", async () => {
    const a = await setup();
    await startHold(a.dev.user.id, "chargeback");
    expect((await db.testEvent.findFirstOrThrow({ where: { testId: a.testId, kind: "paused" } })).text).toBe("Your tests are paused until the chargeback steps are done");
    const b = await setup();
    await startHold(b.dev.user.id, "unpaid");
    expect((await db.testEvent.findFirstOrThrow({ where: { testId: b.testId, kind: "paused" } })).text).toBe("Your tests are paused until you pay what you owe");
  });
});

describe("batch 35 §24: the question checks only while the written part is on", () => {
  const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    return act(testId, "edit", cookie, { version: v, fields, confirmed: true });
  };
  it("written off: a duplicate question saves (the box isn't shown, nothing to fix; the questions stay as they are); written on: refused", async () => {
    const { dev, testId } = await setup();
    const off = await edit(testId, dev.cookie, { writtenCents: null, questions: ["How did it go?", "How did it go?"] });
    expect(off.status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).writtenCents).toBeNull();
    const on = await edit(testId, dev.cookie, { writtenCents: "10.00", questions: ["Where did you get stuck?", "Where did you get stuck?"] }); // (§13: checked when the questions change)
    expect(on.status).toBe(400);
    expect(JSON.stringify(on.body.error)).toContain("is in the list twice: each question can be there once.");
    const t = { productName: "P", title: "Harbor Run", description: "Sail", buildUrl: "", categories: ["Game"], devices: [], languages: [], spots: 3, writtenCents: null, recordingCents: null, liveRateCents: 3000, liveMinutes: 30, deadlineDays: 7, questions: Array.from({ length: 25 }, (_, i) => `Q${i}?`), openUntil: null, joinMode: "anyone", mature: false, matureWhy: "", ndaText: "" } as unknown as Listing;
    expect(checkListing(t).filter((e) => /questions|question/i.test(e))).toEqual([]);
    expect(checkListing({ ...t, writtenCents: 1000 }).some((e) => e.startsWith("At most"))).toBe(true);
    expect(src("app/app/tests/TestForm.tsx")).toContain('data-red-msg={!f.written ? undefined /* (batch 35 §24)');
  });
});

describe("batch 35 §24: turning the written part back on checks its questions", () => {
  it("duplicates kept while it was off are refused when it's ticked again", async () => {
    const { dev, testId } = await setup();
    const v = async () => (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: await v(), fields: { writtenCents: null, questions: ["How did it go?", "How did it go?"] }, confirmed: true })).status).toBe(200);
    const on = await act(testId, "edit", dev.cookie, { version: await v(), fields: { writtenCents: "10.00" }, confirmed: true });
    expect(on.status).toBe(400);
  });
});

describe("batch 35 §18 (extended): Post / Edit mark every field a restored draft changed, not only after a sign-in", () => {
  it("marks on keep.restored (reload, new tab, another tab's draft), until the draft is saved, posted or emptied", () => {
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain("const marks = keep.restored ? draftMarks(f, base) : {};");
    expect(form).toContain("const keysDraft = keep.restored && keysChanged ?");
    expect(form).not.toMatch(/keep\.signedIn \? draftMarks|keep\.signedIn && keysChanged/);
  });
});
