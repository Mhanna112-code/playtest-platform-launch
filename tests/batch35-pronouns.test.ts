import React, { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as signupPOST } from "@/app/api/auth/signup/route";
import { POST as googleFinishPOST } from "@/app/api/auth/google/finish/route";
import { POST as profilePOST } from "@/app/api/profile/route";
import ProfilePage from "@/app/app/profile/page";
import SignupPage from "@/app/signup/page";
import { BioBox } from "@/components/BioBox";
import { blockedTestsLine } from "@/components/ProfileUnavailable";
import { pronouns, PRONOUN_OPTIONS } from "@/lib/format";
import { LIMITS } from "@/lib/limits";
import { callClosedLineOf, deletedNoPayoutsLine, finishedAndRatedLine, inviteTesterRefusal, joinCallRefusal, ratedYouLiveLine, ratePendingLine } from "@/lib/rules";
import { testerPaymentStatus } from "@/lib/testerPaymentStatus";
import { ratingChangedLine } from "@/lib/testerState";
import { devDeletedClosedLine } from "@/lib/server/excerpts";
import { GOOGLE_SIGNUP_COOKIE, startGoogleSignup } from "@/lib/server/google";
import { unreviewedLine } from "@/lib/server/holds";
import { sameTesterLimitLine, whyApplied, whyInvited, WHY_INVITED } from "@/lib/server/invites";
import { BIO_TOO_LONG, NAME_MISSING, PRONOUN_BAD, ROLE_MISSING, TERMS_MISSING, readNewAccount } from "@/lib/server/passwords";
import { decideLockedLine, DECIDE_LOCKED } from "@/lib/server/payments";
import { testV } from "@/lib/server/pulseV";
import { devRateLabel, requestGoneLine } from "@/lib/server/requests";
import { FINISHED_PART_REASON } from "@/lib/server/testerGate";
import { AGE_LINE } from "@/lib/termsOfUse";
import { json, makeUser, req, uniq } from "./helpers";
import { joined, setup } from "./fixtures";

// Batch 35 §162 (owner, Nov 3): the pronoun and the chosen side's bio at sign-up (developer or tester; "both" is gone), on the email form and on Google's step,
// shown on the profile afterwards; and every line about a person in that person's recorded pronoun (she/her/her, he/him/his, they/them/their), verbs agreeing.

const page = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => page.user, requireOpenPage: async () => page.user, adminAway: () => {}, getPageUser: async () => null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/profile", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), redirect: (to: string) => { throw Error(`redirect:${to}`); }, notFound: () => { throw Error("not found"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

async function serverTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(React.Children.toArray(node).map(serverTree));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (typeof element.type === "function" && element.type.constructor.name === "AsyncFunction") {
    const resolved = await (element.type as (props: unknown) => Promise<ReactNode>)(element.props);
    return serverTree(isValidElement(resolved) && element.key !== null ? cloneElement(resolved, { key: element.key }) : resolved);
  }
  return element.props.children === undefined ? element : cloneElement(element, {}, await serverTree(element.props.children));
}
const html = async (node: ReactNode | Promise<ReactNode>) => renderToStaticMarkup(await serverTree(await node));
const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", "src", p), "utf8");
const mail = () => `b35-162-${uniq()}@test.playtest.test`;
const TICKS = { acceptTerms: "yes", over18: "yes" };
const signup = (body: Record<string, unknown>) => signupPOST(req("/api/auth/signup", { body: { password: "harbor-run-1", ...body } })).then(json);
const finish = (token: string, body: Record<string, unknown>) => googleFinishPOST(req("/api/auth/google/finish", { body, headers: { cookie: `${GOOGLE_SIGNUP_COOKIE}=${token}` } })).then(json);
const profileOf = async (email: string) => {
  page.user = await db.user.findUniqueOrThrow({ where: { email } });
  return html(ProfilePage());
};
/** The profile's Pronoun choice as rendered: the option selected. */
const selectedPronoun = (markup: string) => markup.match(/<select id="pronoun"[^>]*>([\s\S]*?)<\/select>/)?.[1].match(/<option value="(\w*)" selected="">/)?.[1] ?? "";
const matches = (markup: string, id: string, line: string) => {
  const m = markup.match(new RegExp(`id="${id}"[^>]*data-match="([^"]+)"`)) ?? markup.match(new RegExp(`data-match="([^"]+)"[^>]*id="${id}"`));
  return !!m && new RegExp(m[1], "i").test(line);
};
const BIO_DEV = "A two-person studio making co-op puzzle games.";
const BIO_TESTER = "QA for 5 years; I play a lot of roguelikes.";

describe("batch 35 §162: pronoun and bio at sign-up", () => {
  it("email sign-up, developer: the pronoun is the account's, the bio is the developer's (User.devBio); the profile shows both, nothing asked twice", async () => {
    const email = mail();
    const r = await signup({ email, role: "developer", name: "Nora Lane", pronoun: "she", bio: `  ${BIO_DEV}  `, ...TICKS });
    expect(r.status).toBe(200);
    const u = await db.user.findUniqueOrThrow({ where: { email }, include: { profile: true } });
    expect(u).toMatchObject({ pronoun: "she", devBio: BIO_DEV, isDeveloper: true, isTester: false, side: "developer" });
    expect(u.profile).toBeNull();
    const prof = await profileOf(email);
    expect(selectedPronoun(prof)).toBe("she");
    expect(prof).toContain("Bio (shown to testers)");
    expect(prof).toContain(BIO_DEV);
  });

  it("email sign-up, tester: the bio is the tester's (TesterProfile.bio), with the devices and languages; the profile shows them", async () => {
    const email = mail();
    expect((await signup({ email, role: "tester", devices: ["Mac"], languages: ["English"], name: "Ben Ward", pronoun: "he", bio: BIO_TESTER, ...TICKS })).status).toBe(200);
    const u = await db.user.findUniqueOrThrow({ where: { email }, include: { profile: true } });
    expect(u).toMatchObject({ pronoun: "he", devBio: "", isTester: true, isDeveloper: false });
    expect(u.profile).toMatchObject({ bio: BIO_TESTER, devices: ["Mac"], languages: ["English"] });
    const prof = await profileOf(email);
    expect(selectedPronoun(prof)).toBe("he");
    expect(prof).toContain("Bio (shown to developers)");
    expect(prof).toContain(BIO_TESTER);
  });

  it("both are optional: unset reads they (Not set on the profile), the bio empty; \"they\" can be chosen too", async () => {
    const a = mail(), b = mail();
    expect((await signup({ email: a, role: "developer", name: "Pat Reyes", ...TICKS })).status).toBe(200);
    expect(await db.user.findUniqueOrThrow({ where: { email: a } })).toMatchObject({ pronoun: "", devBio: "" });
    expect(selectedPronoun(await profileOf(a))).toBe("");
    expect((await signup({ email: b, role: "tester", devices: ["Linux"], languages: ["German"], name: "Sam Kerr", pronoun: "they", ...TICKS })).status).toBe(200);
    expect(await db.user.findUniqueOrThrow({ where: { email: b }, include: { profile: true } })).toMatchObject({ pronoun: "they", profile: { bio: "" } });
  });

  it("Google's step takes the same pronoun and bio, for each type", async () => {
    const dev = mail(), tester = mail();
    expect((await finish(await startGoogleSignup(dev), { role: "developer", name: "Nora Lane", pronoun: "she", bio: BIO_DEV, ...TICKS })).status).toBe(200);
    expect(await db.user.findUniqueOrThrow({ where: { email: dev } })).toMatchObject({ pronoun: "she", devBio: BIO_DEV, emailVerifiedAt: expect.any(Date) });
    expect((await finish(await startGoogleSignup(tester), { role: "tester", devices: ["iPhone"], languages: ["Spanish"], name: "Ben Ward", pronoun: "he", bio: BIO_TESTER, ...TICKS })).status).toBe(200);
    expect(await db.user.findUniqueOrThrow({ where: { email: tester }, include: { profile: true } })).toMatchObject({ pronoun: "he", devBio: "", profile: { bio: BIO_TESTER } });
    const prof = await profileOf(tester);
    expect(selectedPronoun(prof)).toBe("he");
    expect(prof).toContain(BIO_TESTER);
    // (§162) Google's "both" from an older page: the same refusal as the email form, nothing made.
    const old = mail();
    expect((await finish(await startGoogleSignup(old), { role: "both", devices: ["Mac"], languages: ["English"], name: "Old Page", ...TICKS })).body.error).toMatchObject({ code: "bad_field", message: ROLE_MISSING });
    expect(await db.user.count({ where: { email: old } })).toBe(0);
  });

  it("mistakes are red at their field, all at once in the form's order: an unknown pronoun and a bio over 2,000 (only from an older page; the box stops at 2,000)", async () => {
    expect(PRONOUN_BAD).toBe("Choose a pronoun from the list.");
    expect(BIO_TOO_LONG).toBe("Keep your bio to 2,000 characters or fewer.");
    const email = mail();
    const long = "x".repeat(LIMITS.bio + 1);
    expect((await signup({ email, role: "developer", name: "Nora", pronoun: "xe", ...TICKS })).body.error).toMatchObject({ code: "bad_field", message: PRONOUN_BAD });
    expect((await signup({ email, role: "tester", devices: ["Mac"], languages: ["English"], name: "Nora", bio: long, ...TICKS })).body.error.message).toBe(BIO_TOO_LONG);
    expect((await signup({ email, role: "developer", pronoun: "xe", bio: long })).body.error.message).toBe([NAME_MISSING, PRONOUN_BAD, BIO_TOO_LONG, TERMS_MISSING, AGE_LINE].join("\n"));
    expect(await db.user.count({ where: { email } })).toBe(0);
    // Exactly 2,000 is fine.
    expect(readNewAccount({ role: "developer", name: "Nora", bio: "y".repeat(LIMITS.bio), ...TICKS }).bio).toHaveLength(LIMITS.bio);
    // The page: Pronoun with the profile's own choices, red for its line; the bio box (shown once a side is chosen) red for its line, with the profile's count.
    const form = await html(SignupPage());
    expect(form).toContain('<label class="label" for="pronoun">Pronoun</label>');
    for (const [value, label] of PRONOUN_OPTIONS) expect(form).toContain(`<option value="${value}"${value === "" ? ' selected=""' : ""}>${label}</option>`);
    expect(matches(form, "pronoun", PRONOUN_BAD)).toBe(true);
    expect(matches(form, "pronoun", NAME_MISSING)).toBe(false);
    expect(form.indexOf('id="name"')).toBeLessThan(form.indexOf('id="pronoun"'));
    const box = renderToStaticMarkup(React.createElement(BioBox, { shownTo: "testers", name: "bio", value: "Hello world!", onChange: () => {}, placeholder: "" }));
    expect(box).toContain("Bio (shown to testers)");
    expect(box).toContain(`maxLength="${LIMITS.bio}"`);
    expect(box).toContain("12 / 2,000");
    expect(matches(box, "bio", BIO_TOO_LONG)).toBe(true);
  });

  it("the form: Developer or Tester only; the bio box follows the choice live, each with its own label; the profile uses the same box and choices", () => {
    const role = src("components/RoleChoice.tsx");
    expect(role).not.toContain('value="both"');
    expect(role).toContain('data-match="developer or tester"');
    expect(new RegExp("developer or tester", "i").test(ROLE_MISSING)).toBe(true);
    expect(role).toContain("{role && (");
    expect(role).toContain('shownTo={role === "developer" ? "testers" : "developers"}');
    expect(role).toContain('name="pronoun"');
    expect(role).toContain("PRONOUN_OPTIONS.map");
    const profile = src("app/app/profile/ProfileForm.tsx");
    expect(profile).toContain("PRONOUN_OPTIONS.map");
    expect(profile).toContain("<BioBox ");
    for (const f of ["app/signup/page.tsx", "app/signup/google/page.tsx"]) expect(src(f)).toContain("<RoleChoice>");
  });
});

describe("batch 35 §162: lines about a person use their recorded pronoun (she / he / they), verbs agreeing", () => {
  it("pronouns(): the three sets, unset reads they, and the verbs that agree", () => {
    expect(pronouns("she")).toMatchObject({ subj: "she", obj: "her", poss: "her", Subj: "She", Poss: "Her", is: "is", has: "has", was: "was", subjIs: "she's", subjHas: "she's", subjHad: "she'd" });
    expect(pronouns("he")).toMatchObject({ subj: "he", obj: "him", poss: "his", Subj: "He", Poss: "His", is: "is", has: "has", subjIs: "he's" });
    for (const p of ["they", "", null, undefined, "xe"]) expect(pronouns(p)).toMatchObject({ subj: "they", obj: "them", poss: "their", Subj: "They", is: "are", has: "have", was: "were", subjIs: "they're", subjHas: "they've", subjHad: "they'd" });
    expect(pronouns("she").v("asks", "ask")).toBe("asks");
    expect(pronouns("they").v("asks", "ask")).toBe("ask");
  });

  it("live and stop box lines", () => {
    expect(ratedYouLiveLine("Ana", "Nov 12, 2026", "she")).toBe("Ana rated you. You can rate her until Nov 12, 2026.");
    expect(ratedYouLiveLine("Ben", null, "he")).toBe("Ben rated you. You can rate him once everything he sent is settled.");
    expect(ratedYouLiveLine("Sam", null, "")).toBe("Sam rated you. You can rate them once everything they sent is settled.");
    expect(finishedAndRatedLine("Ana", "she")).toBe("Ana finished her part (rated you)");
    expect(finishedAndRatedLine("Ben", "he")).toBe("Ben finished his part (rated you)");
    // Verb agreement where the pronoun is the subject.
    expect(ratePendingLine("Ana", "she")).toBe("You can rate Ana once she's rated you and everything she sent is settled.");
    expect(ratePendingLine("Sam")).toBe("You can rate Sam once they've rated you and everything they sent is settled.");
    expect(callClosedLineOf("left", "developer", "", "she")).toBe("She left the test.");
    expect(callClosedLineOf("ended", "developer", "", "he")).toBe("His session ended.");
    expect(callClosedLineOf("left", "developer")).toBe("They left the test.");
    expect(callClosedLineOf("left", "tester", "", "she")).toBe("You left this test."); // the owner of the page reads "you"
    const call = { status: "booked", startsAt: new Date(Date.now() + 3_600_000), minutes: 30, noShow: false, paused: false, testStatus: "open", contractStatus: "left", blocked: false };
    expect(joinCallRefusal({ ...call, side: "developer", testerPronoun: "he" }, new Date(), String)).toBe("He left the test.");
    expect(joinCallRefusal({ ...call, side: "tester", testerPronoun: "he" }, new Date(), String)).toBe("You left this test.");
    // (Owner, Nov 6, §304) The key report's lines ("… reported his key doesn't work", "She can send you another key") are gone with the report.
  });

  it("Needs you, invite and request rows", () => {
    expect(inviteTesterRefusal("Ana", { suspended: false, blocked: false, deleted: true, activeTests: 0, pronoun: "she" })).toBe("Ana's account was closed, so she can't be invited.");
    expect(whyInvited("he")).toBe("already invited, waiting for him to join");
    expect(WHY_INVITED).toBe("already invited, waiting for them to join");
    expect(whyApplied("rejoin", "she")).toBe("asked to rejoin: answer her in Needs you →");
    expect(sameTesterLimitLine("Ben", "he")).toBe("Ben: you've invited him to this test 3 times today. You can invite him again tomorrow.");
    expect(requestGoneLine({ status: "closed", closedReason: FINISHED_PART_REASON }, "she")).toBe("Closed: the tester finished her part");
    expect(requestGoneLine({ status: "closed", closedReason: FINISHED_PART_REASON })).toBe("Closed: the tester finished their part");
    expect(devRateLabel(3000, 3000, 2400, "he")).toBe("His terms: $30/h (the listing is now $24/h)");
    expect(ratingChangedLine("Ana", null, 4.5, "she")).toBe("Ana got her first rating: 4.5");
    expect(blockedTestsLine("Nora", "she")).toBe("You blocked Nora, so her tests are hidden.");
  });

  it("bell, email and payment lines, with verb agreement", () => {
    const d = new Date("2026-11-01T12:00:00Z");
    expect(unreviewedLine("Harbor Run", "Ana", "written answers", d, undefined, "she")).toMatch(/Ana can now charge or let it go\. You can still pay until she does\.$/);
    expect(unreviewedLine("Harbor Run", "Sam", "recording", d, undefined, "")).toMatch(/You can still pay until they do\.$/);
    expect(deletedNoPayoutsLine("Ben", "he")).toBe("Ben deleted his account before setting up payouts, so this can't be paid.");
    expect(devDeletedClosedLine("Harbor Run", "she")).toBe("Harbor Run's developer deleted her account, so this request was closed");
    expect(decideLockedLine("he")).toBe("The developer is confirming a payment for this piece with his bank. Decide again once it's confirmed or fails.");
    expect(DECIDE_LOCKED).toBe(decideLockedLine(""));
    expect(testerPaymentStatus({ developerDeleted: "Nora Lane", developerPronoun: "she" }).text).toBe("Can't be paid: Nora Lane deleted her account");
  });

  it("in the app: a pronoun change redraws the open test and session pages", async () => {
    const { dev, testId } = await setup({ spots: 3, accessKeys: "K1\nK2\nK3" }); // the developer is "she" (fixtures)
    const ben = await joined(testId, "Ben Ward", "he");
    const v1 = await testV(dev.user.id, testId), s1 = await testV(ben.tester.user.id, testId, ben.sessionId);
    await db.user.update({ where: { id: ben.tester.user.id }, data: { pronoun: "they" } });
    expect(await testV(dev.user.id, testId)).not.toBe(v1);
    await db.user.update({ where: { id: dev.user.id }, data: { pronoun: "he" } });
    expect(await testV(ben.tester.user.id, testId, ben.sessionId)).not.toBe(s1);
    await db.user.update({ where: { id: ben.tester.user.id }, data: { pronoun: "he" } });
    await db.user.update({ where: { id: dev.user.id }, data: { pronoun: "she" } });
    // (Owner, Nov 6, §304) No key report any more, so no "reported his key doesn't work" line to check here.
    // The profile Save keeps a pronoun changed later (the account's, both sides).
    const nora = await makeUser({ dev: true, name: "Nora Lane", pronoun: "she" });
    expect((await json(await profilePOST(req("/api/profile", { cookie: nora.cookie, body: { name: "Nora Lane", pronoun: "he", isDeveloper: true, isTester: false, side: "developer", bio: "" } })))).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: nora.user.id } })).pronoun).toBe("he");
  });
});
