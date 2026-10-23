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

describe("(NEXT-UI 4b) the pop-up's Join anyway / Apply anyway", () => {
  it("Apply warns too (every unmet need), and 'anyway' applies; something missing that the pop-up didn't show stops once more", async () => {
    const { testId } = await setup({ devices: ["Mac"], languages: ["Spanish"], joinMode: "apply" });
    const ben = await makeUser({ tester: true });
    const r = await act(testId, "apply", ben.cookie, {});
    expect(r.body.error).toMatchObject({ code: "needs", gaps: { languages: ["Spanish"], devices: ["Mac"] } });
    expect(r.body.error.message).toContain("Add your device in your profile.");
    expect(r.body.error.message).toContain("Add the language in your profile.");
    expect(r.body.error.message.endsWith("Apply anyway?")).toBe(true);
    // The pop-up showed only the language; the device is missing too: stops again, with the list as it is now.
    const stale = await act(testId, "apply", ben.cookie, { anyway: true, gapsShown: { languages: ["Spanish"], devices: [] } });
    expect(stale.body.error).toMatchObject({ code: "needs", changed: true, gaps: { languages: ["Spanish"], devices: ["Mac"] } });
    expect(await db.application.count({ where: { testId, testerId: ben.user.id } })).toBe(0);
    const ok = await act(testId, "apply", ben.cookie, { anyway: true, gapsShown: r.body.error.gaps });
    expect(ok.status).toBe(200);
    expect(await db.application.count({ where: { testId, testerId: ben.user.id } })).toBe(1);
    // The pop-up's live check.
    const mine = await act(testId, "my-gaps", ben.cookie, {});
    expect(mine.body.gaps).toEqual({ languages: ["Spanish"], devices: ["Mac"] });
  });
});
