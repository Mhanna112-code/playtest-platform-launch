import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// (Owner, Dec 10 2026, live test) The Switch / Keep box kept its refusal and its stop-once box time across offers:
//   1. "These terms are no longer on offer." from a withdrawn offer showed again under the NEXT offer's buttons;
//   2. an old box time made the next press a second press (`confirmed`), so Switch skipped "changed the terms again" and took terms the page never showed.
// A different offer now starts the box clean; the newest offer a stop-once box moved to keeps its box when it arrives on the page.
const top = readFileSync(path.resolve(__dirname, "../src/app/app/sessions/[id]/TesterTop.tsx"), "utf8");
const effect = top.slice(top.indexOf("useEffect(() => {\n    if (!offer?.id) {"), top.indexOf("}, [offer?.id, setBox]);"));

describe("Switch / Keep: a new offer starts the box clean", () => {
  it("a different offer clears the refusal, its press name, the stop-once box and the box time", () => {
    expect(effect).toContain("if (offer.id !== aboutOffer.current) {");
    for (const reset of ['setErr("")', 'setErrPress("")', "setBox(null)", 'setBoxAt("")']) expect(effect).toContain(reset);
    expect(effect).toContain("aboutOffer.current = offer.id;");
  });

  it("the same offer arriving again keeps what the box shows (the reset is only for a different id)", () => {
    // The resets sit inside the "different offer" branch only.
    const branch = effect.slice(effect.indexOf("if (offer.id !== aboutOffer.current) {"), effect.indexOf("aboutOffer.current = offer.id;"));
    expect(branch).toContain('setBoxAt("")');
    expect(effect.slice(effect.indexOf("setOfferId(offer.id);"), effect.indexOf("if (offer.id !== aboutOffer.current) {"))).not.toContain("setBoxAt");
  });

  it("a stop-once box that moved the press to the newest offer marks the box as about that offer (its arrival keeps the box)", () => {
    expect(top).toContain("if (next) { setOfferId(next); aboutOffer.current = next; }");
  });

  it("each press starts without the last refusal", () => {
    const decide = top.slice(top.indexOf("const decide = (choice: string) => {"), top.indexOf("return api(`/api/sessions/${sessionId}/terms`"));
    expect(decide).toContain('setErr("")');
    expect(decide).toContain("pressed.current = true;");
  });
});

describe("Switch / Keep: the offer withdrawn after a press", () => {
  const withdrawn = top.slice(top.indexOf("if (!offer?.id) {"), top.indexOf("setOfferId(offer.id);"));
  it("drops the changed-terms box and its time, and keeps the one line", () => {
    expect(withdrawn).toContain("if (aboutOffer.current && pressed.current) {");
    for (const x of ["setBox(null)", 'setBoxAt("")', "setErr(NO_LONGER_ON_OFFER)"]) expect(withdrawn).toContain(x);
  });

  it("with no offer, the line shows by itself; no See the new terms button anywhere", () => {
    expect(top).toContain("if (!offer) return box ? <ChangesBox side=\"tester\" changes={box.changes} tail={box.tail} /> : err ? <Err text={err} press={errPress} /> : null;");
    expect(top).not.toContain(">See the new terms</button>");
    expect(top).not.toContain("reloadKeepingPlace");
  });
});

describe("Switch / Keep: another press's box naming new terms (Leave, Rate)", () => {
  const handler = top.slice(top.indexOf("const on = (e: Event) => {"), top.indexOf('window.addEventListener("tester-top", on);'));
  it("loads the offer at once when the page doesn't show it yet, and goes to it when it arrives", () => {
    expect(handler).toContain('if (!document.getElementById("terms-offer")) {');
    expect(handler).toContain("pending.current = true;");
    expect(handler).toContain("router.refresh();");
    expect(top).toContain("if (!offer?.id || !pending.current) return;"); // the jump to the Switch / Keep box once the offer is on the page
  });

  it("the offer's arrival keeps that box (it shows only here); Switch / Keep's own box is cleared by a different offer", () => {
    expect(handler).toContain("boxMine.current = false;");
    expect(top).toContain("if (boxMine.current) setBox(null);");
    expect(top).toContain("boxMine.current = true; // after stopBox");
  });

  it("the server's refusal and the box's line are the same words", async () => {
    const { NO_LONGER_ON_OFFER: server } = await import("@/lib/server/terms");
    const { NO_LONGER_ON_OFFER: shared } = await import("@/lib/answerTerms");
    expect(server).toBe(shared);
    expect(shared).toBe("These terms are no longer on offer.");
  });

  it("a new offer after it clears the line (and the pressed mark)", () => {
    const fresh = top.slice(top.indexOf("if (offer.id !== aboutOffer.current) {"), top.indexOf("aboutOffer.current = offer.id;"));
    expect(fresh).toContain('setErr("")');
    expect(fresh).toContain("pressed.current = false;");
  });
});
