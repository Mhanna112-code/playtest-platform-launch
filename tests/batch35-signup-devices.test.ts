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
import { GOOGLE_SIGNUP_COOKIE, startGoogleSignup } from "@/lib/server/google";
import { NAME_MISSING, ROLE_MISSING, TERMS_MISSING, readNewAccount, signUp } from "@/lib/server/passwords";
import { PROFILE_FIRST, profileSaved } from "@/lib/server/tests";
import { SESSION_COOKIE } from "@/lib/server/session";
import { DEVICES_MISSING, LANGUAGES_MISSING } from "@/lib/options";
import { AGE_LINE } from "@/lib/termsOfUse";
import { json, makeUser, req, uniq } from "./helpers";
import { act, setup } from "./fixtures";

// Batch 35 §153 (owner, Nov 3): a tester (or both) ticks their devices and languages at sign-up, on the email form and on Google's step, so the tester profile is
// saved when the account is made, Join needs no visit to Profile, and the dashboard's Get started no longer lists "Save your profile". Accounts whose profile was
// never saved (older ones, a developer who adds the tester side) keep the step and the Join gate.

const page = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => page.user, requireOpenPage: async () => page.user, adminAway: () => {}, getPageUser: async () => null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), redirect: (to: string) => { throw Error(`redirect:${to}`); }, notFound: () => { throw Error("not found"); } }));
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
const dashboard = async (id: string) => {
  page.user = await db.user.findUniqueOrThrow({ where: { id } });
  return renderToStaticMarkup(await serverTree(await AppHome({ searchParams: Promise.resolve({}) })));
};
const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", "src", p), "utf8");
const mail = () => `b35-153-${uniq()}@playtest.test`;
const cookieOf = (token: string) => `${SESSION_COOKIE}=${token}`;
const signup = (body: Record<string, unknown>) => signupPOST(req("/api/auth/signup", { body: { password: "harbor-run-1", ...body } })).then(json);
const finish = (token: string, body: Record<string, unknown>) => googleFinishPOST(req("/api/auth/google/finish", { body, headers: { cookie: `${GOOGLE_SIGNUP_COOKIE}=${token}` } })).then(json);
const TICKS = { acceptTerms: "yes", over18: "yes" };
const PROFILE_STEP = "Save your profile (needed to join a test)";
const PAYOUTS_STEP = "Set up payouts (to receive your pay)";
async function joinAs(cookie: string, userId: string) {
  await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  const { testId } = await setup();
  const test = await db.test.findUniqueOrThrow({ where: { id: testId } });
  return act(testId, "join", cookie, { listingVersion: test.listingVersion });
}

describe("batch 35 §153: devices and languages at sign-up for testers", () => {
  it("tester: at least one device and one language are required, red at their own pickers with the profile's own lines, every missing part at once; nothing is made", async () => {
    expect(DEVICES_MISSING).toBe("Pick at least one device you play on.");
    expect(LANGUAGES_MISSING).toBe("Pick at least one language you can test in.");
    for (const role of ["tester"]) { // (§162) no "both" at sign-up any more
      const email = mail();
      const none = await signup({ email, role, name: "Ana Silva", ...TICKS });
      expect(none).toMatchObject({ status: 400, body: { error: { code: "bad_field", message: `${DEVICES_MISSING}\n${LANGUAGES_MISSING}` } } });
      // Continue pressed with nothing but the choice: every line, in the form's order.
      expect((await signup({ email, role, devices: [], languages: [] })).body.error.message).toBe([DEVICES_MISSING, LANGUAGES_MISSING, NAME_MISSING, TERMS_MISSING, AGE_LINE].join("\n"));
      expect((await signup({ email, role, devices: ["Mac"], name: "Ana Silva", ...TICKS })).body.error.message).toBe(LANGUAGES_MISSING);
      expect((await signup({ email, role, languages: ["English"], name: "Ana Silva", ...TICKS })).body.error.message).toBe(DEVICES_MISSING);
      // Unknown values never count (only the profile's own lists).
      expect((await signup({ email, role, devices: ["Toaster"], languages: "English", name: "Ana Silva", ...TICKS })).body.error.message).toBe(`${DEVICES_MISSING}\n${LANGUAGES_MISSING}`);
      expect(await db.user.count({ where: { email } })).toBe(0);
    }
    // No choice yet: the pickers aren't shown, so only the choice is asked for (as §134).
    expect(() => readNewAccount({})).toThrow([ROLE_MISSING, NAME_MISSING, TERMS_MISSING, AGE_LINE].join("\n"));
  });

  it("the ticks are saved into the tester profile when the account is made: saved at once, Join goes through without visiting Profile, Get started has no profile step", async () => {
    const r = await signUp({ email: mail(), password: "harbor-run-1", role: "tester", devices: ["iPhone", "Windows PC", "iPhone"], languages: ["Spanish", "English"], name: "Tia Park", ...TICKS }, "http://localhost:3400");
    const profile = await db.testerProfile.findUniqueOrThrow({ where: { userId: r.user.id } });
    expect(profile).toMatchObject({ devices: ["iPhone", "Windows PC"], languages: ["Spanish", "English"], categories: [], bio: "" });
    expect(profileSaved(profile)).toBe(true);
    const home = await dashboard(r.user.id);
    expect(home).toContain('data-get-started=""');
    expect(home).not.toContain(PROFILE_STEP);
    expect(home).toContain(PAYOUTS_STEP);
    expect((await joinAs(cookieOf(r.token), r.user.id)).status).toBe(200);
  });

  it("developer only: never asked, anything sent is ignored, no tester profile; their Get started is unchanged", async () => {
    const email = mail();
    expect((await signup({ email, role: "developer", name: "Dee Moss", ...TICKS })).status).toBe(200);
    const dev = await db.user.findUniqueOrThrow({ where: { email } });
    expect(dev).toMatchObject({ isDeveloper: true, isTester: false });
    expect(await db.testerProfile.count({ where: { userId: dev.id } })).toBe(0);
    expect(readNewAccount({ role: "developer", devices: ["Mac"], languages: ["English"], name: "Dee", ...TICKS })).toEqual({ role: "developer", name: "Dee", pronoun: "", bio: "", devices: [], languages: [] });
    const home = await dashboard(dev.id);
    expect(home).toContain("Add a card (needed to post a test)");
    expect(home).not.toContain(PROFILE_STEP);
  });

  it("Google's step asks the same: refused without them (red lines, nothing made), then made with the tester profile saved", async () => {
    const email = mail();
    const token = await startGoogleSignup(email);
    expect((await finish(token, { role: "tester", name: "Pat Reyes", ...TICKS })).body.error).toMatchObject({ code: "bad_field", message: `${DEVICES_MISSING}\n${LANGUAGES_MISSING}` });
    expect((await finish(token, { role: "tester" })).body.error.message).toBe([DEVICES_MISSING, LANGUAGES_MISSING, NAME_MISSING, TERMS_MISSING, AGE_LINE].join("\n"));
    expect(await db.user.count({ where: { email } })).toBe(0);
    const ok = await finish(token, { role: "tester", devices: ["Android phone"], languages: ["Portuguese"], name: "Pat Reyes", ...TICKS });
    expect(ok.status).toBe(200);
    const u = await db.user.findUniqueOrThrow({ where: { email }, include: { profile: true } });
    expect(u).toMatchObject({ isTester: true, isDeveloper: false, side: "tester" });
    expect(u.profile).toMatchObject({ devices: ["Android phone"], languages: ["Portuguese"] });
    expect(await dashboard(u.id)).not.toContain(PROFILE_STEP);
    // Developer only on Google's step: nothing asked.
    const e2 = mail();
    expect((await finish(await startGoogleSignup(e2), { role: "developer", name: "Dee Moss", ...TICKS })).status).toBe(200);
    expect(await db.testerProfile.count({ where: { user: { email: e2 } } })).toBe(0);
  });

  it("an account whose tester profile was never saved keeps the step and the Join gate, until it saves it on Profile", async () => {
    // An older tester (made before §153): an empty profile row.
    const old = await makeUser({ tester: true, name: "Old Tester" });
    await db.testerProfile.update({ where: { userId: old.user.id }, data: { devices: [], languages: [] } });
    const home = await dashboard(old.user.id);
    expect(home).toContain(PROFILE_STEP);
    expect(home).toContain(PAYOUTS_STEP);
    expect(await joinAs(old.cookie, old.user.id)).toMatchObject({ status: 409, body: { error: { code: "profile_first", message: PROFILE_FIRST } } });
    // Saved on Profile: the step goes (rather than showing ticked) and Join goes through.
    const saved = await json(await profilePOST(req("/api/profile", { cookie: old.cookie, body: { name: "Old Tester", pronoun: "", isDeveloper: false, isTester: true, side: "tester", devices: ["Linux"], languages: ["English"], categories: [], bio: "" } })));
    expect(saved.status).toBe(200);
    expect(await dashboard(old.user.id)).not.toContain(PROFILE_STEP);
    expect((await joinAs(old.cookie, old.user.id)).status).toBe(200);
    // A developer who adds the tester side (Start testing too): its profile asks for devices and languages before Join, as before.
    const dev = await makeUser({ dev: true, name: "Nora Lane" });
    expect((await json(await sidePOST(req("/api/account/side", { cookie: dev.cookie, body: { side: "tester", add: true } })))).status).toBe(200);
    expect(await dashboard(dev.user.id)).toContain(PROFILE_STEP);
    expect(await joinAs(dev.cookie, dev.user.id)).toMatchObject({ status: 409, body: { error: { code: "profile_first" } } });
  });

  it("the form: the pickers follow the choice (tester only), reuse the profile's lists, pills and red-line matches, and send every tick as a list", () => {
    const role = src("components/RoleChoice.tsx");
    expect(role).toContain('const tester = role === "tester";');
    expect(role).toContain("{tester && (");
    expect(role).toContain('<Choices label="Devices you use" name="devices" required options={DEVICES}');
    expect(role).toContain('<Choices label="Languages you can test in" name="languages" required options={LANGUAGES}');
    const match = (id: string) => new RegExp(role.match(new RegExp(`id="${id}"[^>]*data-match="([^"]+)"`))![1], "i");
    expect(match("devices").test(DEVICES_MISSING)).toBe(true);
    expect(match("languages").test(LANGUAGES_MISSING)).toBe(true);
    expect(match("devices").test(LANGUAGES_MISSING)).toBe(false);
    // The same pickers the profile shows.
    const profile = src("app/app/profile/ProfileForm.tsx");
    expect(profile).toContain('data-match="at least one device"><Choices label="Devices you use" required options={DEVICES}');
    expect(profile).toContain('data-match="at least one language"><Choices label="Languages you can test in" required options={LANGUAGES}');
    // Both sign-up pages use the one choice, and their press goes to the server even with a box red here (an empty Name), so every missing part is red at once.
    for (const f of ["app/signup/page.tsx", "app/signup/google/page.tsx"]) {
      expect(src(f)).toContain("<RoleChoice>");
      expect(src(f)).toContain("<AuthForm allAtOnce ");
    }
    expect(src("components/AuthForm.tsx")).toContain('{...(p.allAtOnce ? { "data-red-and-blue": "" } : {})}');
    expect(src("components/AuthForm.tsx")).toContain('querySelectorAll<HTMLElement>("[data-list]"))) fields[el.dataset.list!] = fd.getAll(el.dataset.list!).map(String);');
  });
});
