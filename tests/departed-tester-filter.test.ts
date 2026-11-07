import { afterEach, describe, expect, it, vi } from "vitest";
import { FILTER_EVENT, resetInactiveTesterFilter, rowShown } from "@/app/app/tests/[id]/TesterFilter";

afterEach(() => vi.unstubAllGlobals());
function browser(selected: string) {
  const stored = new Map([["tester-filter", selected]]);
  const events = new EventTarget();
  const dispatch = vi.fn((e: Event) => events.dispatchEvent(e));
  vi.stubGlobal("window", { sessionStorage: { getItem: (k: string) => stored.get(k) ?? null, removeItem: (k: string) => stored.delete(k) }, dispatchEvent: dispatch });
  return { stored, dispatch };
}
describe("departed tester selection returns to All testers", () => {
  it.each(["left", "ended early", "deleted", "rated", "removed"])("clears a selected tester who is now %s, retaining all historic rows", () => {
    const w = browser("past");
    const selected = resetInactiveTesterFilter(["working"], "past");
    expect(selected).toBe("");
    expect(w.stored.has("tester-filter")).toBe(false);
    expect(w.dispatch.mock.calls[0][0]).toMatchObject({ type: FILTER_EVENT, detail: "" });
    expect(["working", "past"].filter((id) => rowShown(id, selected))).toEqual(["working", "past"]);
  });
  it("also clears a stale saved selection on load, but keeps a current working tester selected", () => {
    const w = browser("past");
    expect(resetInactiveTesterFilter(["working"])).toBe("");
    w.stored.set("tester-filter", "working");
    expect(resetInactiveTesterFilter(["working"], "working")).toBe("working");
    expect(w.stored.get("tester-filter")).toBe("working");
  });
});
