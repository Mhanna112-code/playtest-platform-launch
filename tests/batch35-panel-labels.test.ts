import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ListingPanel } from "@/app/app/tests/[id]/ListingPanel";
import { PANEL_ROWS, panelRows } from "@/lib/listingPanel";
import type { Listing } from "@/lib/rules";

(globalThis as unknown as { React: typeof React }).React = React; // the components use the classic JSX runtime in tests

// Batch 35 §15 (owner, Oct 31, the developer's Listing panel): "no way to tell difference between question and answers" — "Product: PENIQQQ", "Name: …",
// "What to do:" and the questions all read alike. Each line is now its label (small, muted, uppercase, on its own line, with its "Updated" tag) over its value
// (bright); the questions a numbered list with "Required" as a small tag after the quote; What to do and the NDA in their scroll boxes. The developer's test page
// and the tester's join page draw the same panel.

const listing = {
  productName: "PENIQQQ", title: "fqejfjjdddd", description: "Open the build.\nPlay the first level.", buildUrl: "https://example.com/build",
  questions: ["[required] What did you like?", "Where did you get stuck?"], ndaText: "Keep it secret.", devices: ["Mac"], languages: [], categories: ["Game"],
  mature: false, matureWhy: "", writtenCents: 1000, writtenRequired: true, recordingCents: null, recordingRequired: false, liveRateCents: null, liveMinutes: null,
  liveRequired: false, deadlineDays: 7, openUntil: null, joinMode: "anyone", spots: 3,
} as unknown as Listing;
const at = new Date("2026-10-31T15:00:00Z");
const last = { fields: ["title"], before: { title: "old name" }, after: { title: "fqejfjjdddd" }, at };
const html = (side: "developer" | "tester") =>
  renderToStaticMarkup(createElement(ListingPanel, { side, rows: panelRows(listing, last, side), listing, when: () => "Sat, Oct 31, 10:00 AM", savedAt: at.toISOString() }));
/** One line of the panel: from its own `data-info-line` up to the next line's (the questions' own list items sit inside it). */
const line = (h: string, key: string) => { const at = h.indexOf(`data-info-line="${key}"`); const next = h.indexOf("data-info-line=", at + 1); return h.slice(at, next < 0 ? undefined : next); };

describe("batch 35 §15: the Listing panel's labels read apart from its values", () => {
  for (const side of ["developer", "tester"] as const) {
    it(`${side}: each line is a small muted uppercase label over a bright value; no "Label:" run into the value`, () => {
      const h = html(side);
      expect(h.match(/data-panel-label=""/g)?.length).toBe(PANEL_ROWS.length);
      expect(h.match(/data-panel-value=""/g)?.length).toBe(PANEL_ROWS.length);
      const product = line(h, "productName");
      expect(product).toMatch(/<span class="text-\[11px\] font-medium uppercase tracking-wide text-slate-400" data-panel-label="">Product<\/span>/);
      expect(product).toMatch(/<div class="mt-0\.5 text-slate-100" data-panel-value=""><span[^>]*>PENIQQQ<\/span>/);
      expect(h).not.toContain("Product:");
      expect(h).not.toContain("Name:");
      expect(h).not.toContain("What to do:");
      // The "Updated <time>" tag stays next to its label, before the value.
      const name = line(h, "title");
      expect(name.indexOf("Updated Sat, Oct 31, 10:00 AM")).toBeGreaterThan(name.indexOf(">Name</span>"));
      expect(name.indexOf("Updated Sat, Oct 31, 10:00 AM")).toBeLessThan(name.indexOf("data-panel-value"));
    });

    it(`${side}: the questions are a numbered list, "Required" a small tag outside the quotes; What to do and the NDA keep their scroll boxes`, () => {
      const h = html(side);
      const q = line(h, "questions");
      expect(q).toContain("<ol");
      expect(q.match(/<li class="flex gap-2" data-question="">/g)?.length).toBe(2);
      expect(q).toMatch(/>1\.<\/span>.*“What did you like\?”.*data-question-required="">Required<\/span>.*>2\.<\/span>.*“Where did you get stuck\?”/s);
      expect(q.match(/data-question-required/g)?.length).toBe(1);
      expect(q).not.toContain("(required)");
      expect(line(h, "description")).toMatch(/data-scroll-text=""[^>]*>Open the build\.\nPlay the first level\.<\/div>/);
      expect(line(h, "ndaText")).toContain('aria-label="NDA"');
    });
  }
});
