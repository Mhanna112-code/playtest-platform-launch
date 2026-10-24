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

describe("(NEXT-UI 4b) the pop-up follows both sides live", () => {
  it("my-gaps drops items when the tester adds them and adds/drops them when the developer changes the test's needs, both directions", async () => {
    const { dev, testId } = await setup({ devices: ["Mac"], languages: ["Spanish"] });
    const ben = await makeUser({ tester: true });
    const gaps = async () => (await act(testId, "my-gaps", ben.cookie, {})).body;
    expect((await gaps()).gaps).toEqual({ languages: ["Spanish"], devices: ["Mac"] });
    // The tester adds a language in their profile: it drops off.
    await db.testerProfile.update({ where: { userId: ben.user.id }, data: { languages: ["English", "Spanish"] } });
    expect((await gaps()).gaps).toEqual({ languages: [], devices: ["Mac"] });
    // The developer adds a language the tester lacks: it comes back, and the test's needs are reported.
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    await act(testId, "edit", dev.cookie, { version: v, confirmed: true, fields: { languages: ["Korean"] } });
    const after = await gaps();
    expect(after.gaps).toEqual({ languages: ["Korean"], devices: ["Mac"] });
    expect(after.needs).toEqual({ devices: ["Mac"], languages: ["Korean"] });
    // The tester removes the device they had and adds the new need: everything is met.
    await db.testerProfile.update({ where: { userId: ben.user.id }, data: { languages: ["Korean"], devices: ["Mac"] } });
    expect((await gaps()).gaps).toEqual({ languages: [], devices: [] });
    // Removed again later: missing again (the popup opens again with the current list).
    await db.testerProfile.update({ where: { userId: ben.user.id }, data: { devices: ["Windows PC"] } });
    expect((await gaps()).gaps).toEqual({ languages: [], devices: ["Mac"] });
    expect((await act(testId, "join", ben.cookie, {})).body.error).toMatchObject({ code: "needs", gaps: { languages: [], devices: ["Mac"] } });
  });
});
