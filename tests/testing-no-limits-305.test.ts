import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/limits";
import { MAX_CALLS, MAX_SENT_PER_DAY } from "@/lib/callClash";
import { TESTING_NO_LIMITS } from "@/lib/testingLimits";

describe("(Owner, Nov 6) §305 the local testing switch for limits", () => {
  it("without the switch every limit is 3", () => {
    expect(TESTING_NO_LIMITS).toBe(false);
    expect(LIMITS.criticalChanges).toBe(3);
    expect(MAX_CALLS).toBe(3);
    expect(MAX_SENT_PER_DAY).toBe(3);
  });
});
