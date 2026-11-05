import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AMOUNT_RE, keepAmounts } from "@/components/Amounts";

// (Owner, Nov 3) Long text never breaks a page: buttons drop onto their own line instead of squeezing the words beside them, nothing reaches past the screen,
// and an amount always shows every digit (never split over two lines, never cut by "…"). Pictures: docs/media/long-text/.
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const html = (n: React.ReactNode) => renderToStaticMarkup(React.createElement(React.Fragment, null, n));

describe("amounts stay whole", () => {
  it("keepAmounts puts each amount in its own unbreakable unit and leaves the words as they are", () => {
    const line = "Your bank wants you to confirm 4 payments ($1,000,121.06 in all): $999,999.99, $200.00/h and -$5.00";
    const out = html(keepAmounts(line));
    for (const a of ["$1,000,121.06", "$999,999.99", "$200.00/h", "-$5.00"]) expect(out).toContain(`<span class="inline-block whitespace-nowrap" data-amount="">${a}</span>`);
    // The words read the same.
    expect(out.replace(/<[^>]+>/g, "")).toBe(line);
    expect([...line.matchAll(AMOUNT_RE)].map((m) => m[0])).toEqual(["$1,000,121.06", "$999,999.99", "$200.00/h", "-$5.00"]);
    // A line with no amount is returned as it is.
    expect(keepAmounts("Nothing to pay")).toBe("Nothing to pay");
  });

  it("is used where a line can be cut or squeezed: bell lines and previews, Find's and the tester dashboard's pay lines", () => {
    const bell = src("app/app/notifications/BellList.tsx");
    expect(bell).toContain('<span className="block truncate text-sm text-slate-400">{keepAmounts(e.lines[0].text)}</span>');
    expect(bell.match(/\{keepAmounts\(l\.text\)\}/g)?.length).toBe(2);
    expect(src("app/app/find/page.tsx")).toContain("{keepAmounts(termsLine(asListing(t), true))}");
    expect(src("app/app/page.tsx")).toContain("{keepAmounts(pays(asListing(t)))}");
  });

  it("totals and amounts in rows never split", () => {
    const pay = src("components/PaymentLists.tsx"); // (§190) Payments' paid lists, drawn by the shared component
    expect(pay.match(/<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">/g)?.length).toBe(3); // the two paid lists and the team's read-only What you owe
    expect(pay.match(/<span className="whitespace-nowrap text-sm text-slate-400"[^>]*>Total \{money\(/g)?.length).toBe(3);
    expect(pay).toContain('· <span className="whitespace-nowrap">{money(p.amountCents)}</span>');
    expect(src("app/app/find/page.tsx")).toContain('<p className="whitespace-nowrap text-lg font-bold text-emerald-300">{fromText(t)}</p>');
    expect(src("app/app/sessions/[id]/ChoiceBox.tsx")).toContain('<span className="whitespace-nowrap">{money(cents)}</span>');
  });
});

describe("buttons drop below instead of squeezing; nothing reaches past the screen", () => {
  it("a button is never wider than the space it sits in", () => {
    expect(src("app/globals.css")).toContain(".btn, .btn-secondary, .btn-ghost, .btn-danger, .btn-green { @apply max-w-full; }");
    expect(src("components/ChatWithButton.tsx")).toContain('<span className="min-w-0 [overflow-wrap:anywhere]">Chat with {name}</span>');
  });

  it("the words beside a button keep 12rem, so the button wraps below them on a phone", () => {
    expect(src("app/app/page.tsx")).toContain('<p className="min-w-[min(100%,12rem)] flex-1 text-slate-300">');
    // (Batch 35 §137) The action is now the row's link, laid over the card, with the same layout classes.
    expect(src("app/app/page.tsx")).toContain('<Link href={r.href} className={`ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap text-sm text-indigo-300 no-underline hover:no-underline ${CARD_LINK}`}>{r.cta}');
    expect(src("components/RateBox.tsx")).toContain('<span className="min-w-[min(100%,12rem)] flex-1"><input className="input w-full" maxLength={500}');
    expect(src("app/app/calls/[id]/CallRoom.tsx")).toContain('<span className="min-w-[min(100%,12rem)] flex-1 text-sm text-slate-300" role="status" data-call-status="">');
    expect(src("components/PayoutBanner.tsx")).toContain('<p className="min-w-[min(100%,12rem)] flex-1"><b>{PAYOUT_LINE}</b>');
  });

  it("a call's buttons move together; only the names in a call row are cut, never its day, time and length", () => {
    expect(src("app/app/tests/[id]/DevCallPanel.tsx")).toContain('<span className="flex max-w-full flex-wrap items-center gap-2" data-call-buttons="">');
    for (const f of ["app/app/CallsBox.tsx", "app/app/page.tsx"]) {
      const s = src(f);
      expect(s, f).toContain('<span className="min-w-0 max-w-full truncate"><b className="text-white">');
      expect(s, f).toMatch(/<span className="whitespace-nowrap">· \{fmt(DateTime)?\((c\.when|x\.startsAt)\)\} · \{(c|x)\.minutes\} min/);
    }
  });

  it("cards and rows may shrink below their longest title, and long names wrap (or, in §187's rows, are cut to fit) inside them", () => {
    expect(src("app/app/find/page.tsx")).toContain('<li key={t.id} className="min-w-0">');
    expect(src("app/app/page.tsx")).toContain('<li key={t.id} className="min-w-0">');
    expect(src("app/app/messages/page.tsx")).toContain('<p className="flex min-w-0 flex-wrap items-baseline gap-x-1 font-medium text-white">');
    // (Owner, Nov 4, §187 item 3) Needs you's person row no longer wraps the name: the whole name, cut with "…" only when the row is full. Every box from the
    // row down to the name may shrink (min-w-0) and the name never grows past it (max-w-full, truncate), so it still never reaches past the screen.
    expect(src("app/app/tests/[id]/page.tsx")).toContain('summary={<span className="flex min-w-0 items-baseline gap-1"><span className="min-w-0" data-needs-person-name=""><NameLink fit text={p.name} href={p.href} /></span>');
    expect(src("components/Cut.tsx")).toContain('<span className={`inline-block min-w-0 max-w-full truncate align-bottom ${className}`} data-cut-fit={kind}');
    expect(src("components/Cut.tsx")).toContain('className={`relative z-10 ${fit ? "inline-block min-w-0 max-w-full align-bottom " : ""}${className}`}');
    expect(src("components/HoldFold.tsx")).toContain('className = "min-w-0 rounded-xl border border-white/10 p-2"');
    // (§189) An unbroken line (a fitted name) no longer widens the page: the app's main is never wider than the screen.
    expect(src("app/app/layout.tsx")).toContain('<main className="mx-auto max-w-[min(72rem,100%)] space-y-6 px-4 py-8" data-app-main="">');
    expect(src("components/Formatted.tsx")).toContain('className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]"');
    // The avatars' hover cards open from the row's left edge on a phone (under the avatar from sm up).
    expect(src("app/app/tests/[id]/TestersJoined.tsx")).toContain('<span className="group inline-block sm:relative">');
    expect(src("components/Ui.tsx")).toContain('<span key={p.id} className="group z-10 inline-block sm:relative">');
  });
});
