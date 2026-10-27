import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { GET as testGET } from "@/app/api/tests/[id]/[action]/route";
import { json, makeUser, req } from "./helpers";
import { act, joined, listingBody, sact, seen, setup } from "./fixtures";

const day = 86_400_000;
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  return act(testId, "edit", cookie, { version: v, fields, ...extra });
};
const post = async (cookie: string, over: Record<string, unknown>) => json(await testsPOST(req("/api/tests", { cookie, body: listingBody(over) })));

describe("Post a test (design doc 4)", () => {
  it("needs the product name, a title and What to do, within their limits; the errors name the field", async () => {
    const dev = await makeUser({ dev: true });
    const r = await post(dev.cookie, { productName: "", title: "x".repeat(61), description: "" });
    expect(r.status).toBe(400);
    expect(r.body.error.errors).toEqual(expect.arrayContaining(["Enter the product name.", "Keep the title to 60 characters.", "Say what testers should do (What to do)."]));
    expect((await post(dev.cookie, { productName: "x".repeat(61) })).body.error.message).toBe("Keep the product name to 60 characters.");
    expect((await post(dev.cookie, { description: "x".repeat(1001) })).body.error.message).toBe("Keep What to do to 1,000 characters.");
  });

  it("Mature needs its reason", async () => {
    const dev = await makeUser({ dev: true });
    expect((await post(dev.cookie, { mature: true, matureWhy: "" })).body.error.message).toMatch(/mature/i);
    const ok = await post(dev.cookie, { mature: true, matureWhy: "Gore in the boss fights" });
    expect(ok.status).toBe(200);
    expect(await db.test.findUniqueOrThrow({ where: { id: ok.body.id } })).toMatchObject({ mature: true, matureWhy: "Gore in the boss fights" });
  });

  it("the deadline must leave 3 days inside Open until, and keys must cover the spots", async () => {
    const dev = await makeUser({ dev: true });
    const soon = new Date(Date.now() + 6 * day).toISOString().slice(0, 10);
    const r = await post(dev.cookie, { deadlineDays: 7, openUntil: soon });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/^Set Open until to .+ or later to allow a 7-day deadline\.$/);
    const far = new Date(Date.now() + 12 * day).toISOString().slice(0, 10);
    expect((await post(dev.cookie, { deadlineDays: 7, openUntil: far })).status).toBe(200);
    expect((await post(dev.cookie, { spots: 3, accessKeys: "A1\nA2" })).body.error.message).toBe("Add 1 more key: 3 open spots, 2 free keys.");
    expect((await post(dev.cookie, { spots: 3, accessKeys: "A1\nA1\nA2" })).body.error.message).toMatch(/typed more than once/);
    const withKeys = await post(dev.cookie, { spots: 2, accessKeys: "K1\nK2\nK3" });
    expect(withKeys.status).toBe(200);
    expect(await db.accessKey.count({ where: { testId: withKeys.body.id, status: "free" } })).toBe(3);
  });
});

describe("Edit (design doc 5)", () => {
  it("lengthening the deadline past Open until is red with the date to extend to; Open until can only be extended", async () => {
    const { dev, testId } = await setup({ deadlineDays: 3, openUntil: new Date(Date.now() + 20 * day).toISOString().slice(0, 10) });
    const r = await edit(testId, dev.cookie, { deadlineDays: 30 });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/^Extend Open until to .+ or later to allow a 30-day deadline\.$/);
    expect((await edit(testId, dev.cookie, { deadlineDays: 30, openUntil: new Date(Date.now() + 60 * day).toISOString().slice(0, 10) })).status).toBe(200);
    const shorter = await edit(testId, dev.cookie, { openUntil: new Date(Date.now() + 40 * day).toISOString().slice(0, 10) });
    expect(shorter.status).toBe(400);
    expect(shorter.body.error.message).toMatch(/^Open until can only be extended/);
  });

  it("the critical fields can be changed 3 times once a tester has joined; the 4th is red with Contact support", async () => {
    const { dev, testId } = await setup();
    // Before anyone joined, nothing counts.
    for (let i = 0; i < 4; i++) expect((await edit(testId, dev.cookie, { description: `Before ${i}` })).status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).criticalChanges).toBe(0);
    await joined(testId);
    for (let i = 0; i < 3; i++) expect((await edit(testId, dev.cookie, { description: `After ${i}`, buildUrl: `https://example.com/${i}` })).status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).criticalChanges).toBe(3);
    // (Owner, Oct 28) The refusal names the whole list, whichever limited field the Save touched.
    const r = await edit(testId, dev.cookie, { languages: ["English"] });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toBe("You've changed the steps, NDA, questions, languages or devices 3 times since testers joined. Contact us in Settings to change them again.");
    expect(r.body.error.critical).toEqual(["languages"]);
    // Other fields still save: the build link is no longer limited.
    expect((await edit(testId, dev.cookie, { title: "New name", buildUrl: "https://example.com/again" })).status).toBe(200);
  });

  it("an NDA change is a new offer the tester accepts (switch); the tester's terms history keeps the old text", async () => {
    const { dev, testId } = await setup({ ndaText: "Keep it secret." });
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).listingVersion;
    expect((await act(testId, "join", t.cookie, { listingVersion: v })).body.error.message).toBe("Accept the NDA to join.");
    const j = await act(testId, "join", t.cookie, { listingVersion: v, ndaAccepted: true });
    expect(j.status).toBe(200);
    const c = await db.contract.findUniqueOrThrow({ where: { id: j.body.sessionId } });
    expect(c.ndaText).toBe("Keep it secret.");
    expect(c.ndaAcceptedAt).not.toBeNull();
    expect((await edit(testId, dev.cookie, { ndaText: "Keep it very secret." })).status).toBe(200);
    const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: c.id, status: "open" } });
    expect(offer).toMatchObject({ ndaText: "Keep it very secret.", fromNdaText: "Keep it secret.", diff: "NDA changed" });
    // Still on the old NDA until they switch.
    expect((await db.contract.findUniqueOrThrow({ where: { id: c.id } })).ndaText).toBe("Keep it secret.");
    expect((await sact(c.id, "terms", t.cookie, { offerId: offer.id, choice: "switch", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await db.contract.findUniqueOrThrow({ where: { id: c.id } })).ndaText).toBe("Keep it very secret.");
  });

  it("shortening the deadline is ignored for working testers (no offer)", async () => {
    const { dev, testId } = await setup({ deadlineDays: 10 });
    await joined(testId);
    await edit(testId, dev.cookie, { deadlineDays: 4 });
    expect(await db.termsOffer.count({ where: { testId } })).toBe(0);
  });

  it("the live view returns the listing and key boxes to the Edit tab", async () => {
    const { dev, testId } = await setup({ accessKeys: undefined });
    const r = await json(await testGET(req(`/api/tests/${testId}/listing`, { cookie: dev.cookie, method: "GET" }), { params: Promise.resolve({ id: testId, action: "listing" }) }));
    expect(r.status).toBe(200);
    expect(r.body.listing.productName).toBe("Harbor Run");
    expect(r.body.keys.free).toEqual([]);
  });
});

describe("Access keys (design doc 5)", () => {
  async function withKeys(keys: string[], spots = 2) {
    const dev = await makeUser({ dev: true, name: "Nora Lane", pronoun: "she" });
    const r = await post(dev.cookie, { spots, accessKeys: keys.join("\n") });
    expect(r.status).toBe(200);
    return { dev, testId: r.body.id as string };
  }

  it("each joining tester gets the next free key; with none free, joining is refused", async () => {
    const { testId } = await withKeys(["K1", "K2"], 2);
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Cole");
    const keyOf = async (cid: string) => (await db.accessKey.findFirstOrThrow({ where: { contractId: cid } })).value;
    expect(await keyOf(a.sessionId)).toBe("K1");
    expect(await keyOf(b.sessionId)).toBe("K2");
  });

  it("a reported key is greyed in In use and is NOT replaced automatically; the developer assigns a free key by hand, only from the extras", async () => {
    const { dev, testId } = await withKeys(["K1", "K2", "K3"], 2);
    const a = await joined(testId, "Ana Silva");
    const r = await sact(a.sessionId, "key-broken", a.tester.cookie, { seenAt: seen() });
    expect(r.status).toBe(200);
    expect(r.body.replaced).toBe(false);
    expect((await db.accessKey.findFirstOrThrow({ where: { value: "K1", testId } })).status).toBe("broken");
    // Still broken: a free key is not handed out by itself.
    expect(await db.accessKey.count({ where: { testId, status: "free" } })).toBe(2);
    // 1 open spot + 2 free keys: one extra, so the developer can assign.
    expect((await act(testId, "assign-key", dev.cookie, { contractId: a.sessionId, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await db.accessKey.findFirstOrThrow({ where: { value: "K1", testId } })).status).toBe("retired");
    expect((await db.accessKey.findFirstOrThrow({ where: { contractId: a.sessionId, status: "inuse" } })).value).toBe("K2");
    expect(await db.notification.count({ where: { userId: a.tester.user.id, text: { contains: "new access key" } } })).toBe(1);
  });

  it("no extra key: assigning is refused (blue) until more keys are added", async () => {
    const { dev, testId } = await withKeys(["K1", "K2"], 2);
    const a = await joined(testId, "Ana Silva");
    await sact(a.sessionId, "key-broken", a.tester.cookie, { seenAt: seen() });
    const r = await act(testId, "assign-key", dev.cookie, { contractId: a.sessionId, seenAt: seen(), confirmed: true });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/Every free key is kept for the 1 open spot/);
    expect((await edit(testId, dev.cookie, {}, { keysAdd: ["K3"] })).status).toBe(200);
    expect((await act(testId, "assign-key", dev.cookie, { contractId: a.sessionId, seenAt: seen(), confirmed: true })).status).toBe(200);
  });

  it("Free keys can't drop below the open spots; used, left and broken keys can't be added again", async () => {
    const { dev, testId } = await withKeys(["K1", "K2", "K3"], 3);
    const a = await joined(testId, "Ana Silva");
    expect((await edit(testId, dev.cookie, {}, { keysRemove: ["K3"] })).body.error.message).toBe("Add 1 more key: 2 open spots, 1 free key.");
    expect((await edit(testId, dev.cookie, {}, { keysAdd: ["K1"] })).body.error.errors[0]).toMatch(/already in use/);
    // Leaving keeps the key held for them: never free, never addable.
    await sact(a.sessionId, "leave", a.tester.cookie, { seenAt: seen(), confirmed: true });
    expect((await edit(testId, dev.cookie, {}, { keysAdd: ["K1"] })).body.error.errors[0]).toMatch(/can't be added again|already in use|given to a tester who left/);
    // They get it back on returning (it was never reported).
    await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [a.tester.user.id], confirmed: true });
    await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [a.tester.user.id], confirmed: true });
    const back = await act(testId, "join", a.tester.cookie, { listingVersion: (await db.test.findUniqueOrThrow({ where: { id: testId } })).listingVersion });
    expect(back.status).toBe(200);
    expect((await db.accessKey.findFirstOrThrow({ where: { contractId: a.sessionId, status: "inuse" } })).value).toBe("K1");
  });
});
