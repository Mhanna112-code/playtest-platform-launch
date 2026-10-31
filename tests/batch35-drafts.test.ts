import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as keptGET, POST as keptPOST } from "@/app/api/kept/route";
import { hashPassword, logIn } from "@/lib/server/passwords";
import { SESSION_COOKIE } from "@/lib/server/session";
import { SIGNED_IN_MARK, SIGN_IN_DRAFTS, TEST_TEXT_FIELDS, signInKeeps, textOnly, trimAtSignIn } from "@/lib/keptText";
import { DRAFT_LABEL, DraftTag, NotSentTag, USE_SAVED_ALL_LABEL, USE_SAVED_LABEL } from "@/lib/useKept";
import { restoreTyped, saveTyped, typedKey, dropAllTyped, type FieldEl, type StoreLike } from "@/lib/keepTyped";
import { draftMarks, toForm } from "@/app/app/tests/TestForm";
import { json, makeUser, req } from "./helpers";

// Batch 35 §8 (owner, Oct 30): drafts after signing back in. Every form comes back with its latest draft (any tab or device) marked "Draft" with "Use saved";
// selections follow ONE switch (SIGN_IN_DRAFTS, lib/keptText.ts): "whole" is in use (the coordinator's lean while the owner reconsiders step 3), so the draft
// comes back whole and each changed field is marked. The project has no DOM test environment: the server is driven through its routes, the form's marks through
// its pure helper, and the wiring is checked in the source.

(globalThis as unknown as { React: typeof React }).React = React; // the components are compiled for React in scope
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const PASSWORD = "drafts-35-password";

/** A person with a password (so they can sign in again through logIn). */
async function person(over: Parameters<typeof makeUser>[0] = {}) {
  const u = await makeUser(over);
  await db.user.update({ where: { id: u.user.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
  return u;
}
const keep = async (cookie: string, uid: string, key: string, data: unknown) => json(await keptPOST(req("/api/kept", { cookie, headers: { "x-uid": uid }, body: { key, data } })));
const read = async (cookie: string, uid: string, key: string) => (await json(await keptGET(req(`/api/kept?key=${encodeURIComponent(key)}`, { cookie, headers: { "x-uid": uid } })))).body.data as Record<string, unknown> | null;
/** Sign out (the session goes), then sign in again: a new session, as on any device. */
async function signBackIn(u: { user: { id: string; email: string }; cookie: string }) {
  await db.session.deleteMany({ where: { userId: u.user.id } });
  const s = await logIn({ email: u.user.email, password: PASSWORD });
  return `${SESSION_COOKIE}=${s.token}`;
}

const listing = {
  productName: "Harbor Run", title: "First 3 levels", description: "Play the first three levels.", mature: false, matureWhy: "", ndaText: "", buildUrl: "https://example.com/b",
  categories: ["Game"], devices: ["Windows PC"], languages: ["English"], spots: 3, deadlineDays: 7, writtenCents: 1000, recordingCents: null, liveRateCents: 3000, liveMinutes: 30,
  writtenRequired: false, recordingRequired: false, liveRequired: false, questions: ["What did you like?", "Where did you get stuck?"], openUntil: "2026-11-20", joinMode: "anyone",
} as unknown as Parameters<typeof toForm>[0];

describe("batch 35 §8: the switch and the wording", () => {
  it("one switch, in use: the whole draft comes back after a sign-in, marked", () => {
    expect(SIGN_IN_DRAFTS).toBe("whole");
    expect(signInKeeps("openUntil")).toBe(true);
    expect(signInKeeps("title")).toBe(true);
    const d = { f: { title: "New name", openUntil: "2026-11-25" }, touched: ["title", "openUntil"], keysText: "" };
    expect(trimAtSignIn("test:edit:x", d)).toEqual({ ...d, [SIGNED_IN_MARK]: true });
    expect(trimAtSignIn("request:t-x", { rows: [{ when: "2026-11-02T10:00" }], minutes: "30" })).toEqual({ rows: [{ when: "2026-11-02T10:00" }], minutes: "30", [SIGNED_IN_MARK]: true });
    // The other setting keeps the written parts only (the coordinator's split for Edit / Post).
    expect(TEST_TEXT_FIELDS).toEqual(["productName", "title", "description", "buildUrl", "ndaText", "matureWhy", "questions"]);
    expect(textOnly("test:edit:x", d)).toEqual({ f: { title: "New name" }, touched: ["title"] });
    expect(trimAtSignIn("request:t-x", { rows: [{ when: "x" }] }, "written")).toBeNull();
    expect(trimAtSignIn("chat:help", { topic: "Payments", message: "Where is my pay?" }, "written")).toEqual({ message: "Where is my pay?", [SIGNED_IN_MARK]: true });
  });

  it("the tag reads Draft; Use saved sits beside it; the kept line is gone", () => {
    expect(DRAFT_LABEL).toBe("Draft");
    expect(USE_SAVED_LABEL).toBe("Use saved");
    expect(USE_SAVED_ALL_LABEL).toBe("Use saved for all");
    expect(html(createElement(NotSentTag, {}))).toContain(">Draft<");
    const tag = html(createElement(DraftTag, { kind: "saved", field: "title", onUseSaved: () => null }));
    expect(tag).toContain(">Draft<");
    expect(tag).toContain('data-use-saved="title"');
    expect(tag).toContain(">Use saved</button>");
    expect(tag).toContain('type="button"'); // never submits the form
    expect(html(createElement(DraftTag, { kind: "saved" }))).not.toContain("Use saved");
    for (const f of ["components/SessionWatch.tsx", "lib/keepTyped.ts"]) expect(src(f)).not.toContain("Kept what you typed before you switched.");
    expect(src("components/SessionWatch.tsx")).not.toContain("data-kept-typed-line");
    for (const f of ["app/app/tests/TestForm.tsx", "app/app/sessions/[id]/SessionActions.tsx", "components/Chat.tsx", "components/RateBox.tsx", "app/app/help/ContactForm.tsx", "app/app/tests/[id]/PayBox.tsx", "app/app/tests/[id]/DisputeSide.tsx", "app/app/tests/[id]/DevCallPanel.tsx", "components/CallRequests.tsx"])
      expect(src(f), f).not.toContain("<NotSentTag />");
  });
});

describe("batch 35 §8: Edit after signing back in", () => {
  it("the draft comes back marked; each changed field (text, dates, prices, ticks) is marked Draft with its own Use saved", async () => {
    const dev = await person({ dev: true, name: "Nora Lane" });
    const base = toForm(listing);
    const typed = { ...base, title: "First 4 levels", description: "Play the first four levels.", openUntil: "2026-11-25", writtenPrice: "12.00", requiredQs: ["What did you like?"], mature: true, matureWhy: "Boss fights" };
    const key = "test:edit:t35";
    expect((await keep(dev.cookie, dev.user.id, key, { f: typed, touched: ["title", "description", "openUntil", "writtenPrice", "requiredQs", "mature", "matureWhy"], keysText: "" })).status).toBe(200);
    // Still signed in (a reload, another tab): the draft as typed, not marked (Edit's whole-form tag, as before).
    expect((await read(dev.cookie, dev.user.id, key))?.[SIGNED_IN_MARK]).toBeUndefined();
    const cookie = await signBackIn(dev);
    const back = await read(cookie, dev.user.id, key);
    expect(back?.[SIGNED_IN_MARK]).toBe(true);
    const f = { ...base, ...(back!.f as object) } as typeof base;
    expect(f.title).toBe("First 4 levels");
    expect(f.openUntil).toBe("2026-11-25");
    // One mark per place: the parts and prices share one, the questions and their Required ticks share one.
    expect(draftMarks(f, base)).toEqual({ title: ["title"], description: ["description"], mature: ["mature"], matureWhy: ["matureWhy"], parts: ["writtenPrice"], questions: ["requiredQs"], openUntil: ["openUntil"] });
    // Use saved on a field: the saved value back there (and its mark goes); the others stay.
    const afterUse = { ...f, title: base.title };
    expect(draftMarks(afterUse, base).title).toBeUndefined();
    expect(draftMarks(afterUse, base).openUntil).toEqual(["openUntil"]);
    // Nothing differs: no marks.
    expect(draftMarks(base, base)).toEqual({});
    // The form's wiring: a mark (Draft + Use saved) at each field's label, Use saved for all beside Save, (batch 35 §18) on every restored draft; the whole-form tag only when no field differs.
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain("const marks = keep.restored ? draftMarks(f, base) : {};"); // (batch 35 §18) every restored draft, not only after a sign-in
    expect(form).toContain("const keysDraft = keep.restored && keysChanged ?");
    expect(form).toContain('<DraftTag kind={draftKind} field={where} onUseSaved={() => putSaved(ks)} />'); // (batch 35 §23) "Discard" on a new Post
    expect(form).toContain('const draftKind = isNew ? "discard" : "saved";');
    expect(form).toContain("setF((o) => ({ ...o, ...Object.fromEntries(ks.map((k) => [k, base[k]])) }));");
    for (const where of ["description", "matureWhy", "questions", "ndaText", "categories", "languages", "devices", "mature", "parts", "joinMode"]) expect(form, where).toContain(`draftMark("${where}")`);
    expect(form).toContain("{label}{opts.after}{draftMark(k)}</label>"); // Product, Name, Link, Spots, Open until
    expect(form).toContain('<DraftTag kind={draftKind} field="keys" onUseSaved={() => setKeysText(savedKeysText)}');
    expect(form).toContain("onClick={isNew ? discardAll : putAllSaved}>{isNew ? START_EMPTY_LABEL : USE_SAVED_ALL_LABEL}</button>");
    expect(form).toContain("{keep.restored && draftKeys.length === 0 && !keysDraft && <NotSentTag");
    // Saves keep the mark until the draft is sent or emptied (a later reload still shows Draft with Use saved).
    const kept = src("lib/useKept.tsx");
    expect(kept).toContain("void send(mark(latest.current.value));");
    expect(kept).toContain("const after = !!(r.data && typeof r.data === \"object\" && (r.data as Record<string, unknown>)[SIGNED_IN_MARK]);");
  });
});

describe("batch 35 §8: the other forms after signing back in", () => {
  it("a written answer draft comes back as Draft; Use saved reverts it (the saved answers, or empty), and the draft goes", async () => {
    const t = await person({ tester: true, name: "Ana Silva" });
    const key = "written:s35";
    await keep(t.cookie, t.user.id, key, { answers: ["I liked the sailing.", ""], notes: "The map froze once.", questions: ["What did you like?", "Where did you get stuck?"] });
    const cookie = await signBackIn(t);
    const back = await read(cookie, t.user.id, key);
    expect(back).toEqual({ answers: ["I liked the sailing.", ""], notes: "The map froze once.", questions: ["What did you like?", "Where did you get stuck?"], [SIGNED_IN_MARK]: true });
    const s = src("app/app/sessions/[id]/SessionActions.tsx");
    // (Batch 35 §18) Per box: Draft + Use saved under each answer (and the notes) the draft changed; Use saved for all beside Send.
    expect(s).toContain('const boxDraft = (i: number) => (keep.restored && answers[i] !== sentAt(i) ? <DraftTag kind="saved" field={`a${i}`} onUseSaved={() => setAnswers((all) => questions.map((_, j) => (j === i ? sentAt(i) : all[j] ?? "")))} /> : null);');
    expect(s).toContain('const notesDraft = keep.restored && notes !== initialNotes ? <DraftTag kind="saved" field="notes" onUseSaved={() => setNotes(initialNotes)} /> : null;');
    expect(s).toContain("{boxDraft(i)}");
    expect(s).toContain("{notesDraft}");
    expect(s).toContain('{keep.restored && !same && <button type="button" className="ml-3 text-sm text-sky-300 underline" data-use-saved-all="" onClick={() => { setAnswers(questions.map((_, i) => initial[i] ?? "")); setNotes(initialNotes); }}>{USE_SAVED_ALL_LABEL}</button>}');
    // Use saved puts the boxes back to what was sent (nothing sent yet: empty), so the form is unchanged and its draft is forgotten.
    expect((await keep(cookie, t.user.id, key, null)).status).toBe(200);
    expect(await read(cookie, t.user.id, key)).toBeNull();
    // The dispute reason, chat, rating, Contact us, End early / Stop: Draft with Discard emptying the box (batch 35 §10); Pay / Pay more: Use saved.
    expect(s).toContain('{keep.restored && reason !== "" && <DraftTag kind="discard" onUseSaved={() => setReason("")} />}');
    expect(src("components/Chat.tsx")).toContain('<DraftTag kind="discard" onUseSaved={() => setText("")} />');
    expect(src("components/RateBox.tsx")).toContain('<DraftTag kind="discard" onUseSaved={() => setComment("")} />');
    expect(src("app/app/tests/[id]/DisputeSide.tsx")).toContain('<DraftTag kind="discard" onUseSaved={() => setText("")} />');
    expect(src("app/app/tests/[id]/PayBox.tsx")).toContain('<DraftTag kind="saved" onUseSaved={useSaved} />');
    expect(src("app/app/help/ContactForm.tsx")).toContain('<DraftTag kind="discard" onUseSaved={() => { setMessage(""); setTopic(""); }} />');
    expect(src("app/app/tests/[id]/TopPanel.tsx")).toContain('{keepStop.restored && stopReason !== "" && <DraftTag kind="discard" onUseSaved={() => setStopReason("")} />}');
    expect(src("app/app/tests/[id]/TopPanel.tsx")).toContain('{keepEnd.restored && reason !== "" && <DraftTag kind="discard" onUseSaved={() => setReason("")} />}');
  });

  it("the Pay / Pay more note is kept now (its keys were missing), and comes back after signing in", async () => {
    const dev = await person({ dev: true, name: "Nora Lane" });
    for (const key of ["pay:submission:p35", "more:call:p35"]) {
      expect((await keep(dev.cookie, dev.user.id, key, { reason: "Thanks for the careful notes." })).status).toBe(200);
    }
    const cookie = await signBackIn(dev);
    expect(await read(cookie, dev.user.id, "pay:submission:p35")).toEqual({ reason: "Thanks for the careful notes.", [SIGNED_IN_MARK]: true });
  });

  it("a selection-only draft (call times) comes back whole too, marked, with Discard clearing it (batch 35 §10)", async () => {
    const dev = await person({ dev: true, name: "Nora Lane" });
    const key = "request:t-t35";
    const data = { rows: [{ when: "2026-11-02T10:00", repeat: "once" }], minutes: "30", ticked: ["c1"] };
    await keep(dev.cookie, dev.user.id, key, data);
    const cookie = await signBackIn(dev);
    expect(await read(cookie, dev.user.id, key)).toEqual({ ...data, [SIGNED_IN_MARK]: true });
    expect(src("app/app/tests/[id]/DevCallPanel.tsx")).toContain('<DraftTag kind="discard" onUseSaved={() => { setRows([newRow()]); setMinutes(""); setTicked([]); }} />');
    expect(src("components/CallRequests.tsx")).toContain('<DraftTag kind="discard" onUseSaved={() => { setRows([newRow()]); setMinutes(""); }} />');
  });

  it("every sign-in marks the drafts (any device): the sign-in itself does it, never stopping the sign-in", () => {
    const session = src("lib/server/session.ts");
    expect(session).toContain("await trimDraftsAtSignIn(userId).catch(() => null);");
    expect(session.indexOf("trimDraftsAtSignIn(userId)")).toBeGreaterThan(session.indexOf("await db.session.create("));
    // Signing out sends what was typed that moment first.
    const out = src("components/SignOut.tsx");
    expect(out.indexOf("await flushKept()")).toBeLessThan(out.indexOf('await api("/api/auth/logout", {})'));
  });
});

function store(): StoreLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}
const box = (id: string, value = ""): FieldEl & { setAttribute: () => void; dispatchEvent: () => boolean } => ({ tagName: "INPUT", type: "text", id, value, setAttribute: () => undefined, dispatchEvent: () => true });
const root = (fields: FieldEl[]) => ({ querySelectorAll: () => fields });

describe("batch 35 §8: the tab's own copy is for a side switch only", () => {
  it("a side switch (still signed in) still keeps the tab's typing, silently", () => {
    const s = store();
    const key = typedKey("userA", "developer", "/app/tests/x/edit");
    expect(saveTyped(s, root([box("search", "harbor")]), key)).toBe(true);
    // Back on the same side, same page, same account: it fills the empty box.
    const again = [box("search")];
    expect(restoreTyped(s, root(again), key)).toBe(1);
    expect(again[0].value).toBe("harbor");
    const watch = src("components/SessionWatch.tsx");
    expect(watch).toContain("await keepTypedBeforeSideSwitch(userId, sideRef.current, pathRef.current);");
    expect(watch).toContain("restoreTyped(store, document.querySelector(\"main\"), key, Date.now(), document.activeElement);");
    expect(watch).not.toContain("setKept(true)");
  });

  it("another account never sees the text: no snapshot on its sign-in, the tab's copies go, and the server keeps each person's drafts apart", async () => {
    // The tab: another account signing in snapshots nothing and drops what the tab held; so do sign-in and sign-out in the tab.
    const s = store();
    saveTyped(s, root([box("search", "A's words")]), typedKey("userA", "tester", "/app"));
    dropAllTyped(s);
    expect(s.map.size).toBe(0);
    const watch = src("components/SessionWatch.tsx");
    const acct = watch.slice(watch.indexOf("s.userId && s.userId !== userId"), watch.indexOf("window.location.replace(landingOfNewSignIn())"));
    expect(acct).toContain("forgetTyped();");
    expect(acct).not.toContain("keepTypedBefore");
    expect(watch).toContain("forgetTyped(); // (Batch 35 §8) this tab's snapshots go at every sign-in and sign-out");
    // The server: B signing in on this browser never touches A's drafts, and B never reads them.
    const a = await person({ tester: true, name: "Ana Silva" });
    const b = await person({ tester: true, name: "Bo Reyes" });
    await keep(a.cookie, a.user.id, "chat:c35", { text: "A's message" });
    const bCookie = await signBackIn(b);
    expect(await read(bCookie, b.user.id, "chat:c35")).toBeNull();
    expect((await db.keptForm.findUnique({ where: { userId_key: { userId: a.user.id, key: "chat:c35" } } }))?.data).toEqual({ text: "A's message" });
    // A page of A's sent with B's cookie is refused.
    expect((await json(await keptGET(req("/api/kept?key=chat%3Ac35", { cookie: bCookie, headers: { "x-uid": a.user.id } })))).status).toBe(409);
    // A signs back in: A's draft comes back, marked.
    const aCookie = await signBackIn(a);
    expect(await read(aCookie, a.user.id, "chat:c35")).toEqual({ text: "A's message", [SIGNED_IN_MARK]: true });
  });
});

describe("batch 35 §8 (owner, Oct 30): the pay note comes back with its amount", () => {
  it("Pay and Pay more keep the amount and rate with the note; Use saved puts all three back and the tick is needed again", () => {
    const src = require("node:fs").readFileSync(require("node:path").join(process.cwd(), "src/app/app/tests/[id]/PayBox.tsx"), "utf8") as string;
    expect(src).toContain("{ reason, amount, rate }");
    expect(src).toContain("setAmount(startAmount);");
    expect(src).toContain("setTicked(false);");
  });
});
