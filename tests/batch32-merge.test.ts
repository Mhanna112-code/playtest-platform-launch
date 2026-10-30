import { describe, expect, it } from "vitest";
import { mergeChanges } from "@/lib/live";

// (Owner's finding, Oct 29, batch 32 §8) A stop box showed "This test was stopped at 3:22 PM." and "This test was stopped · 3:22 PM": one moment, two lines.
describe("batch 32 §8: the same moment from the server and the live update is one line", () => {
  const at = "2026-10-29T20:22:05.120Z";
  it("the live line joins nothing when the box already says it (the box keeps its wording)", () => {
    const box = [{ text: "This test was stopped at 3:22 PM.", at }];
    expect(mergeChanges(box, [{ text: "This test was stopped", at: "2026-10-29T20:22:05.310Z" }])).toEqual(box);
    expect(mergeChanges([{ text: "This test was paused at 3:22 PM.", at }], [{ text: "This test was paused", at }])).toHaveLength(1);
  });
  it("different moments or different words still both show", () => {
    expect(mergeChanges([{ text: "This test was stopped at 3:22 PM.", at }], [{ text: "This test was stopped", at: "2026-10-29T20:25:00.000Z" }])).toHaveLength(2);
    expect(mergeChanges([{ text: "Ana paid $10.00 for your written answers", at }], [{ text: "Ana paid $12.00 for your written answers", at }])).toHaveLength(2);
    expect(mergeChanges([{ text: "Marc Hanna edited the listing at 6:55 PM: title", at }], [{ text: "Marc Hanna edited the listing at 6:55 PM: description", at }])).toHaveLength(2);
  });
});
