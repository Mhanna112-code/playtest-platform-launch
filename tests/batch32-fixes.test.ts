import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { runSweep } from "@/lib/server/holds";
import { payoutWaitLine } from "@/lib/payout";
import { ANSWER_TERMS_FIRST } from "@/lib/answerTerms";
import { refusalLine } from "@/lib/pressLabels";
import { joined, setup } from "./fixtures";

const src = (f: string) => fs.readFileSync(path.join(process.cwd(), "src", f), "utf8");

// (Owner's findings from the Oct 30 screenshot run, batch 32 §12)
describe("batch 32 §12: fixes from the screenshot run", () => {
  it("another device's changes stop the next press until the top box was in view (they used to count as seen on arrival)", () => {
    const top = src("components/LiveTop.tsx");
    expect(top).toContain("if (!where()) {");
    expect(top).toContain("} else if (added.length || unseenUpTo.current) unseenUpTo.current = r.now;");
    expect(top).toContain("seenNowInView();");
    // Untouched answer boxes take what another device sent; typed text stays.
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).toContain("(cur[i] ?? \"\") === (was.answers[i] ?? \"\") ? initial[i] ?? \"\" : cur[i] ?? \"\"");
  });

  it("the waiting-money line goes out with the 5-minute sweep", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 1000, feeCents: 200, testerCents: 800, status: "charged", transferStatus: "waiting" } });
    await runSweep();
    expect(await db.notification.count({ where: { userId: tester.user.id, text: payoutWaitLine("$8.00") } })).toBe(1);
    expect(src("lib/server/holds.ts").match(/payoutWaitReminders/g)?.length).toBe(1); // only in the sweep
  });

  it("refusals name the press: Charge / Let it go, Leave, Invite anyway; new terms read exactly", () => {
    expect(refusalLine("Charge", ANSWER_TERMS_FIRST)).toBe(ANSWER_TERMS_FIRST);
    expect(refusalLine("Charge", "Nora Lane paid $10.00 for this meanwhile.")).toBe("Your Charge didn't go through: Nora Lane paid $10.00 for this meanwhile.");
    expect(src("app/app/sessions/[id]/ChoiceBox.tsx")).toContain("refusalLine(pressed, err)");
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).toContain('refusalLine("Leave", err)');
    expect(src("app/app/tests/[id]/InvitePanel.tsx")).toContain('didntGo press="Invite anyway"');
  });

  it("the in-page notice is one element put back at once after a redraw (it blinked)", () => {
    const k = src("components/KeptRefusal.tsx");
    expect(k).toContain("new MutationObserver(");
    expect(k).toContain("if (hostRef.current.parentElement !== anchor) anchor.appendChild(hostRef.current);");
  });
});

describe("batch 32 §13: Let it go has a tick, not a pop-up", () => {
  it("the button stays disabled until the tick; the tick says what it means", async () => {
    const { letGoTickLabel } = await import("@/lib/rules");
    expect(letGoTickLabel("Nora Lane")).toBe("Let it go won't charge Nora Lane, and you won't be paid for this");
    const box = src("app/app/sessions/[id]/ChoiceBox.tsx");
    expect(box).toContain('disabled={busy || !letGo} onClick={() => go("letgo")}>Let it go</button>');
    expect(box).not.toContain('title="Let it go?"');
  });
});
