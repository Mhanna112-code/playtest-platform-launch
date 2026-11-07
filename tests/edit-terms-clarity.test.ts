import { expect, it } from "vitest";
import { EDIT_TEST_TERMS, WHAT_CHANGED } from "@/lib/termsOfUse";
it("explains that Keep preserves agreed parts and prices while other listing edits still apply", () => {
  expect(EDIT_TEST_TERMS).toContain("Every saved edit updates the test's current listing");
  expect(EDIT_TEST_TERMS).toContain("Switch accepts the new parts and prices; Keep retains their existing agreed parts and prices");
  expect(EDIT_TEST_TERMS).toContain("Keep does not preserve an older version of the rest of the listing");
  expect(EDIT_TEST_TERMS).toContain("separately from Switch or Keep");
  expect(EDIT_TEST_TERMS).toContain("only if those deadlines have not already passed");
  expect(WHAT_CHANGED[0].points.some((p) => p.includes("keeping those terms does not keep old questions"))).toBe(true);
});
it("explains consistent addition pricing before the deadline and preservation afterward", () => {
  expect(EDIT_TEST_TERMS).toContain("sending additional recordings updates the unpaid part");
  expect(EDIT_TEST_TERMS).toContain("After the deadline or once Charge opens, additions preserve");
  expect(EDIT_TEST_TERMS).toContain("After payment or Charge, additions never reopen Charge");
});
