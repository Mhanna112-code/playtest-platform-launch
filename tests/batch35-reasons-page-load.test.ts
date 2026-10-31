import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { json, makeUser, req } from "./helpers";
import { seen, setup } from "./fixtures";

// Batch 35 §49-§51 (owner, Oct 31): each admin action keeps its own reason on the Timeline; the device icon in the needs pop-up; admins' "same page" means the
// same page load.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const T = "\\d{1,2}:\\d{2}\\s[AP]M";

type Res = { status: number; body: { error?: { code: string; message: string; changes?: { text: string }[]; press?: string; now?: string } } & Record<string, unknown> };
/** An admin press from one browser tab (`tab`, x-tab) and one page load in it (`load`, x-load: what every browser press now sends). */
const aact = (cookie: string, action: string, body: Record<string, unknown>, tab: string, load?: string): Promise<Res> =>
  adminPOST(req(`/api/admin/${action}`, { cookie, body, headers: { "x-tab": tab, ...(load ? { "x-load": load } : {}) } }), { params: Promise.resolve({ action }) }).then(json);
async function admin() {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test`, name: "Team Member" });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}
const pause = () => new Promise((r) => setTimeout(r, 15));
const loaded = async () => {
  const at = seen();
  await pause();
  return at;
};
const you = (what: string) => new RegExp(`^You ${esc(what)} in another tab at ${T}\\.$`);
function expectStop(r: Res, press: string, lines: RegExp[]) {
  expect(r.status).toBe(409);
  expect(r.body.error).toMatchObject({ code: "stop_once", press });
  expect(r.body.error!.changes!.map((c) => c.text)).toEqual(lines.map((l) => expect.stringMatching(l)));
}
async function timeline(adminId: string, testId: string) {
  const { adminPage } = await import("@/lib/server/adminLists");
  return (await adminPage("t-timeline", adminId, null, testId)).rows as { text: string }[];
}

describe("batch 35 §49: each admin action keeps its own reason", () => {
  it("a Stop right after a Pause: each line quotes its own reason", async () => {
    const a = await admin();
    const s = await setup();
    expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "Checking reports" }, "tab-A")).status).toBe(200);
    expect((await aact(a.cookie, "stop-test", { id: s.testId, note: "Spam listing" }, "tab-A")).status).toBe(200);
    const rows = await timeline(a.user.id, s.testId);
    expect(rows.find((r) => r.text.includes("paused this test"))!.text).toMatch(/paused this test: “Checking reports”$/);
    expect(rows.find((r) => r.text.includes("stopped this test"))!.text).toMatch(/stopped this test: “Spam listing”$/);
  });

  it("a Pause without a reason never borrows the Stop's; a second Pause after a lift keeps its own", async () => {
    const a = await admin();
    const s = await setup();
    expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "First look" }, "tab-A")).status).toBe(200);
    expect((await aact(a.cookie, "unpause-test", { id: s.testId }, "tab-A")).status).toBe(200);
    expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "" }, "tab-A")).status).toBe(200);
    expect((await aact(a.cookie, "stop-test", { id: s.testId, note: "Spam listing" }, "tab-A")).status).toBe(200);
    const paused = (await timeline(a.user.id, s.testId)).filter((r) => r.text.includes("paused this test")).map((r) => r.text);
    expect(paused).toHaveLength(2);
    expect(paused[0]).toMatch(/paused this test$/); // newest first: the reasonless second Pause
    expect(paused[1]).toMatch(/paused this test: “First look”$/);
  });

  it("an older event without a stored reason keeps today's behaviour (the test's note, within 5 s of the pause)", async () => {
    const a = await admin();
    const s = await setup();
    const at = new Date();
    await db.test.update({ where: { id: s.testId }, data: { adminPausedAt: at, adminPausedById: a.user.id, adminNote: "Old reason" } });
    await db.testEvent.create({ data: { testId: s.testId, kind: "paused", text: "The team paused this test", createdAt: at } });
    expect((await timeline(a.user.id, s.testId)).find((r) => r.text.includes("paused this test"))!.text).toMatch(/paused this test: “Old reason”$/);
  });
});

describe("batch 35 §50: the device icon in the needs pop-up", () => {
  it("devices only: Monitor (the join page's device badge); a language or both: Languages", () => {
    const g = src("components/GapDialog.tsx");
    expect(g).toMatch(/import \{[^}]*\bMonitor\b[^}]*\} from "lucide-react"/);
    expect(g).toContain('shown.devices.length && !shown.languages.length ? <Monitor className="h-5 w-5 text-amber-300" data-gap-icon="device" /> : <Languages');
    expect(src("app/app/find/[id]/page.tsx")).toContain("<Monitor className=\"h-3.5 w-3.5\" /> {t.devices.join");
  });
});

describe("batch 35 §51: an admin's 'same page' is the same page load", () => {
  it("(a) suspended in window A; window B (loaded before) presses Delete without redrawing: stops once with the 'You' line, then goes ahead", async () => {
    const a = await admin();
    const x = await makeUser({ name: "Nora Lane", dev: true, tester: true });
    const sinceB = await loaded();
    expect((await aact(a.cookie, "suspend", { id: x.user.id, side: "developer", note: "Fraud reports" }, "tab-A", "tab-A.1")).status).toBe(200);
    const stop = await aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email", since: sinceB }, "tab-B", "tab-B.1");
    expectStop(stop, "Delete account", [you("suspended the developer side")]);
    expect(stop.body.error!.changes![0].text).toMatch(/^You suspended the developer side in another tab at /);
    expect((await aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email", since: sinceB, confirmed: true, boxAt: stop.body.error!.now }, "tab-B", "tab-B.1")).status).toBe(200);
  });

  it("(b) window B redrew after the suspension (its page time is later): Delete goes straight through", async () => {
    const a = await admin();
    const x = await makeUser({ name: "Nora Lane", dev: true, tester: true });
    expect((await aact(a.cookie, "suspend", { id: x.user.id, side: "developer", note: "Fraud reports" }, "tab-A", "tab-A.1")).status).toBe(200);
    const redrawn = await loaded();
    expect((await aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email", since: redrawn }, "tab-B", "tab-B.1")).status).toBe(200);
  });

  it("(c) same browser tab: suspend, reload, Delete goes through (the reloaded page shows it); a page in that tab that didn't show it stops once", async () => {
    const a = await admin();
    const x = await makeUser({ name: "Nora Lane", dev: true, tester: true });
    const before = await loaded();
    expect((await aact(a.cookie, "suspend", { id: x.user.id, side: "developer", note: "Fraud reports" }, "tab-T", "tab-T.1")).status).toBe(200);
    // A page drawn later in the same tab whose time is still before the change (Back to a page kept from before): not this page's own any more.
    const stale = await aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email", since: before }, "tab-T", "tab-T.2");
    expectStop(stale, "Delete account", [you("suspended the developer side")]);
    // The reload: same tab, a new page load drawn after the suspension.
    const reloaded = await loaded();
    expect((await aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email", since: reloaded }, "tab-T", "tab-T.3")).status).toBe(200);
  });

  it("(d) a press from the page that made the change never stops itself", async () => {
    const a = await admin();
    const x = await makeUser({ name: "Nora Lane", dev: true, tester: true });
    const since = await loaded();
    expect((await aact(a.cookie, "suspend", { id: x.user.id, side: "developer", note: "Fraud reports" }, "tab-T", "tab-T.1")).status).toBe(200);
    expect((await aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email", since }, "tab-T", "tab-T.1")).status).toBe(200);
  });

  it("every browser press sends its page load (x-load); each admin page drawn starts a new one; the server keys 'own' on it", () => {
    const c = src("lib/client.ts");
    expect(c).toContain('...(PAGE_LOAD ? { "x-load": PAGE_LOAD } : {})');
    expect(c).toMatch(/export const newPageLoad = \(\) => \{/);
    expect(src("app/admin/PageLoad.tsx")).toContain("useEffect(() => newPageLoad(), [path]);");
    expect(src("app/admin/layout.tsx")).toContain("<PageLoad />");
    expect(src("lib/server/http.ts")).toContain('req.headers.get("x-load")');
    expect(src("app/api/admin/[action]/route.ts")).toContain("await markPress(u.id, tabOf(body), start);");
  });
});

describe("batch 35 §52: one pick-list chip", () => {
  it("Categories, Language and Technology requirements, the profile's lists, Find's ticks and Invite's filters all use the round green pill", () => {
    const c = src("components/Choices.tsx");
    expect(c).toMatch(/export const PICK_CHIP = "[^"]*\brounded-full\b[^"]*has-\[:checked\]:border-indigo-400\/60 has-\[:checked\]:bg-indigo-500\/15[^"]*"/);
    expect(c).toContain("<label key={o} className={PICK_CHIP}>");
    expect(c).not.toContain("rounded-lg");
    expect(src("app/app/tests/TestForm.tsx")).toContain("<label key={o} className={PICK_CHIP}>"); // Categories (Languages / Technology are <Choices>)
    expect(src("app/app/tests/TestForm.tsx")).toMatch(/<Choices label="Language requirements[\s\S]*<Choices label="Technology requirements/);
    expect(src("app/app/profile/ProfileForm.tsx")).toMatch(/<Choices label="Devices you use"[\s\S]*<Choices label="Languages you can test in"/);
    expect(src("app/app/find/FindSearch.tsx")).toContain("<label key={s} className={PICK_CHIP}>");
    expect(src("app/app/tests/[id]/InvitePanel.tsx")).toContain("<label key={o} className={PICK_CHIP}>");
    // No other pick list keeps its own chip classes.
    for (const f of ["app/app/tests/TestForm.tsx", "app/app/find/FindSearch.tsx", "app/app/tests/[id]/InvitePanel.tsx", "app/app/profile/ProfileForm.tsx"]) expect(src(f)).not.toContain("has-[:checked]");
  });
});
