import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { TESTER_ASK, coveredLine, gapAskOf, pressToLine, testerGapButton } from "@/lib/gaps";
import { act, joined, listingBody, sact, seen, setup } from "./fixtures";

const src = (p: string) => readFileSync(path.resolve(__dirname, "../src", p), "utf8");
const later = () => new Promise((r) => setTimeout(r, 30));
const version = async (testId: string) => (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
const CENTRAL = "America/Chicago";

// (Owner, Oct 31, batch 35 §53) One listing line also covers the terms: no "changed the terms: <fields>" line anywhere.
describe("batch 35 §53: the terms line folds into the one listing line", () => {
  it("a working tester's offer line names no fields: '<Dev> offered you the new terms: Switch or Keep below'", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const pageLoaded = new Date();
    await later();
    await act(testId, "edit", dev.cookie, { version: await version(testId), fields: { writtenCents: "12.00", questions: ["Q one?", "Q two?"], description: "Sail the new route" }, confirmed: true });
    const { testerChanges } = await import("@/lib/server/testerGate");
    const lines = (await testerChanges(tester.user.id, sessionId, testId, pageLoaded)).map((e) => e.text);
    expect(lines).toContain("Nora Lane offered you the new terms: Switch or Keep below");
    expect(lines).toContain("Nora Lane edited the listing");
    expect(lines.filter((t) => /\$|→|questions changed/.test(t))).toEqual([]);
  });

  it("a tester who left (not working): the join page lists the listing line and no terms line at all", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "leave", tester.cookie, {});
    const pageLoaded = seen();
    await later();
    await act(testId, "edit", dev.cookie, { version: await version(testId), fields: { writtenCents: "3.00", recordingCents: null, ndaText: "Keep it secret.", questions: ["New one?"] }, confirmed: true });
    const { joinPageChanges } = await import("@/lib/server/joining");
    const lines = (await joinPageChanges(tester.user.id, testId, pageLoaded, "")).map((e) => e.text);
    expect(lines).toContain("Nora Lane edited the listing");
    expect(lines.some((t) => /read and accept it again below/.test(t))).toBe(true); // the NDA consequence keeps its line
    expect(lines.filter((t) => /changed the terms|offered/.test(t))).toEqual([]);
  });
});

// (Owner, Oct 31, batch 35 §54) Open until's box, hint, maximum and red line read the same day for the same stored instant: the developer's zone.
describe("batch 35 §54: Open until's dates agree (US Central around midnight UTC)", () => {
  it("a chosen day is stored as the end of that day in the developer's zone, and reads back as that day", () => {
    expect(R.endOfDayIn("2026-11-29", CENTRAL).toISOString()).toBe("2026-11-30T05:59:59.000Z"); // CST (UTC-6)
    expect(R.endOfDayIn("2026-10-30", CENTRAL).toISOString()).toBe("2026-10-31T04:59:59.000Z"); // CDT (UTC-5)
    expect(R.endOfDayIn("2026-11-29", null).toISOString()).toBe("2026-11-29T23:59:59.000Z"); // unknown zone: UTC, as before
    expect(R.openUntilDay("2026-11-30T05:59:59.000Z", CENTRAL)).toBe("2026-11-29");
    // An older row stored at UTC's end of day reads the same day in Central; a pause shift reads as the day it lands on there.
    expect(R.openUntilDay("2026-11-29T23:59:59.000Z", CENTRAL)).toBe("2026-11-29");
    expect(R.openUntilDay("2026-11-30T03:00:00.000Z", CENTRAL)).toBe("2026-11-29");
    expect(R.openUntilDay("2026-11-30T07:16:02.247Z", CENTRAL)).toBe("2026-11-30");
  });

  it("a test opened Oct 30 in the evening (Central, after midnight UTC): the maximum is Nov 29 and a saved Nov 29 is Nov 29 everywhere", async () => {
    const opened = new Date("2026-10-31T01:30:00.000Z"); // Oct 30, 8:30 PM CDT
    const cap = R.openUntilCapDay(opened, CENTRAL);
    expect(cap).toBe("2026-11-29");
    const saved = R.endOfDayIn(cap, CENTRAL);
    expect(R.openUntilDay(saved, CENTRAL)).toBe(cap); // the box
    expect(R.openUntilCapHint(cap, R.openUntilDay(saved, CENTRAL))).toBe("it can't move later: it's Nov 29 now (30 days after the test opened)");
    // The saved day itself is fine on Edit (not past the maximum), and not "shortened".
    const { parseListing } = await import("@/lib/server/tests");
    const l = parseListing(listingBody({ openUntil: saved.toISOString() })) as R.Listing;
    const errs = R.checkListing(l, 0, new Date("2026-10-31T02:00:00.000Z"), { changed: new Set(["openUntil"]), openedAt: opened, edit: true, tz: CENTRAL });
    expect(errs.filter((e) => /Open until/.test(e))).toEqual([]);
    expect(R.openUntilShortened(saved, R.endOfDayIn("2026-11-29", CENTRAL), CENTRAL)).toBe("");
    expect(R.openUntilShortened(saved, R.endOfDayIn("2026-11-28", CENTRAL), CENTRAL)).toBe("Open until can only be extended: it's Nov 29 now.");
    // Tester days from Oct 30 (Central) to Nov 29: 30, never 31.
    expect(R.testerDaysOf(opened, saved, CENTRAL)).toBe(30);
  });

  it("a pause moved Open until past the maximum: the hint never names a maximum earlier than the saved date", () => {
    expect(R.openUntilCapHint("2026-11-29", "2026-11-30")).toBe("it can't move later: it's Nov 30 now (30 days after the test opened, plus pauses)");
    expect(R.openUntilCapHint("2026-11-29", "2026-11-20")).toBe("only later, up to Nov 29 (30 days after the test opened)");
    expect(R.openUntilShortened("2026-11-30T07:16:02.247Z", R.endOfDayIn("2026-11-29", CENTRAL), CENTRAL)).toBe("Open until can only be extended: it's Nov 30 now.");
  });

  it("Post and Edit store the day in the developer's zone; Edit's day reads back the same", async () => {
    const day = R.dayIn(new Date(Date.now() + 20 * 86_400_000), CENTRAL);
    const { dev, testId } = await setup({ openUntil: day, timeZone: CENTRAL });
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).openUntil!.toISOString()).toBe(R.endOfDayIn(day, CENTRAL).toISOString());
    const next = R.dayIn(new Date(Date.now() + 22 * 86_400_000), CENTRAL);
    const r = await act(testId, "edit", dev.cookie, { version: await version(testId), fields: { openUntil: next }, timeZone: CENTRAL, confirmed: true });
    expect(r.status).toBe(200);
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect(R.openUntilDay(t.openUntil!, CENTRAL)).toBe(next);
    // The same day sent back (an untouched box) is no shortening.
    expect((await act(testId, "edit", dev.cookie, { version: await version(testId), fields: { openUntil: next }, timeZone: CENTRAL, confirmed: true })).status).toBe(200);
  });

  it("the Edit page passes the developer's zone, and the form reads Open until's day in it", () => {
    expect(src("app/app/tests/[id]/edit/page.tsx")).toContain("tz={u.timeZone}");
    expect(src("app/app/tests/new/page.tsx")).toContain("tz={u.timeZone}");
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain("openUntil: formDay(l.openUntil, tz),");
    expect(form).toContain("openUntilCapHint(edit.capDay, base.openUntil)");
    expect(form).not.toContain("l.openUntil.slice(0, 10)");
  });
});

// (Owner, Oct 31, batch 35 §55, replacing batch 30 §11) The join page's area by the button shows changes only after a press (the stop box); tests in batch30c-stops.

// (Owner, Oct 31, batch 35 §56) The needs pop-up's main button names the press.
describe("batch 35 §56: the pop-up's button names the press", () => {
  it("Ask to rejoin anyway / Apply anyway / Join anyway", () => {
    const g = { languages: ["Spanish"], devices: [] };
    expect(testerGapButton(g, gapAskOf("rejoin-ask"))).toBe("Ask to rejoin anyway");
    expect(testerGapButton(g, gapAskOf("apply"))).toBe("Apply anyway");
    expect(testerGapButton(g, gapAskOf("join"))).toBe("Join anyway");
    expect(TESTER_ASK.rejoin.question).toBe("Ask to rejoin anyway?");
    expect(pressToLine("rejoin")).toBe("Press Ask to rejoin to ask to rejoin.");
    expect(coveredLine({}, "Nora Lane", () => "3:20 AM", "2026-10-31T03:20:00.000Z", "apply")).toMatch(/Press Apply to apply\.$/);
    const join = src("app/app/find/[id]/JoinBox.tsx");
    expect(join).toContain("setAsking({ ask: gapAskOf(action),");
    expect(join).not.toContain('ask: action === "apply" ? "apply" : "join"');
  });
});

// (Owner, Oct 31, batch 35 §57) Red mistakes at the bottom clear as soon as the thing they're about is fixed.
describe("batch 35 §57: the mistake list clears with the fix", () => {
  it("follows the page's own red marks (the NDA tick) and drops a no-field line on the next change", () => {
    const fc = src("components/FieldChecks.tsx");
    expect(fc).toContain('attributeFilter: ["data-red-msg", "aria-invalid"]');
    expect(fc).toContain("setOrphansGone(true);");
    expect(fc).toContain("const left = orphansGone ? [] : orphans;");
    // The NDA tick: its red mark is data-red-msg, cleared when ticked, so its bullet goes with it.
    const join = src("app/app/find/[id]/JoinBox.tsx");
    expect(join).toContain("data-red-msg={ndaErr || undefined}");
    expect(join).toContain("if (e.target.checked) setNdaErr(\"\");");
  });
});

// (Owner, Oct 31, batch 35 §58) Draft buttons wait while the form's main press is going or finished, and can't be pressed twice.
describe("batch 35 §58: draft buttons are disabled during and after the main press", () => {
  it("DraftButton: disabled while busy or applying; every draft button is one", () => {
    const kept = src("lib/useKept.tsx");
    expect(kept).toContain("export function DraftButton(");
    expect(kept).toContain("disabled={disabled || applying}");
    expect(kept).toContain("if (busy.current || disabled) return;");
    expect(kept).toContain("<DraftButton className=\"ml-2 text-xs font-normal text-sky-300 underline\" data-use-saved={field ?? \"\"} onPress={onUseSaved} disabled={disabled}>");
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain('data-use-saved-all="" disabled={busy} onPress={isNew ? discardAll : putAllSaved}>');
    expect(form).not.toMatch(/<button[^>]*(data-discard-draft|data-use-saved-all)/);
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).toContain('data-use-saved-all="" disabled={busy || fin.done}');
    for (const f of ["app/admin/AdminButton.tsx", "app/admin/DisputeDecision.tsx", "app/admin/PagedList.tsx", "app/admin/TeamCloseBox.tsx", "app/app/find/[id]/JoinBox.tsx", "app/app/help/ContactForm.tsx", "app/app/profile/ProfileForm.tsx", "app/app/sessions/[id]/SessionActions.tsx", "app/app/tests/TestForm.tsx", "app/app/tests/[id]/DevCallPanel.tsx", "app/app/tests/[id]/PayBox.tsx", "app/app/tests/[id]/TopPanel.tsx", "components/CallRequests.tsx", "components/Chat.tsx", "components/RateBox.tsx"]) {
      const s = src(f);
      expect(s.match(/<DraftTag (?!disabled=)/g) ?? [], f).toEqual([]);
    }
  });
});
