import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DMS_GROUP, groupTitle } from "@/lib/bell";
import { EMAIL_STACKED } from "@/lib/server/notify";

const read = (f: string) => fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");

describe("(Owner, Nov 5) §213-§216 and the join popup", () => {
  it("§213: a Send or Add refused because the test is paused shows a blue notice naming the press, kept through the page's redraw", () => {
    const s = read("src/app/app/sessions/[id]/SessionActions.tsx");
    expect(s).toContain('err.code === "paused") { rememberPaused(sessionId, sendPress, err.message)');
    expect(s).toContain('e.code === "paused") { rememberPaused(sessionId, `Add:${questionKey}`, e.message)');
    expect(s).toMatch(/border-sky-300\/40 bg-sky-300\/\[0\.08\][^"]*" data-paused-send="">.*Your \{label\} didn&apos;t go through:/);
    expect(s).toContain("sessionStorage.setItem(pausedKey(sessionId, press), message)");
    // Above the "kept as a draft" line.
    expect(s.indexOf("<PausedSend sessionId={sessionId} press={sendPress}")).toBeLessThan(s.indexOf("Your answers are kept as a draft."));
  });

  it("§214: the tester's line about a decided dispute names the developer", () => {
    expect(read("src/lib/server/live.ts")).toContain("`The team decided your dispute with ${dev} about your ${part}: the pay stays at ${money(r?.amountCents ?? 0)}`");
  });

  it("§215: direct-message bells reach only people who share a test, and stack as one entry a day, in the email too", () => {
    expect(read("src/lib/server/directMessages.ts")).toContain("{ side: null, recipientId: a.other.id, about: userId, group: DMS_GROUP }");
    expect(groupTitle(DMS_GROUP, 1, 3)).toBe("Direct messages · 3 today");
    expect(EMAIL_STACKED).toContain(DMS_GROUP);
  });

  it("§216: payment rows open their whole text with the arrow, never a hover", () => {
    for (const f of ["src/components/PaymentLists.tsx", "src/components/PartPayments.tsx", "src/components/OwedBox.tsx", "src/app/app/payments/page.tsx"]) {
      const s = read(f);
      expect(s).toContain("<WholeLine shown=");
      expect(s).not.toMatch(/title=\{(o|line|r|l|x|p)\.full\}/);
    }
    const w = read("src/components/WholeLine.tsx");
    expect(w).toContain("const cut = !!full && full !== shown;");
    expect(w).toContain("<ResizeBox"); // (§220) opened in place, in the draggable panel
  });

  it("the join popup is at most a screen tall and its changes show 3, then scroll", () => {
    const g = read("src/components/GapDialog.tsx");
    expect(g).toContain("!m-auto max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto");
    expect(g).toContain('<LongList className="list-disc space-y-0.5 pl-6" tall="max-h-52">');
  });
});

describe("(Owner, Nov 5) §217-§219, from the Nov 5 recordings", () => {
  it("§217: a check cancelled underneath reads as a cancel, whichever press reached it", async () => {
    const { refusalLine, CHECK_CANCELLED_UNDERNEATH } = await import("@/lib/pressLabels");
    for (const press of ["Cancel this check", "Confirm with your bank", "Pay"]) expect(refusalLine(press, CHECK_CANCELLED_UNDERNEATH)).toBe("Cancelled: nothing was charged.");
    expect(refusalLine("Pay", "Your card was declined.")).toBe("Your Pay didn't go through: Your card was declined.");
    expect(read("src/components/BankWaiting.tsx")).toContain('e.code === "cancelled") return { ok: true, paid: false, line: CANCELLED_NOTHING_CHARGED }');
  });

  it("§218: a won chargeback no longer reads 'your bank reversed this' in What you've paid", () => {
    expect(read("src/components/PaymentLists.tsx")).toContain('row?.reversed && p.chargeback === "won" ? " · your bank reversed this, then decided in your favour (chargeback won)"');
    expect(read("src/lib/server/paymentLists.ts")).toContain('reversed: !!o.chargebackAt && o.chargeback !== "won"');
  });

  it("§219: Confirm all's window names a new charge once", () => {
    expect(read("src/lib/server/bankPeek.ts")).toContain("!lines.includes(t) && !named.some((n) => t.includes(n))");
  });
});

describe("(Owner, Nov 5) §220 a cut row opens in place", () => {
  it("each '…' stands for what it hides in the whole line", async () => {
    const { cutPieces } = await import("@/components/WholeLine");
    const full = "Alexandria Montgomery-Smith's written answers on “Harbor Run: The Long Expedition Deluxe” (Nov 5): $10 + $15 chargeback fee";
    const shown = "Alexandria Montgomer…'s written answers on “Harbor Run: The Long…” (Nov 5): $10 + $15 chargeback fee";
    expect(cutPieces(shown, full)).toEqual([
      { text: "Alexandria Montgomer" }, { text: "", hidden: "y-Smith" }, { text: "'s written answers on “Harbor Run: The Long" }, { text: "", hidden: " Expedition Deluxe" }, { text: "” (Nov 5): $10 + $15 chargeback fee" },
    ]);
    expect(cutPieces("Ana Silva's answers", "Ana Silva's answers")).toBeNull();
    expect(cutPieces("Something else…", "Not the same line at all")).toBeNull();
  });
  it("opened, the row (and a bell line) shows whole in place in the draggable panel; no copy under it", () => {
    const w = read("src/components/WholeLine.tsx");
    expect(w).toContain('<ResizeBox id={`whole-${id}`} label="The whole line" defaultMax="6rem" tallest={0.5}>');
    expect(w).toContain('aria-label="Show the whole name" data-name-toggle=""');
    const b = read("src/app/app/notifications/BellList.tsx");
    expect(b).toContain('<ResizeBox id={`bell-${l.id}`} label="The whole line" defaultMax="6rem" tallest={0.5}>');
    expect(b).not.toContain("ml-5 mt-1 max-h-32 overflow-y-auto");
  });
});

describe("(Owner, Nov 5) §217 on the kept refusal too (recording R4a re-take)", () => {
  it("the line kept on screen after a press reads as a cancel, never lowercased into 'Your … didn't go through: this payment was cancelled'", async () => {
    const { keptRefusalLine } = await import("@/lib/keptRefusal");
    const { CHECK_CANCELLED_UNDERNEATH } = await import("@/lib/pressLabels");
    for (const press of ["Confirm with your bank", "Cancel this check", "Pay"]) expect(keptRefusalLine(press, CHECK_CANCELLED_UNDERNEATH)).toBe("Cancelled: nothing was charged.");
    expect(keptRefusalLine("Join call", "This call isn't available.")).toBe("Your Join call didn't go through: this call isn't available.");
  });
});
