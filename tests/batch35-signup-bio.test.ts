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
import { POST as sidePOST } from "@/app/api/account/side/route";
import AppHome from "@/app/app/page";
import ProfilePage from "@/app/app/profile/page";
import { ProfileForm } from "@/app/app/profile/ProfileForm";
import DeveloperProfilePage from "@/app/app/developers/[id]/page";
import TesterProfilePage from "@/app/app/testers/[id]/page";
import SignupPage from "@/app/signup/page";
import GoogleSignupStep from "@/app/signup/google/page";
import { GOOGLE_SIGNUP_COOKIE, startGoogleSignup } from "@/lib/server/google";
import { NAME_MISSING, ROLE_MISSING, TERMS_MISSING, signUp } from "@/lib/server/passwords";
import { deleteAccount } from "@/lib/server/restrictions";
import { publicProfileV } from "@/lib/server/pageFreshness";
import { PROFILE_FIRST } from "@/lib/server/tests";
import { SESSION_COOKIE } from "@/lib/server/session";
import { LIMITS } from "@/lib/limits";
import { AGE_LINE } from "@/lib/termsOfUse";
import { json, makeUser, req, uniq } from "./helpers";
import { act, settle, setup } from "./fixtures";

// Batch 35 §134 (owner, Nov 3): who you are is required when the account is made (email and Google), so the "Welcome to Playtest" step is gone for normal
// accounts; each side has its own bio (optional, up to 2,000 characters); a side opened later shows the shared name and pronoun with its own fields empty.

const page = vi.hoisted(() => ({ user: null as User | null, signupCookie: "" }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => page.user, requireOpenPage: async () => page.user, adminAway: () => {}, getPageUser: async () => null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: (k: string) => (k === "pt_google_signup" && page.signupCookie ? { value: page.signupCookie } : undefined) }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), redirect: (to: string) => { throw Error(`redirect:${to}`); }, notFound: () => { throw Error("not found"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

/** Renders a server page: async components are resolved first (renderToStaticMarkup can't). */
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
const fresh = (id: string) => db.user.findUniqueOrThrow({ where: { id } });
async function as(id: string) {
  page.user = await fresh(id);
  return page.user;
}
const dashboard = async (id: string) => (await as(id), html(AppHome({ searchParams: Promise.resolve({}) })));
const profile = async (id: string) => (await as(id), html(ProfilePage()));
const developerPage = async (viewerId: string, id: string) => (await as(viewerId), html(DeveloperProfilePage({ params: Promise.resolve({ id }) })));
const testerPage = async (viewerId: string, id: string) => (await as(viewerId), html(TesterProfilePage({ params: Promise.resolve({ id }) })));
const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const mail = () => `b35-134-${uniq()}@test.playtest.test`;
const cookieOf = (token: string) => `${SESSION_COOKIE}=${token}`;
const signup = (body: Record<string, unknown>) => signupPOST(req("/api/auth/signup", { body: { password: "harbor-run-1", ...body } })).then(json);
const finish = (token: string, body: Record<string, unknown>) => googleFinishPOST(req("/api/auth/google/finish", { body, headers: { cookie: `${GOOGLE_SIGNUP_COOKIE}=${token}` } }));
const save = (cookie: string, body: Record<string, unknown>) => profilePOST(req("/api/profile", { cookie, body })).then(json);
/** The red-at-the-field match (FieldChecks' markServerMistakes): a box's data-match, as a case-insensitive pattern, against the server's line. */
const matches = (markup: string, id: string, line: string) => {
  const m = markup.match(new RegExp(`id="${id}"[^>]*data-match="([^"]+)"`)) ?? markup.match(new RegExp(`data-match="([^"]+)"[^>]*id="${id}"`));
  return !!m && new RegExp(m[1], "i").test(line);
};
const ALL_MISSING = [ROLE_MISSING, NAME_MISSING, TERMS_MISSING, AGE_LINE].join("\n");
/** The sign-up's role choices, in order: each a required radio named "role". */
const roleRadios = (markup: string) =>
  [...markup.matchAll(/<input type="radio"[^>]*>/g)].map(([r]) => (r.includes('name="role"') && r.includes('required=""') ? r.match(/value="(\w+)"/)?.[1] : "not a required role choice"));

describe("batch 35 §134: who you are is required when the account is made", () => {
  it("email sign-up without developer or tester is refused, red at the choice, with every other missing part at once; nothing is made", async () => {
    // (§162) Developer or Tester only: an older page's "both" reads the same line.
    expect(ROLE_MISSING).toBe("Choose developer or tester.");
    const email = mail();
    const no = await signup({ email, name: "Ana Silva", acceptTerms: "yes", over18: "yes" });
    expect(no).toMatchObject({ status: 400, body: { error: { code: "bad_field", message: ROLE_MISSING } } });
    expect((await signup({ email, role: "nobody", name: "Ana Silva", acceptTerms: "yes", over18: "yes" })).body.error.message).toBe(ROLE_MISSING);
    expect((await signup({ email, role: "both", devices: ["Mac"], languages: ["English"], name: "Ana Silva", acceptTerms: "yes", over18: "yes" })).body.error.message).toBe(ROLE_MISSING);
    expect((await signup({ email })).body.error.message).toBe(ALL_MISSING);
    expect(await db.user.count({ where: { email } })).toBe(0);
    // The page: the two choices (each required), red at the choice for the server's line; the other boxes keep their own lines.
    const form = await html(SignupPage());
    expect(roleRadios(form)).toEqual(["developer", "tester"]);
    expect(form).not.toContain('value="both"');
    expect(form).toContain('data-field-group=""');
    expect(matches(form, "role", ROLE_MISSING)).toBe(true);
    expect(matches(form, "name", NAME_MISSING)).toBe(true);
    expect(matches(form, "role", NAME_MISSING)).toBe(false);
    expect(matches(form, "acceptTerms", TERMS_MISSING)).toBe(true);
    expect(matches(form, "over18", AGE_LINE)).toBe(true);
  });

  it("each role makes its side; (§162) both is refused; (§153) a tester's profile is saved at sign-up, the gate holds for one never saved", async () => {
    const dev = await signUp({ email: mail(), password: "harbor-run-1", role: "developer", name: "Dee Moss", acceptTerms: "yes", over18: "yes" }, "http://localhost:3400");
    expect(dev.user).toMatchObject({ isDeveloper: true, isTester: false, side: "developer", name: "Dee Moss" });
    expect(await db.testerProfile.count({ where: { userId: dev.user.id } })).toBe(0);
    const home = await dashboard(dev.user.id);
    expect(home).not.toContain("Welcome to Playtest");
    expect(home).toContain("Add a card (needed to post a test)");
    const tester = await signUp({ email: mail(), password: "harbor-run-1", role: "tester", devices: ["Mac"], languages: ["French"], name: "Tia Park", acceptTerms: "yes", over18: "yes" }, "http://localhost:3400");
    expect(tester.user).toMatchObject({ isDeveloper: false, isTester: true, side: "tester" });
    expect(await db.testerProfile.findUnique({ where: { userId: tester.user.id } })).toMatchObject({ devices: ["Mac"], languages: ["French"], bio: "" });
    const testerHome = await dashboard(tester.user.id);
    expect(testerHome).not.toContain("Save your profile (needed to join a test)");
    expect(testerHome).toContain("Set up payouts (to receive your pay)");
    await expect(signUp({ email: mail(), password: "harbor-run-1", role: "both", devices: ["Windows PC"], languages: ["English"], name: "Nora Lane", acceptTerms: "yes", over18: "yes" }, "http://localhost:3400")).rejects.toMatchObject({ code: "bad_field", message: ROLE_MISSING });
    await db.user.update({ where: { id: tester.user.id }, data: { emailVerifiedAt: new Date() } });
    const { testId } = await setup();
    const test = await db.test.findUniqueOrThrow({ where: { id: testId } });
    // The tester side's gate still holds for a profile that was never saved (an older account): see §153's tests.
    await db.testerProfile.update({ where: { userId: tester.user.id }, data: { devices: [], languages: [] } });
    expect(await dashboard(tester.user.id)).toContain("Save your profile (needed to join a test)");
    expect(await act(testId, "join", cookieOf(tester.token), { listingVersion: test.listingVersion })).toMatchObject({ status: 409, body: { error: { code: "profile_first", message: PROFILE_FIRST } } });
  });

  it("Google's step asks the same (who you are and a name, required, red at each); then the account is made with its side; both is refused", async () => {
    const email = mail();
    const token = await startGoogleSignup(email);
    const no = await json(await finish(token, { name: "Ana Silva", acceptTerms: "yes", over18: "yes" }));
    expect(no).toMatchObject({ status: 400, body: { error: { code: "bad_field", message: ROLE_MISSING } } });
    expect((await json(await finish(token, { role: "both", devices: ["Mac"], languages: ["English"], name: "Ana Silva", acceptTerms: "yes", over18: "yes" }))).body.error.message).toBe(ROLE_MISSING);
    expect((await json(await finish(token, { role: "tester", devices: ["Mac"], languages: ["English"], acceptTerms: "yes", over18: "yes" }))).body.error.message).toBe(NAME_MISSING);
    expect((await json(await finish(token, {}))).body.error.message).toBe(ALL_MISSING);
    expect(await db.user.count({ where: { email } })).toBe(0);
    // The step is still waiting: the page shows the choice and the Name box, each red at its own line.
    page.signupCookie = token;
    const step = await html(GoogleSignupStep());
    page.signupCookie = "";
    expect(step).toContain(`Signing up with Google as <b class="text-white">${email}</b>.`);
    expect(roleRadios(step)).toEqual(["developer", "tester"]);
    expect(matches(step, "role", ROLE_MISSING)).toBe(true);
    expect(matches(step, "name", NAME_MISSING)).toBe(true);
    expect(step.indexOf('name="role"')).toBeLessThan(step.indexOf('id="acceptTerms"'));
    // Continue with everything: made with the tester side.
    const ok = await finish(token, { role: "tester", devices: ["Mac"], languages: ["English"], name: "Ana Silva", acceptTerms: "yes", over18: "yes" });
    expect(ok.status).toBe(200);
    const u = await db.user.findUniqueOrThrow({ where: { email }, include: { profile: true } });
    expect(u).toMatchObject({ name: "Ana Silva", isDeveloper: false, isTester: true, side: "tester" });
    expect(u.emailVerifiedAt).not.toBeNull();
    expect(u.profile).toMatchObject({ devices: ["Mac"], languages: ["English"], bio: "" });
    expect(await dashboard(u.id)).not.toContain("Welcome to Playtest");
    // Developer only, the same way.
    const e = mail();
    expect((await finish(await startGoogleSignup(e), { role: "developer", name: "Pat Reyes", acceptTerms: "yes", over18: "yes" })).status).toBe(200);
    expect(await db.user.findUniqueOrThrow({ where: { email: e } })).toMatchObject({ isDeveloper: true, isTester: false, side: "developer", name: "Pat Reyes" });
  });

  it("an older account with no side: the dashboard sends it to Profile, where choosing a side is required; an admin keeps its Name-and-Pronoun setup", async () => {
    const old = await makeUser({ name: "Old Account" });
    await expect(dashboard(old.user.id)).rejects.toThrow("redirect:/app/profile");
    const form = await profile(old.user.id);
    expect(form).toContain("I&#x27;m here to");
    expect(form).toContain(">Continue</button>");
    expect(form).toContain('value="Old Account"');
    expect(form).not.toContain("Your ratings");
    expect((await save(old.cookie, { name: "Old Account" })).body.error.message).toBe("Choose developer, tester, or both.");
    expect((await save(old.cookie, { name: "Old Account", isDeveloper: true })).status).toBe(200);
    expect(await dashboard(old.user.id)).toContain("Add a card (needed to post a test)");
    // The admin's own setup stays on /app: Name and Pronoun, no sides.
    const admin = await makeUser({ name: "" });
    await db.user.update({ where: { id: admin.user.id }, data: { isAdmin: true } });
    const setupPage = await dashboard(admin.user.id);
    expect(setupPage).toContain("Welcome to Playtest");
    expect(setupPage).toContain('id="pronoun"');
    expect(setupPage).not.toContain("I&#x27;m here to");
    expect(setupPage).not.toContain('id="bio"');
  });
});

describe("batch 35 §134: each side has its own bio; the name and pronoun are the account's", () => {
  it("a developer adds the tester side: the name and pronoun are already there, the side's own fields and bio start empty; a pronoun changed there shows on the developer side; the two bios never copy each other", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane", pronoun: "she" });
    const base = { name: "Nora Lane", pronoun: "she", isDeveloper: true, isTester: false, devices: [], categories: [], languages: [] };
    expect((await save(dev.cookie, { ...base, side: "developer", bio: "We make co-op puzzle games." })).status).toBe(200);
    expect(await fresh(dev.user.id)).toMatchObject({ devBio: "We make co-op puzzle games." });
    const devForm = await profile(dev.user.id);
    expect(devForm).toContain("Bio (shown to testers)");
    expect(devForm).toContain(">We make co-op puzzle games.</textarea>");
    expect(devForm).not.toContain("Devices you use");
    // Start testing too (Account): one step, then the tester profile.
    expect((await json(await sidePOST(req("/api/account/side", { cookie: dev.cookie, body: { side: "tester", add: true } })))).status).toBe(200);
    expect(await fresh(dev.user.id)).toMatchObject({ isDeveloper: true, isTester: true, side: "tester" });
    expect(await db.testerProfile.findUnique({ where: { userId: dev.user.id } })).toMatchObject({ devices: [], languages: [], categories: [], bio: "" });
    const testerForm = await profile(dev.user.id);
    expect(testerForm).toContain("Your tester profile");
    expect(testerForm).toContain('value="Nora Lane"'); // the name, already there
    expect(testerForm).toContain('<option value="she" selected="">she / her</option>'); // the pronoun, already there
    expect(testerForm).toContain("Bio (shown to developers)");
    expect(testerForm).toMatch(/<textarea id="bio"[^>]*><\/textarea>/); // its own bio starts empty
    expect(testerForm).not.toContain("We make co-op puzzle games.");
    expect(testerForm).not.toContain("I&#x27;m here to"); // no second setup: the sides aren't asked again
    // The tester profile's Save: the pronoun is the account's (both sides), the bio only the tester's.
    const testerBody = { ...base, isTester: true, side: "tester", pronoun: "they", devices: ["Windows PC"], languages: ["English"], bio: "I test RPGs." };
    expect((await save(dev.cookie, testerBody)).status).toBe(200);
    expect(await fresh(dev.user.id)).toMatchObject({ pronoun: "they", devBio: "We make co-op puzzle games." });
    expect(await db.testerProfile.findUniqueOrThrow({ where: { userId: dev.user.id } })).toMatchObject({ bio: "I test RPGs.", devices: ["Windows PC"] });
    // Back on the developer side: the new pronoun, its own bio.
    await db.user.update({ where: { id: dev.user.id }, data: { side: "developer" } });
    const back = await profile(dev.user.id);
    expect(back).toContain("Your developer profile");
    expect(back).toContain('<option value="they" selected="">they / them</option>');
    expect(back).toContain(">We make co-op puzzle games.</textarea>");
    expect(back).not.toContain("I test RPGs.");
    // Editing the developer's bio leaves the tester's (and emptying it too).
    expect((await save(dev.cookie, { ...base, isTester: true, side: "developer", pronoun: "they", bio: "" })).status).toBe(200);
    expect((await fresh(dev.user.id)).devBio).toBe("");
    expect((await db.testerProfile.findUniqueOrThrow({ where: { userId: dev.user.id } })).bio).toBe("I test RPGs.");
  });

  it("a tester adds the developer side the same way: the name and pronoun shown, the developer's bio empty", async () => {
    const t = await makeUser({ tester: true, name: "Ana Silva", pronoun: "he" });
    await db.testerProfile.update({ where: { userId: t.user.id }, data: { bio: "Roguelikes on PC." } });
    expect((await json(await sidePOST(req("/api/account/side", { cookie: t.cookie, body: { side: "developer", add: true } })))).status).toBe(200);
    expect(await fresh(t.user.id)).toMatchObject({ isDeveloper: true, side: "developer", devBio: "" });
    const form = await profile(t.user.id);
    expect(form).toContain('value="Ana Silva"');
    expect(form).toContain('<option value="he" selected="">he / him</option>');
    expect(form).toContain("Bio (shown to testers)");
    expect(form).toMatch(/<textarea id="bio"[^>]*><\/textarea>/);
    expect(form).not.toContain("Roguelikes on PC.");
  });

  it("each bio is optional and up to 2,000 characters, with its count beside it (x / 2,000)", async () => {
    expect(LIMITS.bio).toBe(2000);
    const u = await makeUser({ dev: true, tester: true, name: "Lee Chan" });
    const base = { name: "Lee Chan", isDeveloper: true, isTester: true, devices: ["Windows PC"], categories: [], languages: ["English"] };
    expect((await save(u.cookie, { ...base, side: "developer", bio: "d".repeat(2500) })).status).toBe(200);
    expect((await save(u.cookie, { ...base, side: "tester", bio: "t".repeat(2500) })).status).toBe(200);
    expect((await fresh(u.user.id)).devBio).toBe("d".repeat(2000));
    expect((await db.testerProfile.findUniqueOrThrow({ where: { userId: u.user.id } })).bio).toBe("t".repeat(2000));
    // Optional: an empty bio saves.
    expect((await save(u.cookie, { ...base, side: "tester", bio: "" })).status).toBe(200);
    const init = { name: "Lee Chan", pronoun: "", isDeveloper: true, isTester: true, devices: ["Windows PC"], categories: [], languages: ["English"], bio: "x".repeat(1234) };
    for (const side of ["developer", "tester"] as const) {
      const form = renderToStaticMarkup(React.createElement(ProfileForm, { init, side, seenAt: new Date().toISOString() }));
      expect(form, side).toContain("1,234 / 2,000");
      expect(form, side).toMatch(/<textarea id="bio"[^>]*maxLength="2000"/i);
    }
    const f = src("src/app/app/profile/ProfileForm.tsx");
    // (Batch 35 §162) The profile's box is BioBox, the same as sign-up's.
    expect(f).toContain("<BioBox ");
    const box = src("src/components/BioBox.tsx");
    expect(box).toContain("maxLength={LIMITS.bio}");
    expect(box).toContain("<CharacterCount value={value} max={LIMITS.bio} />");
  });

  it("a developer-side Save of an account with both sides never needs (or changes) the tester's fields; the other side's changes don't stop it", async () => {
    const u = await makeUser({ dev: true, tester: true, name: "Sam Ortiz" });
    await db.testerProfile.update({ where: { userId: u.user.id }, data: { devices: [], languages: [], bio: "Tester words." } });
    const base = { name: "Sam Ortiz", pronoun: "", isDeveloper: true, isTester: true, devices: [], categories: [], languages: [] };
    // Before §134 this asked for "Pick at least one device you play on." (a field the developer form doesn't have).
    expect((await save(u.cookie, { ...base, side: "developer", bio: "Developer words." })).status).toBe(200);
    expect(await db.testerProfile.findUniqueOrThrow({ where: { userId: u.user.id } })).toMatchObject({ devices: [], bio: "Tester words." });
    // The tester side still needs its devices and languages.
    expect((await save(u.cookie, { ...base, side: "tester", bio: "x" })).body.error.message).toBe("Pick at least one device you play on.");
    // Changed in another tab (A) since pages B and C opened: the tester's fields don't stop the developer page's Save; the developer's own bio does (once).
    await settle();
    const seenAt = new Date().toISOString();
    await settle();
    expect((await save(u.cookie, { ...base, side: "tester", devices: ["Mac"], languages: ["English"], bio: "New tester words.", tab: "A" })).status).toBe(200);
    await settle();
    expect((await save(u.cookie, { ...base, side: "developer", bio: "Developer words.", seenAt, tab: "B" })).status).toBe(200);
    expect((await save(u.cookie, { ...base, side: "developer", bio: "Changed in A.", tab: "A" })).status).toBe(200);
    await settle();
    const stop = await save(u.cookie, { ...base, side: "developer", bio: "Typed in B.", seenAt, tab: "B" });
    expect(stop.status).toBe(409);
    expect(stop.body.error.changes.map((c: { text: string }) => c.text)).toEqual(["Bio: Developer words. → Changed in A."]);
    // The tester page (C) is stopped by its own bio only: never by the developer's.
    const c = await save(u.cookie, { ...base, side: "tester", devices: ["Mac"], languages: ["English"], bio: "Typed in C.", seenAt, tab: "C" });
    expect(c.status).toBe(409);
    expect(c.body.error.changes.map((x: { text: string }) => x.text)).toEqual(["Bio: Tester words. → New tester words."]);
  });

  it("profiles show only their side's bio (About); an open developer profile redraws when that bio changes; a developer with none reads No bio yet.", async () => {
    const both = await makeUser({ dev: true, tester: true, name: "Nora Lane" });
    await db.user.update({ where: { id: both.user.id }, data: { devBio: "Studio of two, making co-op puzzlers." } });
    await db.testerProfile.update({ where: { userId: both.user.id }, data: { bio: "I also test strategy games." } });
    const viewerTester = await makeUser({ tester: true, name: "Ana Silva" });
    const viewerDev = await makeUser({ dev: true, name: "Dee Moss" });
    const asDev = await developerPage(viewerTester.user.id, both.user.id);
    expect(asDev).toContain('data-developer-about=""');
    expect(asDev).toContain("Studio of two, making co-op puzzlers.");
    expect(asDev).not.toContain("I also test strategy games.");
    const asTester = await testerPage(viewerDev.user.id, both.user.id);
    expect(asTester).toContain("I also test strategy games.");
    expect(asTester).not.toContain("Studio of two, making co-op puzzlers.");
    // An admin's view of the profiles shows the same bios.
    const admin = await makeUser({ name: "Olive Admin" });
    await db.user.update({ where: { id: admin.user.id }, data: { isAdmin: true } });
    expect(await developerPage(admin.user.id, both.user.id)).toContain("Studio of two, making co-op puzzlers.");
    expect(await testerPage(admin.user.id, both.user.id)).toContain("I also test strategy games.");
    // Live: the open profile's fingerprint moves with the developer's bio.
    const v1 = await publicProfileV(await fresh(viewerTester.user.id), both.user.id);
    await db.user.update({ where: { id: both.user.id }, data: { devBio: "Now a studio of three." } });
    expect(await publicProfileV(await fresh(viewerTester.user.id), both.user.id)).not.toBe(v1);
    // No bio yet.
    const plain = await makeUser({ dev: true, name: "Bo Grant" });
    expect(await developerPage(viewerTester.user.id, plain.user.id)).toMatch(/data-developer-about=""[\s\S]*No bio yet\./);
    // Hover cards keep what they showed (ratings, devices, languages): no bio there.
    for (const f of ["src/lib/server/personHover.ts", "src/app/app/sessions/[id]/page.tsx"]) expect(src(f), f).not.toMatch(/devBio|\.bio\b/);
  });

  it("deleting an account clears both bios", async () => {
    const u = await makeUser({ dev: true, tester: true, name: "Gone Soon" });
    await db.user.update({ where: { id: u.user.id }, data: { devBio: "Dev bio." } });
    await db.testerProfile.update({ where: { userId: u.user.id }, data: { bio: "Tester bio." } });
    await deleteAccount(u.user.id, "self");
    expect(await fresh(u.user.id)).toMatchObject({ devBio: "" });
    expect((await db.testerProfile.findUniqueOrThrow({ where: { userId: u.user.id } })).bio).toBe("");
  });

  it("the migration adds the developer's bio empty for everyone and copies nothing; the tester's bio stays where it is", async () => {
    const sql = src("prisma/migrations/20261114090000_developer_bio/migration.sql");
    expect(sql).toContain(`ALTER TABLE "User" ADD COLUMN "devBio" TEXT NOT NULL DEFAULT '';`);
    expect(sql).not.toMatch(/\b(UPDATE|INSERT|DROP)\b/i);
    expect(sql).not.toMatch(/"TesterProfile"/);
    const cols = await db.$queryRaw<{ is_nullable: string; column_default: string | null }[]>`SELECT is_nullable, column_default FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'User' AND column_name = 'devBio'`;
    expect(cols).toHaveLength(1);
    expect(cols[0].is_nullable).toBe("NO");
    expect(cols[0].column_default).toMatch(/^''/);
    const bio = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'TesterProfile' AND column_name = 'bio'`;
    expect(bio[0].n).toBe(1);
    // An existing tester: their bio unchanged, their developer bio empty.
    const t = await makeUser({ tester: true, name: "Kept Bio" });
    await db.testerProfile.update({ where: { userId: t.user.id }, data: { bio: "Kept as it was." } });
    expect(await db.user.findUniqueOrThrow({ where: { id: t.user.id }, include: { profile: true } })).toMatchObject({ devBio: "", profile: { bio: "Kept as it was." } });
  });
});
