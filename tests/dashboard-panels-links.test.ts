import { hashTargets } from "@/lib/markJump";
import { TodoTestRow } from "@/components/TodoTestRow";
import { TesterPaymentTag } from "@/components/TesterPaymentTag";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { FullBellLine } from "@/app/app/notifications/BellList";
import { FindTestCard } from "@/components/FindTestCard";
import { SearchPanel } from "@/components/SearchPanel";
import { panelMatches } from "@/lib/panelSearch";
import { previousTestGroup, developerTestGroups } from "@/lib/dashboardPanels";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() { } }), usePathname: () => "/app", useSearchParams: () => new URLSearchParams() }));
globalThis.React = React;
it("an expanded bell keeps names, tests and destination independently clickable without nesting anchors", () => {
    const html = renderToStaticMarkup(React.createElement(FullBellLine, { line: { id: "n", text: "Alex sent answers for Harbor Run. Review the work.", href: "/app/tests/t#piece-s", read: false, ago: "now", links: [{ text: "Alex", href: "/app/testers/a", kind: "person" }, { text: "Harbor Run", href: "/app/tests/t", kind: "test" }] }, onRead: () => { } }));
    expect(html).toContain('href="/app/testers/a"');
    expect(html).toContain('href="/app/tests/t"');
    expect(html).toContain('href="/app/tests/t#piece-s"');
    expect(html).not.toMatch(/<a[^>]*>[^<]*<a/);
});
it("expanded ordinary notifications keep their destination too", () => {
    expect(renderToStaticMarkup(React.createElement(FullBellLine, { line: { id: "n", text: "Your update is ready", href: "/app/payments", read: false, ago: "now" }, onRead: () => { } }))).toContain('href="/app/payments"');
});
it("local panel search matches either name, is case insensitive, and combines ticked states as alternatives", () => {
    expect(panelMatches("Harbor Run Alex", " alex ")).toBe(true);
    expect(panelMatches("Harbor Run Alex", "harbor", ["Left"], ["Closed", "Left"])).toBe(true);
    expect(panelMatches("Harbor Run Alex", "harbor", ["Left"], ["Closed"])).toBe(false);
    expect(panelMatches("Different test Jordan", "alex")).toBe(false);
});
it("previous tests distinguish removal, personal departure, normal completion and current work", () => {
    const base = { status: "ended", endKind: "early", test: { status: "open", workEndedAt: null } };
    expect(previousTestGroup(base)).toBe("Removed From");
    expect(previousTestGroup({ ...base, endKind: "suspended" })).toBe("Removed From");
    expect(previousTestGroup({ ...base, status: "left", endKind: "" })).toBe("Left");
    expect(previousTestGroup({ ...base, endKind: "rated" })).toBe("Closed");
    expect(previousTestGroup({ ...base, status: "working", endKind: "" })).toBeNull();
    expect(previousTestGroup({ ...base, status: "working", endKind: "", test: { status: "stopped", workEndedAt: null } })).toBe("Closed");
});
it("developer filters separate admin and own stops and retain Open through close-out", () => {
    expect(developerTestGroups({ status: "stopped", adminStoppedAt: new Date() }, false, false)).toEqual(["Stopped by admin", "Open"]);
    expect(developerTestGroups({ status: "stopped", adminStoppedAt: null }, false, true)).toEqual(["Stopped by you"]);
    expect(developerTestGroups({ status: "open", adminStoppedAt: null }, true, false)).toEqual(["Paused", "Open"]);
    expect(developerTestGroups({ status: "draft", adminStoppedAt: null }, false, false)).toEqual([]);
});
it("search panels expose independent labels and resize handles", () => {
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
        React.createElement(SearchPanel, { id: "dms", title: "Direct messages", placeholder: "Search direct messages by name", items: [] }),
        React.createElement(SearchPanel, { id: "tests", title: "Test messages", placeholder: "Search test messages by developer or test", items: [] })));
    expect(html).toContain('aria-label="Search direct messages by name"');
    expect(html).toContain('aria-label="Search test messages by developer or test"');
    expect(html).toContain("Direct messages");
    expect(html).toContain("Test messages");
});
it("shared cards keep developer and test links independent and private invite-only details hidden", () => {
    const t = { id: "t", title: "Harbor", productName: "Product", categories: ["Game"], writtenCents: 1000, recordingCents: null, liveRateCents: null, devices: ["Windows"], languages: ["English"], mature: false, ndaText: "secret", joinMode: "invite", developerId: "a", developer: { name: "Alex", email: "alex@playtest.test", deletedAt: null } };
    const html = renderToStaticMarkup(React.createElement(FindTestCard, { test: t, href: "/app/find/t", terms: "Written $8.00", developerName: "Alex", redacted: true }));
    expect(html).toContain('href="/app/developers/a"');
    expect(html).toContain('href="/app/find/t"');
    expect(html).not.toContain("Written $8.00");
    expect(html).not.toContain("Windows");
});

it("payment targets remain present while paid, delayed or waiting",()=>{ for(const props of [{review:{rejected:false,reason:"Paid"}},{delayed:true},{}]) expect(renderToStaticMarkup(React.createElement(TesterPaymentTag,{anchor:"payment-piece",...props}))).toContain('id="payment-piece"'); });

it("To do contains only the test, its deadline and Send work, including expired deadlines",()=>{
 const props={id:"session",title:"Harbor Run",dueAt:new Date("2026-11-03T12:00:00Z"),now:new Date("2026-11-07T12:00:00Z"),timeZone:"UTC"};
 const html=renderToStaticMarkup(React.createElement(TodoTestRow,props));
 expect(html).toContain("Deadline passed");expect(html).toContain('href="/app/sessions/session#parts"');expect(html.match(/Send work/g)).toHaveLength(1);
 expect(html).not.toMatch(/Every part sent|Switch|Keep|Written answers|\$/);
 expect(renderToStaticMarkup(React.createElement(TodoTestRow,{...props,now:new Date("2026-11-01T12:00:00Z")}))).not.toContain("Deadline passed");
});

it("old dashboard anchors fall back to their replacement panels",()=>{expect(hashTargets("needs-review")).toEqual(["needs-review","needs-you","your-tests"]);for(const id of ["history","rejoin","suspended-tests"])expect(hashTargets(id)).toEqual([id,"previous-tests"]);});
