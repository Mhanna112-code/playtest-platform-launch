import { describe, expect, it } from "vitest";
import { ApiError, errOf, FIELD, isFieldError } from "@/lib/client";
import { db } from "@/lib/db";
import { makeUser } from "./helpers";
import { act, setup } from "./fixtures";

describe("form mistakes are red, refusals blue", () => {
  it("400 / 413 errors carry the red mark; refusals don't", () => {
    expect(isFieldError(new ApiError(400, "bad_amount", "Enter an amount like 7.50."))).toBe(true);
    expect(errOf(new ApiError(400, "bad_amount", "Enter an amount like 7.50."))).toBe(FIELD + "Enter an amount like 7.50.");
    expect(errOf(new ApiError(409, "refused", "This test is full."))).toBe("This test is full.");
    expect(isFieldError(new ApiError(402, "card_failed", "declined"))).toBe(false);
  });
});

describe("missing device or language: Join anyway?", () => {
  it("warns in place; Join anyway joins", async () => {
    const { testId } = await setup({ devices: ["Mac"] });
    const ben = await makeUser({ tester: true });
    const r = await act(testId, "join", ben.cookie, {});
    expect(r.body.error).toMatchObject({ code: "needs", message: "This test needs one of: Mac. Add your device in your profile.\nJoin anyway?" });
    expect((await act(testId, "join", ben.cookie, { anyway: true })).status).toBe(200);
    expect(await db.contract.count({ where: { testId, testerId: ben.user.id } })).toBe(1);
  });
});
