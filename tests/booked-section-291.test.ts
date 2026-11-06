import { readFileSync } from "node:fs";
import path from "node:path";
import React, { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DevCallPanel, bookedPersonAnchor, type DevCall, type DevTester } from "@/app/app/tests/[id]/DevCallPanel";
import { TesterCallPanel } from "@/app/app/sessions/[id]/TesterCallPanel";
import { CALL_CHECK_LABEL } from "@/lib/rules";
import { seen } from "./fixtures";

// (Owner, Nov 6, §291) "Booked" is its own section at the BOTTOM of the Live session panel: "Booked (N)", then the draggable scroll panel (its own scroll); on
// the developer's test page one drop-down per tester inside it (the green name, "· N calls"), each with that tester's calls soonest first in a scroll box of its
// own; on the tester's session page the same section with no per-name drop-down (one developer). Every call row keeps its buttons and its call-<id> anchor.

vi.mock("next/navigation", () => ({ usePathname: () => "/app/tests/t1", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const HOUR = 3_600_000;
const iso = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const call = (id: string, hours: number, over: Partial<DevCall> = {}): DevCall => ({ id, when: iso(hours), minutes: 30, rate: "Contract $30/h", canCancel: true, started: false, reported: false, ...over });
/** The text from `from` up to the next `to` after it. */
const between = (html: string, from: string, to: string) => {
  const a = html.indexOf(from);
  expect(a, from).toBeGreaterThan(-1);
  const b = html.indexOf(to, a + from.length);
  return html.slice(a, b < 0 ? undefined : b);
};

const ana: DevTester = {
  contractId: "ca", name: "Ana Silva", testerHref: "/app/testers/a", terms: "due Nov 20", booked: 2, requests: [],
  calls: [call("a-later", 72), call("a-sooner", 48)],
  sets: [{ id: "set-a", label: "Weekly · Thu 3:00 PM (2 left)", minutes: 30, rate: "Contract $30/h", needsReason: false, calls: [call("a-set-1", 60), call("a-set-2", 60 + 168)] }],
};
const ben: DevTester = { contractId: "cb", name: "Ben Carter", testerHref: "/app/testers/b", terms: "due Nov 20", booked: 1, requests: [], sets: [], calls: [call("b-now", 0.1, { joinable: true, canCancel: false })] };
const cara: DevTester = { contractId: "cc", name: "Cara Diaz", testerHref: "/app/testers/c", terms: "due Nov 20", booked: 0, requests: [], sets: [], calls: [] };
const dev = (over: Partial<Parameters<typeof DevCallPanel>[0]> = {}) =>
  unescape(render(h(DevCallPanel, { testId: "t1", seenAt: seen(), leadMinutes: 1, canRequest: true, testers: [ana, ben, cara], ...over })));

describe("§291 the developer's Live session: Booked (N) at the bottom, one drop-down per tester", () => {
  it("the section comes after the request form, headed with the count of booked calls (a set's calls too), and nothing of the panel follows it", () => {
    const html = dev();
    const booked = html.indexOf('data-live-section="Booked"');
    expect(booked).toBeGreaterThan(-1);
    expect(html).toContain('<h3 class="text-sm font-semibold text-white">Booked (5)</h3>');
    // Under the tick list and the Request a time form.
    expect(booked).toBeGreaterThan(html.indexOf("Select all (3)"));
    expect(booked).toBeGreaterThan(html.indexOf("Request a time</button>"));
    // The last section: no form or tick list after it.
    const after = html.slice(booked);
    expect(after).not.toContain("Request a time</button>");
    expect(after).not.toContain("<fieldset");
    // Its draggable panel is its own scroll (not flattened into an outer one).
    const outer = between(html, 'data-panel="testers-calls-t1"', 'data-panel-box=""');
    expect(outer).not.toContain("data-panel-flat");
  });

  it("one drop-down per tester with a call (the green name, '· N calls'), soonest tester first; open only while a call can be joined; each has its own scroll box", () => {
    const html = dev();
    expect(html).not.toContain(`data-booked-person="cc"`); // Cara has no call
    const benAt = html.indexOf(`id="${bookedPersonAnchor("cb")}"`), anaAt = html.indexOf(`id="${bookedPersonAnchor("ca")}"`);
    expect(benAt).toBeGreaterThan(-1);
    expect(anaAt).toBeGreaterThan(benAt); // Ben's call is the soonest
    const benFold = between(html, `id="${bookedPersonAnchor("cb")}"`, `id="${bookedPersonAnchor("ca")}"`);
    const anaFold = html.slice(anaAt);
    expect(between(benFold, "<summary", "</summary>")).toMatch(/href="\/app\/testers\/b"[^>]*data-name-link="person"><span[^>]*>Ben Carter<\/span><\/a><\/span><span[^>]*data-booked-count="">· 1 call<\/span>/);
    expect(between(anaFold, "<summary", "</summary>")).toContain("· 4 calls</span>");
    // Ben's call can be joined: his drop-down is open; Ana's is closed at first.
    expect(html.slice(html.lastIndexOf("<details", benAt), benAt)).toContain('open=""');
    expect(html.slice(html.lastIndexOf("<details", anaAt), anaAt)).not.toContain('open=""');
    // Each tester's own scroll box, not flattened by the outer panel.
    for (const id of ["ca", "cb"]) expect(between(html, `data-panel="booked-${id}"`, 'data-panel-box=""')).not.toContain("data-panel-flat");
  });

  it("inside a drop-down, the calls and the set soonest first; every row keeps its anchor and buttons, and doesn't repeat the name", () => {
    const html = dev();
    const anaFold = html.slice(html.indexOf(`id="${bookedPersonAnchor("ca")}"`));
    const order = [anaFold.indexOf('id="call-a-sooner"'), anaFold.indexOf('data-call-set=""'), anaFold.indexOf('id="call-a-later"')];
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const id of ["a-sooner", "a-later"]) {
      const row = between(html, `id="call-${id}"`, "</li>");
      expect(row).toContain(`href="/api/calls/${id}/ics"`);
      expect(row).toContain("Add to calendar");
      expect(row).toContain("Cancel ▾");
      expect(row).toContain('aria-label="Why"');
      expect(row).toContain(CALL_CHECK_LABEL);
      expect(row).toContain("Contract $30/h");
      expect(row).toContain("30 min");
      // The line itself doesn't repeat the name (it's on the drop-down); the Cancel rule still names who is told.
      expect(between(row, '<span class="mr-auto min-w-0">', "</span>")).not.toContain("Ana Silva");
    }
    // The set keeps its line and its "Cancel the remaining calls".
    const set = between(anaFold, 'data-call-set=""', 'id="call-a-later"');
    expect(set).toContain("Weekly · Thu 3:00 PM (2 left) · 30 min");
    expect(set).toContain("Cancel the remaining calls");
    expect(between(set, '<span class="mr-auto min-w-0">', "</span>")).not.toContain("Ana Silva");
    // A call that can be joined: Join call, its Cancel's Why required (less than 24 hours away).
    const now = between(html, 'id="call-b-now"', "</li>");
    expect(now).toContain("Join call");
    expect(now).toContain("Why? (less than 24 hours away)");
    // The anchors are on the page once each (the jump target of bells, the top box and the dashboard).
    for (const id of ["a-sooner", "a-later", "b-now"]) expect(html.split(`id="call-${id}"`).length - 1).toBe(1);
  });

  it("no call at all: 'Booked (0)' with its line while requesting is possible; nothing when it isn't; a paused page still lists its calls", () => {
    const none = dev({ testers: [cara] });
    expect(none).toContain(">Booked (0)</h3>");
    expect(none).toContain("No calls booked yet.");
    expect(dev({ testers: [cara], canRequest: false })).not.toContain('data-live-section="Booked"');
    const paused = dev({ canRequest: false, noRequestReason: "Paused" });
    expect(paused).toContain(">Booked (5)</h3>");
    expect(paused).toContain('id="call-a-sooner"');
  });

  it("the source: the drop-downs are HoldFolds (a link to #call-<id> opens them) and the panels are OwnPanel ResizeBoxes", () => {
    const s = src("app/app/tests/[id]/DevCallPanel.tsx");
    expect(s).toContain("<OwnPanel><ResizeBox id={`testers-calls-${testId}`}");
    expect(s).toContain("<OwnPanel><ResizeBox id={`booked-${t.contractId}`} label={`Booked calls with ${t.name}`} defaultMax={LIST_PANEL.booked}>");
    expect(s).toContain("<HoldFold key={t.contractId} defaultOpen={joinableFor(t)}");
    expect(s).toContain('<li key={c.id} id={`call-${c.id}`}');
  });
});

describe("§291 the tester's Live session: the same Booked (N) section at the bottom, no per-name drop-down", () => {
  const mine = [
    { id: "t-later", when: iso(72), minutes: 30, canCancel: true, started: false, reported: false, cancelled: "", rate: "Contract $30/h" },
    { id: "t-sooner", when: iso(48), minutes: 30, canCancel: true, started: false, reported: false, cancelled: "", rate: "Contract $30/h" },
    { id: "t-set-1", setId: "set-t", when: iso(60), minutes: 45, canCancel: true, started: false, reported: false, cancelled: "" },
    { id: "t-set-2", setId: "set-t", when: iso(60 + 168), minutes: 45, canCancel: true, started: false, reported: false, cancelled: "" },
  ];
  const tester = () => unescape(render(h(TesterCallPanel, { sessionId: "s1", seenAt: seen(), refusal: "", devName: "Nora Lane", mine, sets: [{ id: "set-t", label: "Weekly · Thu 3:00 PM (2 left)", minutes: 45, rate: "Contract $30/h", needsReason: false, callIds: ["t-set-1", "t-set-2"] }] })));

  it("'Booked (4)', its own scroll panel, calls and the set soonest first, each row with its buttons and anchor", () => {
    const html = tester();
    expect(html).toContain('data-live-section="Booked"');
    expect(html).toContain('<h3 class="text-sm font-semibold text-white">Booked (4)</h3>');
    expect(between(html, 'data-panel="booked-s1"', 'data-panel-box=""')).not.toContain("data-panel-flat");
    expect(html).not.toContain("data-booked-person");
    const order = [html.indexOf('id="call-t-sooner"'), html.indexOf('data-call-set=""'), html.indexOf('id="call-t-later"')];
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const row = between(html, 'id="call-t-sooner"', "</li>");
    for (const s of ['href="/api/calls/t-sooner/ics"', "Add to calendar", "Cancel ▾", 'aria-label="Why"', CALL_CHECK_LABEL]) expect(row).toContain(s);
  });

  it("the session page draws it last in the Live session: after Had / Cancelled and the Requests", () => {
    const page = src("app/app/sessions/[id]/page.tsx");
    const live = page.slice(page.indexOf("<LivePanel"), page.indexOf("</LivePanel>"));
    expect(live.indexOf("<TesterCallPanel")).toBeGreaterThan(live.indexOf("data-calls-fold={c.id}"));
    expect(live.indexOf("<TesterCallPanel")).toBeGreaterThan(live.indexOf("id={TESTER_REQUESTS_BOX}"));
    expect(live.slice(live.indexOf("<TesterCallPanel"))).not.toContain("<CallRequests");
  });
});
