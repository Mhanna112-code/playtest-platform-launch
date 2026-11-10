import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// (Owner, Nov 11, §376) A join-page box (Join, Apply, Ask to rejoin, No thanks, Withdraw application) always stops, whatever the tester's Alerts: it never
// offers them ("You can turn these stops off below, or with Alerts …" and "Turn off alerts"). The session page's tester boxes keep the offer.
vi.mock("next/navigation", () => ({ usePathname: () => "/app/find/demo", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams() }));
(globalThis as { React?: typeof React }).React = React;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");

describe("§376 join-page boxes don't offer Alerts", () => {
  const changes = [{ text: "Nora Lane edited the listing", at: new Date().toISOString() }];
  it("a join-page box: no Alerts line, no Turn off alerts; a session box still has both", async () => {
    const { ChangesBox } = await import("@/components/ChangesBox");
    const join = renderToStaticMarkup(React.createElement(ChangesBox, { side: "tester", changes, alertsWhere: "join", press: "Join" }));
    expect(join).toContain("Nora Lane edited the listing");
    expect(join).not.toContain("data-quick-alerts-off");
    expect(join).not.toContain("Turn off alerts");
    expect(join).not.toContain("You can turn these stops off");
    const session = renderToStaticMarkup(React.createElement(ChangesBox, { side: "tester", changes, press: "Send Answers" }));
    expect(session).toContain("data-quick-alerts-off");
    expect(session).toContain("Turn off alerts");
  });

  it("every join-page box is marked as one (JoinBox's three, No thanks on the join page)", () => {
    const join = src("app/app/find/[id]/JoinBox.tsx");
    expect(join.match(/<ChangesBox [^>]*alertsWhere="join"/g)?.length).toBe(3);
    expect(join.match(/<ChangesBox /g)?.length).toBe(3);
    expect(src("app/app/find/[id]/NoThanksButton.tsx")).toContain('alertsWhere="join"');
    // The dashboard's No thanks box is the developer-side box with no Alerts lines (nothing to switch off): unchanged.
    expect(src("app/app/NoThanks.tsx")).toContain('<ChangesBox changes={box?.changes ?? null} tail={box?.tail} press="No thanks" />');
  });
});
