import { readFileSync } from "node:fs";
import path from "node:path";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { NdaNotice } from "@/components/NdaNotice";
import { NDA_ACK_PRESS, NDA_BLOCK_FIRST, ndaNoticeLine, ndaNoticeOpen } from "@/lib/ndaNotice";
import { refusalLine } from "@/lib/pressLabels";
import { joined, sact, seen, setup } from "./fixtures";

// (Owner, Nov 6, §314) The NDA notice is ONE clickable line, "fbbb changed the NDA. Click here to acknowledge you've seen the change.": no button, no separate
// link. Pressing anywhere on it acknowledges (lifts the block), the line goes from the page, and the page goes to the NDA; pending while sent; a failed press shows
// its line under it. A later NDA change brings a new notice (only ever one, for the latest change).

vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/s", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams() }));
(globalThis as unknown as { React: typeof React }).React = React;
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");

describe("§314 the NDA notice is one clickable line", () => {
  it("one link (a real <a href>, role button: keyboard and screen readers), no button, the whole line; the sky box and its anchor stay", () => {
    const html = unescape(renderToStaticMarkup(h(NdaNotice, { sessionId: "s1", dev: "fbbb", kind: "changed", open: true, block: true })));
    expect(html).toMatch(/^<div id="nda-notice" class="info /);
    expect(html).toContain(`<p class="min-w-0"><a href="#info-nda" role="button" data-nda-ack="">${ndaNoticeLine("fbbb")}</a></p>`);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toContain("<button");
    expect(renderToStaticMarkup(h(NdaNotice, { sessionId: "s1", dev: "fbbb", kind: "changed", open: false, block: false }))).toBe("");
  });

  it("pressing it: acknowledges once (a double press sends nothing more), the line goes, then the NDA; a failure shows its line under it", () => {
    const c = src("components/NdaNotice.tsx");
    expect(c).toContain("if (sending.current) return;");
    expect(c).toContain('api(`/api/sessions/${sessionId}/nda-seen`, {})');
    expect(c).toContain("setGone(true);");
    expect(c).toContain("if (!open || gone) return null;");
    expect(c).toContain("setTimeout(() => jumpTo(NDA_INFO), 60);");
    expect(c).toContain('if (e.key === " ") { e.preventDefault(); acknowledge(); }');
    expect(c).toContain('{...(busy ? { "aria-disabled": true, "aria-busy": true, "data-pending": "" } : {})}');
    expect(c).toContain(".catch((x) => { setErr(errOf(x)); sending.current = false; setBusy(false); });");
    expect(c).toContain("<Err text={err} press={NDA_ACK_PRESS} />");
    // A later change: a new notice (keyed by the change's time on the page).
    expect(src("app/app/sessions/[id]/page.tsx")).toContain('<NdaNotice key={c.ndaChangedAt?.toISOString() ?? "none"}');
    expect(refusalLine("Send", NDA_BLOCK_FIRST)).toBe("Acknowledge the NDA change first.");
    expect(NDA_ACK_PRESS).toBe("Acknowledge");
  });

  it("acknowledged, it stays gone (a reload reads it acknowledged); a later change opens a new one", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva");
    await db.contract.update({ where: { id: j.sessionId }, data: { ndaChangedAt: new Date(Date.now() - 60_000), ndaChangeKind: "changed", ndaNoticeSeenAt: null } });
    expect((await sact(j.sessionId, "nda-seen", j.tester.cookie, { seenAt: seen() })).status).toBe(200);
    expect(ndaNoticeOpen(await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } }))).toBe(false);
    await db.contract.update({ where: { id: j.sessionId }, data: { ndaChangedAt: new Date(Date.now() + 1000) } });
    expect(ndaNoticeOpen(await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } }))).toBe(true);
  });
});
