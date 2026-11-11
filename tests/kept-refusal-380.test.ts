import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KEPT_RELOAD_MS, keepRefusal, keptButton, notePress, resetKept, restoreKept } from "@/lib/keptRefusal";
import { overPressLine } from "@/lib/rules";

// (Owner, Nov 11, §380 KR) The blue refusal line stays under the pressed button after the page redraws, on EVERY button; a part that's over shows the short line
// under the button too (kept across the `?failed=` reload), and the top banner's refused-press line is the short pattern.

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");

describe("§380 KR: the kept line under the pressed button", () => {
  it("the same button, or the button with the same words in its section after a redraw replaced it", () => {
    const old = { textContent: "Send Answers" };
    expect(keptButton({ anchors: ["written"], button: "Send Answers" }, old, () => null)).toBe(old);
    const again = { textContent: " Send  Answers " };
    const other = { textContent: "Leave" };
    expect(keptButton({ anchors: ["gone", "written"], button: "Send Answers" }, null, (id) => (id === "written" ? [other, again] : null))).toBe(again);
    expect(keptButton({ anchors: ["written"], button: "Send Answers" }, null, () => [other])).toBeNull();
    expect(keptButton({ anchors: ["written"], button: "" }, null, () => [other])).toBeNull();
  });

  it("kept across the reload a refused press makes, on the same page only and only for a moment", () => {
    resetKept();
    const store = new Map<string, string>();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
    (globalThis as { location?: unknown }).location = { pathname: "/app/sessions/s1" };
    notePress(null, null, 1_000, ["written"], "Send Answers");
    keepRefusal("Send Answers", "This test was stopped, so your Send Answers didn't go through.", 1_000);
    const raw = store.get("pt-kept-refusal") ?? null;
    expect(raw).toBeTruthy();
    resetKept();
    expect(restoreKept(raw, "/app/sessions/other", 2_000)).toBeNull();
    const back = restoreKept(raw, "/app/sessions/s1", 2_000);
    expect(back).toMatchObject({ text: "This test was stopped, so your Send Answers didn't go through.", anchors: ["written"], button: "Send Answers" });
    resetKept();
    expect(restoreKept(raw, "/app/sessions/s1", 1_000 + KEPT_RELOAD_MS + 1)).toBeNull();
    // The next press anywhere forgets it.
    notePress(null, null, 3_000, [], "Leave");
    expect(store.has("pt-kept-refusal")).toBe(false);
    resetKept();
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    delete (globalThis as { location?: unknown }).location;
  });

  it("the page: a button still there that no longer shows its line gets it under it; the banner of a part that's over never hides it", () => {
    const k = src("components/KeptRefusal.tsx");
    expect(k).toContain('if (button.nextElementSibling !== hostRef.current) button.insertAdjacentElement("afterend", hostRef.current);');
    expect(k).toContain("[data-kept-refusal], [data-kept-host], [data-stopped-line], [data-failed-line]");
    expect(k).toContain("if (buttonNow(k) && Date.now() - k.at < OWN_LINE_GRACE_MS) return true;");
    expect(k).toContain("restoreKept(sessionStorage.getItem(KEPT_STORE), location.pathname);");
  });

  it("the session page's banner on a refused press: the short line, then its details without the press", () => {
    expect(overPressLine({ status: "ended", endKind: "stopped" }, "Send Answers")).toBe("This test was stopped, so your Send Answers didn't go through.");
    const page = src("app/app/sessions/[id]/page.tsx");
    expect(page).toContain('{over && failedPress && <p data-failed-line="">{overPressLine(c, failedPress)}</p>}');
    expect(page).toContain("dev, fmtDate, stillWorks) : refusal}</p>");
  });
});
