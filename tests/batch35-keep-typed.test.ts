import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as keptPOST } from "@/app/api/kept/route";
import { KEPT_FLUSH_EVENT, flushKept } from "@/lib/useKept";
import { TYPED_TTL_MS, dropStaleTyped, keepable, restoreTyped, saveTyped, snapshotOf, typedKey, type FieldEl, type StoreLike } from "@/lib/keepTyped";
import { json, makeUser, req } from "./helpers";

// Batch 35 §6 (owner, Oct 30): a tab that moves because the account switched sides in another tab keeps what was typed: the forms' drafts are sent first, the
// other typed fields are kept in the tab for that same account, side and path. (§8: the side switch only; another account's sign-in snapshots nothing.)
// The project has no DOM test environment: the helpers take plain field and storage objects, and the wiring is checked in the source.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");

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
type Fake = FieldEl & { events: string[]; attrs: Record<string, string> };
const field = (over: Partial<FieldEl> & { noKeep?: boolean }): Fake => {
  const f: Fake = {
    tagName: "INPUT", type: "text", value: "", events: [], attrs: {}, ...over,
    closest: (sel: string) => (sel === "[data-no-keep]" && over.noKeep ? {} : null),
    dispatchEvent: (e: Event) => { f.events.push(e.type); return true; },
    setAttribute: (k: string, v: string) => { f.attrs[k] = v; },
  };
  return f;
};
const select = (id: string, value: string, options: string[], start = options[0]) => field({ tagName: "SELECT", type: undefined, id, value, options: options.map((v) => ({ value: v, defaultSelected: v === start })) });
const root = (fields: Fake[]) => ({ querySelectorAll: () => fields });

/** The page as account A left it. */
const typedPage = () => [
  field({ id: "title", value: "Harbor Run, second pass" }),
  field({ tagName: "TEXTAREA", type: undefined, name: "note", value: "Line one\nLine two" }),
  select("device", "Mac", ["Any", "Mac", "Windows PC"]),
  select("lang", "Any", ["Any", "English"]),
  field({ id: "pw", type: "password", value: "hunter2" }),
  field({ id: "upload", type: "file", value: "C:\\fakepath\\a.png" }),
  field({ id: "secret-id", type: "hidden", value: "x" }),
  field({ id: "agree", type: "checkbox", value: "on" }),
  field({ id: "cardNumber", value: "4242 4242 4242 4242" }),
  field({ id: "billing", autocomplete: "cc-exp", value: "12/30" }),
  field({ id: "iban", value: "DE89 3704" }),
  field({ id: "promo", value: "kept out", noKeep: true }),
  field({ value: "no id or name" }),
  field({ id: "locked", value: "read only", readOnly: true }),
];
/** The same page drawn again (every field empty, the dropdowns on their starting choice). */
const freshPage = () => [
  field({ id: "title" }),
  field({ tagName: "TEXTAREA", type: undefined, name: "note" }),
  select("device", "Any", ["Any", "Mac", "Windows PC"]),
  select("lang", "Any", ["Any", "English"]),
  field({ id: "pw", type: "password" }),
  field({ id: "cardNumber" }),
];

describe("batch 35 §6: what was typed is kept before the tab moves", () => {
  it("keeps typed text boxes and changed dropdowns; never passwords, files, hidden fields, ticks, card or payment fields", () => {
    const snap = snapshotOf(typedPage(), 1000)!;
    expect(snap.at).toBe(1000);
    expect(Object.keys(snap.fields).sort()).toEqual(["#device", "#title", "@note"]);
    expect(snap.fields["#device"]).toEqual({ v: "Mac", start: "Any" });
    expect(JSON.stringify(snap)).not.toMatch(/hunter2|4242|12\/30|DE89|fakepath|kept out/);
    expect(keepable(field({ id: "payout-routing" }))).toBe(false);
    expect(keepable(field({ id: "q1", type: "email" }))).toBe(true);
    expect(snapshotOf([field({ id: "title" })])).toBeNull(); // nothing typed: nothing kept
  });

  it("restores only for the same account, side and path, into empty fields, with the events React needs; then the snapshot goes", () => {
    const s = store();
    const keyA = typedKey("userA", "developer", "/app/tests/t1");
    expect(saveTyped(s, root(typedPage()), keyA, Date.now())).toBe(true);
    // Account B in the same tab, on the same path and side: nothing.
    const b = freshPage();
    expect(restoreTyped(s, root(b), typedKey("userB", "developer", "/app/tests/t1"))).toBe(0);
    expect(b.map((f) => f.value)).toEqual(["", "", "Any", "Any", "", ""]);
    // A on the other side, or on another page: nothing (kept for later).
    expect(restoreTyped(s, root(freshPage()), typedKey("userA", "tester", "/app/tests/t1"))).toBe(0);
    expect(restoreTyped(s, root(freshPage()), typedKey("userA", "developer", "/app/tests/t2"))).toBe(0);
    expect(s.map.has(keyA)).toBe(true);
    // A, same side, same path: back.
    const a = freshPage();
    expect(restoreTyped(s, root(a), keyA)).toBe(3);
    expect(a.map((f) => f.value)).toEqual(["Harbor Run, second pass", "Line one\nLine two", "Mac", "Any", "", ""]);
    expect(a[0].events).toEqual(["input", "change"]);
    expect(a[0].attrs["data-kept-typed"]).toBe("");
    expect(s.map.has(keyA)).toBe(false);
  });

  it("never overwrites what was typed since; fields not drawn yet stay kept; an hour later every snapshot goes, any account's", () => {
    const s = store();
    const key = typedKey("userA", "tester", "/app/sessions/s1");
    const now = Date.now();
    saveTyped(s, root(typedPage()), key, now);
    // Only the title box is on the page so far, and something is already typed in it.
    const early = [field({ id: "title", value: "typed meanwhile" })];
    expect(restoreTyped(s, root(early), key, now)).toBe(0);
    expect(early[0].value).toBe("typed meanwhile");
    // The rest draws later (e.g. after the switch back): filled then; a dropdown changed meanwhile keeps its choice.
    const later = [field({ tagName: "TEXTAREA", type: undefined, name: "note" }), select("device", "Windows PC", ["Any", "Mac", "Windows PC"])];
    expect(restoreTyped(s, root(later), key, now)).toBe(1);
    expect(later.map((f) => f.value)).toEqual(["Line one\nLine two", "Windows PC"]);
    expect(s.map.has(key)).toBe(false);
    // The field being typed in is never filled.
    saveTyped(s, root(typedPage()), key, now);
    const focused = field({ id: "title" });
    restoreTyped(s, root([focused]), key, now, focused);
    expect(focused.value).toBe("");
    // An hour on: dropped (this account's and another account's alike); a fresh one stays.
    const other = typedKey("userB", "developer", "/app");
    saveTyped(s, root(typedPage()), other, now - TYPED_TTL_MS - 1);
    const fresh = typedKey("userC", "developer", "/app");
    saveTyped(s, root(typedPage()), fresh, now);
    dropStaleTyped(s, now);
    expect(s.map.has(other)).toBe(false);
    expect(s.map.has(fresh)).toBe(true);
    expect(restoreTyped(s, root(freshPage()), key, now + TYPED_TTL_MS + 1)).toBe(0);
    expect(s.map.has(key)).toBe(false);
  });

  it("storage blocked: nothing kept, nothing thrown", () => {
    const blocked = { get length(): number { throw new Error("blocked"); }, key: () => { throw new Error("blocked"); }, getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } } as StoreLike;
    expect(saveTyped(blocked, root(typedPage()), "k")).toBe(false);
    expect(restoreTyped(blocked, root(freshPage()), "k")).toBe(0);
    expect(() => dropStaleTyped(blocked)).not.toThrow();
  });
});

describe("batch 35 §6: the forms' drafts are sent before a side switch reloads the tab", () => {
  const g = globalThis as unknown as { window?: EventTarget };
  afterEach(() => { delete g.window; });

  it("flushKept asks every mounted form to send now and waits for them (at most a moment)", async () => {
    g.window = new EventTarget();
    let sent = false;
    g.window.addEventListener(KEPT_FLUSH_EVENT, (e) => (e as CustomEvent<{ waits: Promise<unknown>[] }>).detail.waits.push(new Promise((r) => setTimeout(() => { sent = true; r(null); }, 30))));
    await flushKept();
    expect(sent).toBe(true);
    // A request that hangs never holds the reload past the limit.
    g.window = new EventTarget();
    g.window.addEventListener(KEPT_FLUSH_EVENT, (e) => (e as CustomEvent<{ waits: Promise<unknown>[] }>).detail.waits.push(new Promise(() => null)));
    const t = Date.now();
    await flushKept(50);
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it("each mounted form listens; its requests name the page's account; SessionWatch keeps (and sends the drafts) before a side switch only (batch 35 §8)", () => {
    const kept = src("lib/useKept.tsx");
    expect(kept).toContain("window.addEventListener(KEPT_FLUSH_EVENT, onFlush)");
    expect(kept).toContain('headers: { "content-type": "application/json", ...uidHeader() }, body: JSON.stringify({ key, data }), keepalive: true');
    expect(kept).toContain('{ cache: "no-store", headers: uidHeader() }');
    const watch = src("components/SessionWatch.tsx");
    const sideAt = watch.indexOf("await keepTypedBeforeSideSwitch(userId, sideRef.current, pathRef.current);");
    expect(sideAt).toBeGreaterThan(0);
    expect(watch.indexOf("window.location.reload()", sideAt)).toBeGreaterThan(sideAt);
    // (Batch 35 §8) Another account signing in: nothing is snapshotted (this tab's snapshots go instead).
    const acctAt = watch.indexOf("window.location.replace(landingOfNewSignIn())");
    expect(acctAt).toBeGreaterThan(0);
    expect(watch.slice(watch.lastIndexOf("s.userId !== userId", acctAt), acctAt)).toContain("forgetTyped();");
    expect(watch.slice(watch.lastIndexOf("s.userId !== userId", acctAt), acctAt)).not.toContain("saveTyped");
    expect(watch).toContain("await flushKept().catch(() => null);");
    expect(watch).toContain("typedKey(userId, side, path)");
  });

  it("a draft sent from account A's page with account B's cookie is refused (A's text is never kept for B)", async () => {
    const a = await makeUser({ tester: true, name: "Ana Silva" });
    const b = await makeUser({ tester: true, name: "Bo Reyes" });
    const r = await json(await keptPOST(req("/api/kept", { cookie: b.cookie, headers: { "x-uid": a.user.id }, body: { key: "written:x", data: { answers: ["A's words"] } } })));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("account_changed");
    expect(await db.keptForm.count({ where: { userId: b.user.id } })).toBe(0);
    expect((await json(await keptPOST(req("/api/kept", { cookie: b.cookie, headers: { "x-uid": b.user.id }, body: { key: "written:x", data: { answers: ["B's words"] } } })))).status).toBe(200);
  });
});
