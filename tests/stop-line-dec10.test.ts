import { readFileSync } from "node:fs";
import path from "node:path";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { Err } from "@/components/Err";
import { LongList } from "@/components/LongList";
import { ANSWER_TERMS_FIRST } from "@/lib/answerTerms";
import { NDA_BLOCK_FIRST } from "@/lib/ndaNotice";
import { pressLabelOf, refusalLine, SEND_ANSWERS } from "@/lib/pressLabels";
import { STOP_LINE_TAIL, TO_TOP_EVENT, handedToTop, resetStopLines, sendToTop, stopLineText } from "@/lib/stopLine";
import { wasShownInBox } from "@/lib/live";

// (Owner, Dec 10 2026) "Replace the stop-once boxes everywhere with one line": on the session page, the join page and the developer's test page a press stopped
// once shows ONE blue line under its button, its changes go into the page's top updates box at once, and the next press goes ahead as before. Pages with no top
// box for those changes keep their own box.
(globalThis as unknown as { React: typeof React }).React = React;
const src = (p: string) => readFileSync(path.resolve(__dirname, "../src", p), "utf8");
const unescape = (s: string) => s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const at = (m: number) => new Date(Date.UTC(2026, 11, 10, 15, m)).toISOString();
const lines = (n: number): Change[] => Array.from({ length: n }, (_, i) => ({ text: `Change ${i + 1}`, at: at(i) }));

afterEach(() => {
  vi.unstubAllGlobals();
  resetStopLines();
});

describe("the one line under the button", () => {
  it("reads 'Your <press> didn't go through: check the updates at the top. Press again to go ahead.', named as the refusal lines name the press", () => {
    expect(STOP_LINE_TAIL).toBe("check the updates at the top. Press again to go ahead.");
    const cases: [string, string][] = [
      [SEND_ANSWERS, "Your Send Answers didn't go through: check the updates at the top. Press again to go ahead."],
      [pressLabelOf("/api/sessions/s1/terms", { choice: "switch" }), "Your Switch to the new terms didn't go through: check the updates at the top. Press again to go ahead."],
      [pressLabelOf("/api/sessions/s1/terms", { choice: "keep" }), "Your Keep my current terms didn't go through: check the updates at the top. Press again to go ahead."],
      [pressLabelOf("/api/tests/t1/join"), "Your Join didn't go through: check the updates at the top. Press again to go ahead."],
      [pressLabelOf("/api/sessions/s1/leave"), "Your Leave didn't go through: check the updates at the top. Press again to go ahead."],
      [pressLabelOf("/api/sessions/s1/rate"), "Your Rate didn't go through: check the updates at the top. Press again to go ahead."],
      [pressLabelOf("/api/calls/c1/join"), "Your Join call didn't go through: check the updates at the top. Press again to go ahead."],
      [pressLabelOf("/api/tests/t1/stop"), "Your Stop the test didn't go through: check the updates at the top. Press again to go ahead."],
    ];
    for (const [press, line] of cases) {
      expect(stopLineText(press)).toBe(line);
      // The same press refused names it the same way.
      expect(refusalLine(press, "x")).toBe(`Your ${press} didn't go through: x`);
      const html = unescape(renderToStaticMarkup(h(ChangesBox, { side: "tester", changes: lines(4), press, line: true })));
      expect(html).toContain(`<p data-didnt-go="">${line}</p>`);
      expect(html).toContain("data-stop-line=");
      // No list, no Alerts hints, no "Press … again" under the button: the changes are at the top.
      expect(html).not.toContain("Change 1");
      expect(html).not.toContain("Since you opened this page");
      expect(html).not.toContain("data-press-again");
    }
    expect(stopLineText("")).toBe("Your press didn't go through: check the updates at the top. Press again to go ahead.");
  });

  it("is drawn by ChangesBox itself on the pages whose top box takes the changes (session, join and test pages), never on Edit or Home", () => {
    const box = src("components/ChangesBox.tsx");
    expect(box).toContain("const asLine = line ?? pageLine;");
    expect(box).toContain("if (asLine) sendToTop(changes);");
    expect(src("app/app/sessions/[id]/page.tsx")).toMatch(/<LiveTop scope=\{`session:\$\{c\.id\}`\}[^\n]* stopLines /);
    expect(src("app/app/find/[id]/page.tsx")).toMatch(/<LiveTop scope=\{`listing:\$\{t\.id\}`\}[^\n]* stopLines /);
    expect(src("app/app/tests/[id]/page.tsx").match(/<LiveTop scope=\{`test:\$\{t\.id\}`\}[^\n]* stopLines /g)).toHaveLength(2);
    expect(src("app/app/tests/[id]/edit/page.tsx")).not.toContain("stopLines");
    expect(src("app/app/page.tsx")).not.toContain("stopLines");
    expect(src("components/LiveTop.tsx")).toContain("useStopLinePage(stopLines);");
  });

  it("group A's boxes show under their own button, new terms too (no box moved into Switch / Keep, no scroll to the top)", () => {
    for (const f of ["app/app/sessions/[id]/SessionActions.tsx", "app/app/sessions/[id]/ChoiceBox.tsx", "app/app/sessions/[id]/RecordingUpload.tsx"]) {
      expect(src(f), f).not.toContain("box && !box.top");
      expect(src(f), f).toContain("changes={box?.changes ?? null}");
    }
    const top = src("lib/topStop.ts");
    expect(top).not.toContain("scrollTo");
    expect(top).toContain('window.dispatchEvent(new Event(OFFER_LOAD_EVENT))');
    // Rate (usePress) and the presses on useStopOnce load the offer the same way.
    expect(src("lib/usePress.ts")).toContain("offerStop(e.data);");
    expect(src("lib/useStopOnce.ts")).toContain("offerStop(e.data);");
    const tt = src("app/app/sessions/[id]/TesterTop.tsx");
    expect(tt).toContain('if (!document.getElementById("terms-offer")) router.refresh();');
    expect(tt).not.toContain("jumpTo(");
  });

  it("group B passes side=\"tester\" on the tester's pages", () => {
    expect(src("app/app/sessions/[id]/TesterCallPanel.tsx")).toContain('<JoinCall callId={m.id} side="tester" />');
    expect(src("components/JoinCall.tsx")).toContain('<ChangesBox changes={stop.box} press="Join call" side={side} />');
    expect(src("components/RateBox.tsx")).toContain("<ChangesBox side={p.rater");
  });
});

describe("the changes go into the top box at once", () => {
  it("sendToTop hands them over (an event the top box listens to), counts them as listed, and keeps them for a top box drawn again", () => {
    const win = Object.assign(new EventTarget(), { location: { pathname: "/app/sessions/s1" } });
    vi.stubGlobal("window", win);
    const got: Change[][] = [];
    win.addEventListener(TO_TOP_EVENT, (e) => got.push((e as CustomEvent<Change[]>).detail));
    const stop = [{ text: "Nora Lane paused the test", at: at(1) }, { text: "Nora Lane changed the terms again: pay $20", at: at(2) }];
    sendToTop(stop);
    expect(got).toEqual([stop]);
    expect(stop.every(wasShownInBox)).toBe(true); // quiet in the top box: no pill for them
    expect(handedToTop()).toEqual(stop);
    // Another page in the tab: nothing handed there.
    win.location.pathname = "/app/tests/t1";
    expect(handedToTop()).toEqual([]);
  });

  it("the top box adds them whatever the Alerts, never twice, shows them past a Dismiss, and never reads a line's own time twice", () => {
    const top = src("components/LiveTop.tsx");
    const on = top.slice(top.indexOf("const on = (e: Event) => {"), top.indexOf("window.addEventListener(TO_TOP_EVENT, on);"));
    expect(on).toContain("setLines((old) => mergeChanges(old, added));"); // mergeChanges skips what the box already has
    expect(on).toContain("known.current.add(key(c))");
    expect(on).not.toContain("boxKeeps"); // no Alerts rule
    expect(top).toContain("|| unhidden.has(key(l))");
    expect(top).toContain("const [lines, setLines] = useState<Change[]>(() => (stopLines ? mergeChanges([], handedToTop()) : []));");
    expect(top).toContain('<b>{saysItsTime(l) ? "Updated:" : `Updated · ${time(l.at)}:`}</b>');
  });
});

describe("clear, then reappear", () => {
  it("the line under the button goes the moment it is pressed; the second press still goes ahead (confirmed with the box's time)", () => {
    const u = src("lib/usePress.ts");
    const press = u.slice(u.indexOf("async function press<T>"), u.indexOf("const r = await api<T>"));
    expect(press).toContain("const prev = changes;");
    expect(press).toContain("const again = prev != null && (!opts.perKey || key === at);");
    expect(press).toContain("setChanges(null);");
    expect(press).toContain('setError("");');
    expect(u).toContain("confirmed: again || body.confirmed === true, ...(again && boxAt ? { boxAt } : {})");
    // useStopOnce: the box hides as the press is made; its time still confirms.
    const once = src("lib/useStopOnce.ts");
    expect(once).toContain("if (box.shown) setBox({ ...box, shown: false });");
    expect(once).toContain("return { confirmed: true, boxAt: box.at };");
    expect(once).toContain("box: box?.shown ? box.changes : null");
    // Group A: each press clears its box first (its time kept).
    const s = src("app/app/sessions/[id]/SessionActions.tsx");
    expect(s.match(/setBox\(null\); \/\/ \(Owner, Dec 10 2026\) Clear, then the new outcome/g)).toHaveLength(3); // Send Answers, Add, Dispute
    expect(s).toContain("const prev = box;\n    const again = prev != null;\n    // (Owner, Dec 10 2026) Clear, then the new outcome: Leave's line (stop or refusal) goes as it is pressed.\n    setBox(null);\n    setErr(\"\");");
    for (const f of ["app/app/sessions/[id]/ChoiceBox.tsx", "app/app/sessions/[id]/RecordingUpload.tsx", "app/app/find/[id]/JoinBox.tsx"]) expect(src(f), f).toContain("setBox(null); // (Owner, Dec 10 2026) Clear, then the new outcome");
    expect(src("app/app/sessions/[id]/TesterTop.tsx")).toContain("setBox(null); // (Owner, Dec 10 2026) and so does the stop line");
    expect(src("components/Excerpts.tsx")).toContain("setBox((b) => (b ? { ...b, shown: false } : b)); // (Owner, Dec 10 2026) clear, then the new outcome");
  });
});

describe("a line under a button stays until that button is pressed again or the page reloads", () => {
  it("a redraw with a new version no longer takes it away (Err, ChangesBox, the kept refusal); red mistakes keep their own rule", () => {
    expect(src("components/Err.tsx")).not.toContain("useGoneOnNewVersion");
    expect(src("components/ChangesBox.tsx")).not.toContain("useGoneOnNewVersion");
    expect(src("components/KeptRefusal.tsx")).not.toContain("watchNewPageVersion");
    expect(src("components/FormMistakes.tsx")).toContain("useGoneOnNewVersion");
    // Drawn as it is, every time: nothing in the line depends on the page's version.
    const html = renderToStaticMarkup(h(ChangesBox, { changes: lines(2), press: "Pay", line: true }));
    expect(html).toContain("Your Pay didn&#x27;t go through: check the updates at the top. Press again to go ahead.");
    expect(renderToStaticMarkup(h(Err, { text: "This call isn't available.", press: "Join call" }))).toContain("Your Join call didn&#x27;t go through: This call isn&#x27;t available.");
  });
});

describe("the pages with no top box for those changes keep their own box", () => {
  it("ChangesBox off those pages is the full box (Before / What you typed, the account pages, Home, admin)", () => {
    const html = unescape(renderToStaticMarkup(h(ChangesBox, { changes: lines(2), press: "Save" })));
    expect(html).toContain("Your Save didn't go through.");
    expect(html).toContain("Since you opened this page:");
    expect(html).toContain("Change 2");
    expect(html).toContain("Press Save again to go ahead.");
    expect(html).not.toContain("data-stop-line");
    for (const f of ["app/app/tests/TestForm.tsx", "app/app/tests/NdaOnlyForm.tsx", "app/app/profile/ProfileForm.tsx", "app/app/notifications/AlertSettings.tsx", "app/app/payments/AccountFormButton.tsx", "app/app/account/SideButton.tsx", "app/app/CallsBox.tsx", "components/ConfirmAll.tsx", "components/OwedBox.tsx", "app/admin/AdminButton.tsx"]) {
      expect(src(f), f).toContain("<ChangesBox");
      expect(src(f), f).not.toContain("line={true}");
    }
    // A bank check keeps its own box, on the test page too.
    expect(src("components/BankWaiting.tsx")).toContain("press={CONFIRM_WITH_BANK} line={false}");
  });
});

describe("the two block lines say where to look; the page doesn't move", () => {
  it("end with 'at the top of the page.' everywhere they're compared", () => {
    expect(ANSWER_TERMS_FIRST).toBe("Answer the new terms first: Switch or Keep at the top of the page.");
    expect(NDA_BLOCK_FIRST).toBe("Acknowledge the NDA change first at the top of the page.");
    expect(refusalLine("Send Answers", ANSWER_TERMS_FIRST)).toBe(ANSWER_TERMS_FIRST);
    expect(refusalLine("Request a time", NDA_BLOCK_FIRST)).toBe(NDA_BLOCK_FIRST);
    expect(unescape(renderToStaticMarkup(h(Err, { text: ANSWER_TERMS_FIRST, press: "Send" })))).toBe(`<p class="err" data-answer-terms="">${ANSWER_TERMS_FIRST}</p>`);
    expect(unescape(renderToStaticMarkup(h(Err, { text: NDA_BLOCK_FIRST, press: "Send" })))).toBe(`<p class="err" data-nda-refusal="">${NDA_BLOCK_FIRST}</p>`);
    expect(unescape(renderToStaticMarkup(h(ChangesBox, { changes: null, error: ANSWER_TERMS_FIRST, press: "Request a time" })))).toContain(`data-answer-terms="">${ANSWER_TERMS_FIRST}</p>`);
  });

  it("no jump to Switch / Keep or the NDA notice: only their ring, and the line comes into view under its button", () => {
    expect(src("app/app/sessions/[id]/TesterTop.tsx")).toContain('markOnly("terms-offer");');
    const nda = src("components/NdaNotice.tsx");
    expect(nda).toContain("markOnly(NDA_NOTICE);");
    expect(nda).not.toContain("jumpTo(NDA_NOTICE)");
    const mark = src("lib/markJump.ts");
    const only = mark.slice(mark.indexOf("export function markOnly"), mark.indexOf("/** (Owner's bug, Oct 31"));
    expect(only).not.toContain("scroll");
    expect(src("components/Err.tsx")).toContain("if (text) bringInView(ref.current);");
    expect(src("components/ChangesBox.tsx")).toContain("if (changes || error) bringInView(ref.current);");
  });
});

describe("LongList folded: the newest 3", () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => h("li", { key: i }, `L${i + 1}`));
  it("a list fed oldest first (newest=\"last\") shows its LAST 3, in order; one fed newest first its first 3", () => {
    const last = renderToStaticMarkup(h(LongList, { newest: "last", children: items(5) }));
    expect(last).toContain("<li>L3</li><li>L4</li><li>L5</li>");
    expect(last).not.toContain("L1<");
    expect(last).toContain("Show 2 more");
    const first = renderToStaticMarkup(h(LongList, { children: items(5) }));
    expect(first).toContain("<li>L1</li><li>L2</li><li>L3</li>");
    expect(first).not.toContain("L5<");
  });

  it("the stop box's lines and the join pop-up's stop (oldest first) show the newest 3; the newest-first lists are unchanged", () => {
    const box = unescape(renderToStaticMarkup(h(ChangesBox, { changes: lines(5), press: "Save", line: false })));
    expect(box).toContain("Change 5");
    expect(box).toContain("Change 3");
    expect(box).not.toContain("Change 1 ·");
    expect(src("components/GapDialog.tsx")).toContain('<LongList className="list-disc space-y-0.5 pl-6" tall="max-h-52" newest="last">');
    // Fed newest first already: the live box (sorted newest first), LiveNotices, the bell (createdAt desc), Payments' lists, Invited (createdAt desc).
    expect(src("components/LiveTop.tsx")).toContain(".sort((a, b) => (time0(a.at) < time0(b.at) ? 1 : -1));");
    expect(src("components/LiveNotices.tsx")).toContain("const newest = [...lines].sort((a, b) => b.at.localeCompare(a.at));");
    for (const f of ["components/LiveTop.tsx", "components/LiveNotices.tsx", "app/app/notifications/BellList.tsx", "components/PaymentLists.tsx", "app/app/tests/[id]/InvitePanel.tsx"]) expect(src(f), f).not.toContain('newest="last"');
  });
});
