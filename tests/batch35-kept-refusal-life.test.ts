import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentKept, dropKept, keepRefusal, keptPlacement, notePress, resetKept } from "@/lib/keptRefusal";
import { publishShownVersion, setVersionSource, watchNewPageVersion } from "@/lib/pageVersion";

const cleanups: (() => void)[] = [];
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => resetKept());
afterEach(() => { cleanups.splice(0).reverse().forEach((f) => f()); resetKept(); });

describe("batch 35 §116: a kept refusal belongs to its situation and page content", () => {
  it("survives the refusal's own redraw, then drops when the next version shows", async () => {
    const query = "join=kept-life";
    let server = "invite-only";
    publishShownVersion(query, "old-public-listing");
    cleanups.push(setVersionSource(query, async () => server));
    const k = keepRefusal("Apply", "This test is invite only.")!;
    cleanups.push(watchNewPageVersion(() => dropKept(k.id)));
    await flush();
    publishShownVersion(query, "invite-only");
    expect(currentKept()).toBe(k);
    publishShownVersion(query, "invite-only");
    expect(currentKept()).toBe(k);
    server = "anyone-can-join";
    publishShownVersion(query, server);
    expect(currentKept()).toBeNull();
  });

  it("ignores an unresolved baseline and stops observing after cleanup", async () => {
    const query = "join=kept-life-pending";
    let resolve!: (v: string) => void;
    publishShownVersion(query, "before");
    cleanups.push(setVersionSource(query, () => new Promise<string>((done) => { resolve = done; })));
    const k = keepRefusal("Apply", "This test is invite only.")!;
    const stop = watchNewPageVersion(() => dropKept(k.id));
    cleanups.push(stop);
    publishShownVersion(query, "refusal-redraw");
    expect(currentKept()).toBe(k);
    resolve("refusal-redraw");
    await flush();
    stop();
    publishShownVersion(query, "later");
    expect(currentKept()).toBe(k);
    notePress(null, null);
    expect(currentKept()).toBeNull();
  });

  it("keeps the nearest surviving section, otherwise prepends inside main, never body", () => {
    const section = { id: "join-box" }, main = { id: "main" };
    expect(keptPlacement([section.id], () => section, main)).toEqual({ target: section, first: false });
    expect(keptPlacement([section.id], () => null, main)).toEqual({ target: main, first: true });
    expect(keptPlacement([], () => null, null)).toEqual({ target: null, first: true });
    const component = readFileSync(path.resolve("src/components/KeptRefusal.tsx"), "utf8");
    expect(component).toContain('document.querySelector<HTMLElement>("main")');
    expect(component).toContain("anchor.prepend(hostRef.current)");
    expect(component).not.toContain('position: "fixed"');
    expect(component).toContain("watchNewPageVersion(() => dropKept(kept.id))");
    expect(component).toContain("flat(refusalTextOutsideKept(p)).includes(msg)");
    expect(component).toContain('h.className = "empty:hidden"');
  });

  it("an old lifetime cannot clear a newer refusal", async () => {
    const query = "join=kept-life-newer";
    publishShownVersion(query, "one");
    cleanups.push(setVersionSource(query, async () => "one"));
    const old = keepRefusal("Apply", "This test is invite only.")!;
    cleanups.push(watchNewPageVersion(() => dropKept(old.id)));
    await flush();
    notePress(null, null);
    const next = keepRefusal("Join this test", "The last spot was taken.")!;
    publishShownVersion(query, "two");
    expect(currentKept()).toBe(next);
  });
});
