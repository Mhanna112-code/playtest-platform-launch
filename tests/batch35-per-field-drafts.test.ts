import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { GET as keptGET, POST as keptPOST } from "@/app/api/kept/route";
import { getKept } from "@/lib/server/kept";
import { KEYS_UNIT, NOTES_UNIT, answerUnit, mergeUnits, testUnitOf, unitIsDraft, unitPatch, unitWrites, unitsOf } from "@/lib/draftUnits";
import { draftMarks, formUnits, toForm } from "@/app/app/tests/TestForm";
import { json, makeUser, req } from "./helpers";

// Batch 35 §120 (owner, Nov 2): per-field drafts. Each tab writes only the units it changed; the server keeps each unit's latest value; a reload, a new tab or a
// sign-in shows every unit's latest draft. The project has no DOM test environment: each tab below follows useKeptUnits' own steps (unitWrites on the tab's own
// edit, unitPatch for the write, unitsOf + restore on opening, unitIsDraft / draftMarks for the tags) against the real /api/kept.

(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
type Person = Awaited<ReturnType<typeof makeUser>>;
type F = ReturnType<typeof toForm>;

const listing = {
  productName: "Harbor Run", title: "First 3 levels", description: "Play the first three levels.", mature: false, matureWhy: "", ndaText: "", buildUrl: "https://example.com/b",
  categories: ["Game"], devices: ["Windows PC"], languages: ["English"], spots: 3, deadlineDays: 7, writtenCents: 1000, recordingCents: null, liveRateCents: 3000, liveMinutes: 30,
  writtenRequired: false, recordingRequired: false, liveRequired: false, questions: ["What did you like?", "Where did you get stuck?"], openUntil: "2026-11-20", joinMode: "anyone",
} as unknown as Parameters<typeof toForm>[0];
const SAVED = toForm(listing);

const patch = async (p: Person, key: string, units: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const r = await json(await keptPOST(req("/api/kept", { cookie: p.cookie, headers: { "x-uid": p.user.id }, body: { key, units, ...extra } })));
  expect(r.status).toBe(200);
  return r.body as { kept: boolean; units: string[] };
};
const read = async (p: Person, key: string) => (await json(await keptGET(req(`/api/kept?key=${encodeURIComponent(key)}`, { cookie: p.cookie, headers: { "x-uid": p.user.id } })))).body.data as Record<string, unknown> | null;

/** One Edit tab: its form, what it holds a draft of, and the hook's steps. */
async function editTab(p: Person, key: string) {
  const t = { f: { ...SAVED } as F, keys: "", drafted: new Set<string>(), restored: false };
  // Opening: the server's units come back (useKeptUnits' first look).
  const kept = unitsOf(key, await read(p, key));
  for (const [u, v] of Object.entries(kept)) {
    if (u === KEYS_UNIT) t.keys = String(v);
    else Object.assign(t.f, v);
    t.drafted.add(u);
  }
  t.restored = Object.keys(kept).length > 0;
  return {
    t,
    /** This tab's own edit: only the units it changed are written. */
    async type(p2: Partial<F>) {
      const before = formUnits(t.f, t.keys);
      t.f = { ...t.f, ...p2 };
      const now = formUnits(t.f, t.keys);
      const saved = formUnits(SAVED, "");
      const us = unitWrites({ prev: before, next: now, prevSaved: saved, nextSaved: saved, own: true });
      const body = unitPatch(us, now, saved);
      for (const [u, v] of Object.entries(body)) (v === null ? t.drafted.delete(u) : t.drafted.add(u));
      if (us.length) await patch(p, key, body);
      return us;
    },
    /** The Draft marks the form shows (only on a restored draft, as before). */
    marks: () => (t.restored ? draftMarks(t.f, SAVED, t.drafted) : {}),
  };
}

describe("batch 35 §120: per-field drafts", () => {
  it("two tabs editing different fields: both survive; a new tab shows both as Draft", async () => {
    const dev = await makeUser({ dev: true });
    const key = `test:edit:pf-${dev.user.id}`;
    const a = await editTab(dev, key);
    const b = await editTab(dev, key); // both opened before either typed
    expect(await a.type({ description: "Play the first FOUR levels." })).toEqual(["description"]);
    expect(await b.type({ writtenPrice: "12.00" })).toEqual(["parts"]);
    // The old rule (last typed wins) would have kept only B's form, with A's description gone.
    const c = await editTab(dev, key);
    expect(c.t.f.description).toBe("Play the first FOUR levels.");
    expect(c.t.f.writtenPrice).toBe("12.00");
    expect(c.t.restored).toBe(true);
    expect(c.marks()).toEqual({ description: ["description"], parts: ["writtenPrice"] });
  });

  it("two tabs editing the same field: the later one", async () => {
    const dev = await makeUser({ dev: true });
    const key = `test:edit:pf-same-${dev.user.id}`;
    const a = await editTab(dev, key);
    const b = await editTab(dev, key);
    await a.type({ title: "A's title" });
    await b.type({ title: "B's title" });
    await a.type({ description: "A's steps" }); // A types elsewhere afterwards: its older title is never sent again
    const c = await editTab(dev, key);
    expect(c.t.f.title).toBe("B's title");
    expect(c.t.f.description).toBe("A's steps");
  });

  it("Parts and prices move as ONE unit (all three parts, prices, Required ticks, call length)", async () => {
    expect(["written", "writtenPrice", "recording", "recordingPrice", "live", "liveRate", "liveMinutes", "writtenRequired", "recordingRequired", "liveRequired"].every((k) => testUnitOf(k) === "parts")).toBe(true);
    expect([testUnitOf("mature"), testUnitOf("matureWhy")]).toEqual(["mature", "mature"]);
    expect([testUnitOf("questions"), testUnitOf("requiredQs")]).toEqual(["questions", "questions"]);
    expect([testUnitOf("title"), testUnitOf("openUntil"), testUnitOf("keysText")]).toEqual(["title", "openUntil", KEYS_UNIT]);
    const dev = await makeUser({ dev: true });
    const key = `test:edit:pf-parts-${dev.user.id}`;
    const a = await editTab(dev, key);
    const b = await editTab(dev, key);
    await a.type({ recording: true, recordingPrice: "20.00", liveRate: "40.00" });
    await b.type({ writtenRequired: true }); // the later unit: B's whole Parts and prices (its recording off, its rate) replaces A's
    const c = await editTab(dev, key);
    expect([c.t.f.recording, c.t.f.recordingPrice, c.t.f.liveRate, c.t.f.writtenRequired]).toEqual([false, "", "30.00", true]);
    // Stored in the shape every reader knows: every field of the unit, each listed as touched.
    const data = (await getKept(dev.user.id, key)).data as { f: Record<string, unknown>; touched: string[] };
    expect(Object.keys(data.f).sort()).toEqual(["live", "liveMinutes", "liveRate", "liveRequired", "recording", "recordingPrice", "recordingRequired", "written", "writtenPrice", "writtenRequired"]);
    expect(data.touched.length).toBe(10);
    // Mature and its reason together too.
    await a.type({ mature: true, matureWhy: "Boss fights" });
    const d = await editTab(dev, key);
    expect([d.t.f.mature, d.t.f.matureWhy]).toEqual([true, "Boss fights"]);
    expect(d.marks().mature).toEqual(["mature", "matureWhy"]);
  });

  it("typing in one field never marks another field as Draft (a field with no draft never shows Draft)", async () => {
    const dev = await makeUser({ dev: true });
    const key = `test:edit:pf-tag-${dev.user.id}`;
    const a = await editTab(dev, key);
    await a.type({ description: "A's steps" });
    const c = await editTab(dev, key);
    // Something on C's page differs from the saved value without being a draft (say a live redraw it hasn't caught up with): no Draft there.
    c.t.f.spots = "9";
    expect(await c.type({ title: "C's title" })).toEqual(["title"]); // only the field typed in is written
    expect(c.marks()).toEqual({ description: ["description"], title: ["title"] });
    expect(c.marks().spots).toBeUndefined();
    const saved = formUnits(SAVED, "");
    expect(unitIsDraft(new Set(["title"]), "spots", { ...saved, spots: { spots: "9" } }, saved)).toBe(false);
    expect(unitIsDraft(new Set(["title"]), "title", { ...saved, title: { title: "x" } }, saved)).toBe(true);
    expect(unitIsDraft(new Set(["title"]), "title", saved, saved)).toBe(false); // back to the saved value: no Draft
    // A fresh tab where nothing was kept (no draft at all): typing one field shows no Draft marks anywhere (as before: marks only on a restored draft).
    const fresh = await editTab(await makeUser({ dev: true }), `test:edit:pf-fresh`);
    await fresh.type({ title: "New" });
    expect(fresh.marks()).toEqual({});
  });

  it("an untouched field never overwrites another tab's draft (redraws and another tab's Save never write)", () => {
    const saved = formUnits(SAVED, "");
    const now = { ...saved, title: { title: "typed" } };
    expect(unitWrites({ prev: saved, next: now, prevSaved: saved, nextSaved: saved, own: false })).toEqual([]); // a redraw, the server, another tab
    // Another tab's Save moved the description and this tab's untouched box took it within a moment of a keystroke: not this tab's edit.
    const moved = { ...saved, description: { description: "Saved elsewhere" } };
    expect(unitWrites({ prev: saved, next: { ...moved, title: { title: "typed" } }, prevSaved: saved, nextSaved: moved, own: true })).toEqual(["title"]);
  });

  it("Discard (Use saved) on one field leaves the others", async () => {
    const dev = await makeUser({ dev: true });
    const key = `test:edit:pf-discard-${dev.user.id}`;
    const a = await editTab(dev, key);
    await a.type({ description: "A's steps", writtenPrice: "15.00", title: "A's title" });
    const c = await editTab(dev, key);
    expect(Object.keys(c.marks()).sort()).toEqual(["description", "parts", "title"]);
    expect(await c.type({ description: SAVED.description })).toEqual(["description"]); // Use saved at the description: that unit's draft goes
    expect((await editTab(dev, key)).marks()).toEqual({ parts: ["writtenPrice"], title: ["title"] });
    await c.type({ writtenPrice: SAVED.writtenPrice, title: SAVED.title });
    expect(await read(dev, key)).toBeNull(); // the last unit gone: the draft goes
  });

  it("two writes at the same moment both survive (one person's writes to one form wait for each other)", async () => {
    const dev = await makeUser({ dev: true });
    const key = `test:new`;
    await Promise.all([patch(dev, key, { title: { title: "T" } }), patch(dev, key, { description: { description: "D" } }), patch(dev, key, { [KEYS_UNIT]: "K1\nK2" })]);
    expect(Object.keys(unitsOf(key, await read(dev, key))).sort()).toEqual(["description", KEYS_UNIT, "title"]);
  });

  it("written answers per question: answer 1 in one tab and answer 2 in another both stay", async () => {
    const t = await makeUser({ tester: true });
    const key = `written:pf-${t.user.id}`;
    const qs = ["What did you like?", "Where did you get stuck?"];
    await patch(t, key, { [answerUnit(qs[0])]: "Tab A's answer 1" }, { questions: qs });
    await patch(t, key, { [answerUnit(qs[1])]: "Tab B's answer 2" }, { questions: qs });
    const u = unitsOf(key, await read(t, key), qs);
    expect(u).toEqual({ [answerUnit(qs[0])]: "Tab A's answer 1", [answerUnit(qs[1])]: "Tab B's answer 2" });
    expect(u[NOTES_UNIT]).toBeUndefined(); // the notes were never typed: no draft there
    // An older whole-form draft (no questions list) pairs its answers by place, then merges per question.
    const merged = mergeUnits(key, { answers: ["old 1", "old 2"], notes: "n" }, { [answerUnit(qs[1])]: "new 2" }, qs);
    expect(merged).toEqual({ answers: ["old 1", "new 2"], questions: qs, notes: "n" });
    expect(mergeUnits(key, merged, { [answerUnit(qs[0])]: null, [answerUnit(qs[1])]: null, [NOTES_UNIT]: null })).toBeNull();
  });

  it("the forms are wired to the per-field hook", () => {
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain("useKeptUnits(edit ?");
    expect(form).toContain("const marks = keep.restored ? draftMarks(f, base, keep.drafted) : {};");
    expect(form).toContain("await keep.clear(new Set([...[...touched].map((k) => testUnitOf(k)), ...(keysChanged ? [KEYS_UNIT] : [])]));");
    const written = src("app/app/sessions/[id]/SessionActions.tsx");
    expect(written).toContain("useKeptUnits(`written:${sessionId}`");
    expect(written).not.toContain('api("/api/kept", { key: `written:${sessionId}`, data })');
    const hook = src("lib/useKept.tsx");
    expect(hook).toContain("ownEdit(lastGesture)"); // §65: only this tab's own edits write
    expect(hook).toContain("if (off || !ready.current || cleared.current || !pending.current.size) return null;"); // §16: a flush sends only what is unsent
  });
});
