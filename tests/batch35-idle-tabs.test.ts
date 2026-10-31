import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { POST as keptPOST } from "@/app/api/kept/route";
import { getKept } from "@/lib/server/kept";
import { KEPT_FLUSH_EVENT, flushDraft, flushKept } from "@/lib/useKept";
import { json, makeUser, req } from "./helpers";

// Batch 35 §16 (found on video, Oct 31): "one draft per form, last typed wins" failed on sign-out. Three tabs on one session typed different answers; Log out in
// one tab made that tab send its OLDER text again, and after signing back in every tab showed the first-typed answer. A tab now sends its draft on a flush
// (Log out, leaving, hiding, the side-switch reload) only when it typed since its own last save. The project has no DOM test environment: each tab below follows
// the hook's own steps (typing marks the draft unsent; the save a moment later sends it; a flush asks flushDraft), against the real /api/kept.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");

type Person = Awaited<ReturnType<typeof makeUser>>;
async function post(p: Person, key: string, data: unknown) {
  const r = await json(await keptPOST(req("/api/kept", { cookie: p.cookie, headers: { "x-uid": p.user.id }, body: { key, data } })));
  expect(r.status).toBe(200);
}

/** One tab's copy of the hook's state (useKept's refs), the server's copy already looked at. */
function tab(p: Person, key: string, rule: typeof flushDraft = flushDraft) {
  const s = { value: "", ready: true, cleared: false, saved: false, unsent: false };
  return {
    s,
    /** Typing: the hook schedules a save a moment later (unsent until it goes). */
    type(v: string) { s.value = v; s.unsent = true; },
    /** The moment passes: the save goes. */
    async settle() { s.unsent = false; s.saved = true; await post(p, key, { answers: [s.value] }); },
    /** Log out / pagehide / hidden / the side-switch reload. */
    async flush() {
      const what = rule({ ready: s.ready, cleared: s.cleared, pristine: !s.value, saved: s.saved, unsent: s.unsent });
      if (what === "skip") return false;
      s.unsent = false;
      await post(p, key, what === "empty" ? null : { answers: [s.value] });
      return true;
    },
  };
}
const kept = async (p: Person, key: string) => ((await getKept(p.user.id, key)).data as { answers: string[] } | null)?.answers[0] ?? null;

describe("batch 35 §16: an idle tab never resends its older draft", () => {
  it("flushDraft: only what this tab typed since its last save", () => {
    const base = { ready: true, cleared: false, pristine: false, saved: true, unsent: false };
    expect(flushDraft(base)).toBe("skip"); // idle: its last typing already saved
    expect(flushDraft({ ...base, unsent: true })).toBe("draft");
    expect(flushDraft({ ...base, unsent: true, pristine: true })).toBe("empty"); // emptied within the moment: the draft goes
    expect(flushDraft({ ...base, unsent: true, pristine: true, saved: false })).toBe("skip"); // nothing typed, nothing kept
    expect(flushDraft({ ...base, unsent: true, cleared: true })).toBe("skip"); // sent
    expect(flushDraft({ ...base, unsent: true, ready: false })).toBe("skip"); // the server's copy not looked at yet
  });

  it("three tabs, three answers, Log out in the first: after signing back in the draft is the last typed", async () => {
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    const key = `written:s17-${t.user.id}`;
    const [a, b, c] = [tab(t, key), tab(t, key), tab(t, key)];
    a.type("first answer"); await a.settle();
    b.type("second answer"); await b.settle();
    c.type("third answer, typed last"); await c.settle();
    // Log out in tab A (flushKept), then every tab leaves for the sign-in page (pagehide).
    expect(await a.flush()).toBe(false);
    expect(await b.flush()).toBe(false);
    expect(await c.flush()).toBe(false);
    expect(await kept(t, key)).toBe("third answer, typed last");
  });

  it("the old rule (every tab sends its text) put the first tab's older text back: the bug the video showed", async () => {
    const t = await makeUser({ tester: true, name: "Bo Reyes" });
    const key = `written:s17old-${t.user.id}`;
    const before17: typeof flushDraft = (s) => (!s.ready || s.cleared || (s.pristine && !s.saved) ? "skip" : s.pristine ? "empty" : "draft");
    const [a, c] = [tab(t, key, before17), tab(t, key, before17)];
    a.type("first answer"); await a.settle();
    c.type("last answer"); await c.settle();
    await a.flush(); // Log out in A
    expect(await kept(t, key)).toBe("first answer");
  });

  it("a tab that typed within the moment before Log out still sends it (it is the last typed)", async () => {
    const t = await makeUser({ tester: true, name: "Cy Moss" });
    const key = `written:s17late-${t.user.id}`;
    const [a, b] = [tab(t, key), tab(t, key)];
    a.type("older"); await a.settle();
    b.type("newer"); await b.settle();
    a.type("newest, typed in A just now"); // the save hasn't gone yet
    expect(await b.flush()).toBe(false);
    expect(await a.flush()).toBe(true);
    expect(await kept(t, key)).toBe("newest, typed in A just now");
    // Emptied within the moment: the draft goes.
    a.type(""); expect(await a.flush()).toBe(true);
    expect(await kept(t, key)).toBeNull();
  });

  const g = globalThis as unknown as { window?: EventTarget };
  afterEach(() => { delete g.window; });
  it("flushKept (Log out, Sign out of all devices, the side switch) waits only for the forms that send", async () => {
    g.window = new EventTarget();
    let asked = 0;
    // An idle form adds nothing to `waits`; one with unsent typing adds its request.
    g.window.addEventListener(KEPT_FLUSH_EVENT, () => { asked++; });
    g.window.addEventListener(KEPT_FLUSH_EVENT, (e) => { asked++; (e as CustomEvent<{ waits: Promise<unknown>[] }>).detail.waits.push(Promise.resolve(null)); });
    const at = Date.now();
    await flushKept();
    expect(asked).toBe(2);
    expect(Date.now() - at).toBeLessThan(1000);
  });

  it("the hook's wiring: typing marks it unsent, the save clears it, every flush asks flushDraft", () => {
    const k = src("lib/useKept.tsx");
    // (Batch 35 §65) The same rules, plus only this tab's own edits: draftWrite decides, then the save is marked unsent.
    expect(k).toMatch(/if \(!draftWrite\(\{[^}]*\}\)\) return;\s+unsent\.current = true;\s+const t = setTimeout\(/);
    expect(k).toContain("return !(s.pristine && !s.saved);");
    expect(k).toMatch(/if \(cleared\.current\) return;\s+unsent\.current = false;/);
    expect(k).toContain("const what = flushDraft({ ready: ready.current, cleared: cleared.current, pristine: latest.current.pristine, saved: saved.current, unsent: unsent.current });");
    expect(k).toContain('if (what === "skip") return null;');
    const flush = k.slice(k.indexOf("const flush = () => {"), k.indexOf("const onHide"));
    for (const via of ["onHide", "onLeave", "onFlush"]) expect(k.slice(k.indexOf(`const ${via}`), k.indexOf(`const ${via}`) + 200)).toContain("flush()");
    expect(flush).not.toContain("return send(latest.current.pristine ? null"); // the old unconditional send
    const out = src("components/SignOut.tsx");
    expect(out.match(/await flushKept\(\)/g)?.length).toBe(2); // Log out and Sign out of all devices go through the same forms' flush
  });
});
