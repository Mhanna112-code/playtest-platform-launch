import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as keptGET, POST as keptPOST } from "@/app/api/kept/route";
import { hashPassword, logIn } from "@/lib/server/passwords";
import { SESSION_COOKIE } from "@/lib/server/session";
import { getKept, setKept } from "@/lib/server/kept";
import { ADMIN_DRAFT_PREFIX, SIGNED_IN_MARK, adminDraftKey, textOnly, trimAtSignIn } from "@/lib/keptText";
import { DRAFT_FOR, adminDraftValues } from "@/app/admin/AdminButton";
import { decideFromDraft } from "@/app/admin/DisputeDecision";
import { json, makeUser, req } from "./helpers";

// Batch 35 §11 (owner, Oct 30): the admin console's boxes keep drafts like the other forms ("admin:<action>:<id>"), and only admins may keep or read them. The
// project has no DOM test environment: the server is driven through its route, the restore through the boxes' pure helpers, and the wiring is checked in the source.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const PASSWORD = "admin-drafts-35-password";

async function person(over: Parameters<typeof makeUser>[0] = {}, admin = false) {
  const u = await makeUser(over);
  await db.user.update({ where: { id: u.user.id }, data: { passwordHash: await hashPassword(PASSWORD), ...(admin ? { isAdmin: true } : {}) } });
  return u;
}
const keep = async (cookie: string, uid: string, key: string, data: unknown) => json(await keptPOST(req("/api/kept", { cookie, headers: { "x-uid": uid }, body: { key, data } })));
const read = async (cookie: string, uid: string, key: string) => json(await keptGET(req(`/api/kept?key=${encodeURIComponent(key)}`, { cookie, headers: { "x-uid": uid } })));
async function signBackIn(u: { user: { id: string; email: string } }) {
  await db.session.deleteMany({ where: { userId: u.user.id } });
  const s = await logIn({ email: u.user.email, password: PASSWORD });
  return `${SESSION_COOKIE}=${s.token}`;
}

describe("batch 35 §11: the server keeps admin drafts for admins only", () => {
  it("the key is admin:<action>:<id>", () => {
    expect(ADMIN_DRAFT_PREFIX).toBe("admin:");
    expect(adminDraftKey("decide", "d1")).toBe("admin:decide:d1");
    expect(adminDraftKey("team-close-developer", "u1")).toBe("admin:team-close-developer:u1");
  });

  it("an admin keeps and reads an admin draft; after a sign-in it comes back marked; null forgets it", async () => {
    const a = await person({ name: "Ada Admin" }, true);
    const key = adminDraftKey("decide", "dsp35a");
    expect((await keep(a.cookie, a.user.id, key, { total: "16.00", note: "The answers were complete." })).status).toBe(200);
    const r = await read(a.cookie, a.user.id, key);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ total: "16.00", note: "The answers were complete." });
    const cookie = await signBackIn(a);
    expect((await read(cookie, a.user.id, key)).body.data).toEqual({ total: "16.00", note: "The answers were complete.", [SIGNED_IN_MARK]: true });
    // Every AdminButton box, the team close-out and the hold lift's note use the same prefix.
    for (const k of [adminDraftKey("suspend", a.user.id), adminDraftKey("pause-test", "t35"), adminDraftKey("team-close-test", "t35"), adminDraftKey("approve-hold", "h35")]) {
      expect((await keep(cookie, a.user.id, k, { note: "Spam answers", reason: "Spam answers" })).status, k).toBe(200);
      expect((await read(cookie, a.user.id, k)).body.data, k).toMatchObject({ note: "Spam answers" });
    }
    expect((await keep(cookie, a.user.id, key, null)).status).toBe(200);
    expect((await read(cookie, a.user.id, key)).body.data).toBeNull();
  });

  it("a non-admin is refused (keeping and reading), and nothing is kept", async () => {
    const d = await person({ dev: true, name: "Dana Reyes" });
    const t = await person({ tester: true, name: "Ana Silva" });
    for (const u of [d, t]) {
      const key = adminDraftKey("suspend", "someone");
      const w = await keep(u.cookie, u.user.id, key, { note: "Let me in" });
      expect(w.status).toBe(403);
      expect(w.body.error?.code ?? w.body.code).toBe("not_admin");
      expect((await read(u.cookie, u.user.id, key)).status).toBe(403);
      expect((await keep(u.cookie, u.user.id, key, null)).status).toBe(403);
      expect(await db.keptForm.count({ where: { userId: u.user.id, key: { startsWith: "admin:" } } })).toBe(0);
      // Called directly too.
      await expect(setKept(u.user.id, key, { note: "x" })).rejects.toMatchObject({ status: 403 });
      await expect(getKept(u.user.id, key)).rejects.toMatchObject({ status: 403 });
      // Their own forms still work.
      expect((await keep(u.cookie, u.user.id, "chat:t35", { text: "Hello" })).status).toBe(200);
    }
  });

  it("an admin whose account is suspended loses admin access, so their admin drafts too", async () => {
    const a = await person({ name: "Sam Admin" }, true);
    const key = adminDraftKey("stop-test", "t35s");
    expect((await keep(a.cookie, a.user.id, key, { note: "Broken build link" })).status).toBe(200);
    await db.user.update({ where: { id: a.user.id }, data: { testerSuspendedAt: new Date() } });
    expect((await read(a.cookie, a.user.id, key)).status).toBe(403);
    expect((await keep(a.cookie, a.user.id, key, { note: "x" })).status).toBe(403);
  });

  it('under SIGN_IN_DRAFTS "written" the reasons and notes would come back, and Decide\'s total and Extend\'s days (numbers) would not', () => {
    expect(textOnly("admin:decide:d", { total: "16", note: "Complete." })).toEqual({ note: "Complete." });
    expect(textOnly("admin:decide:d", { total: "16", note: "" })).toBeNull();
    expect(textOnly("admin:extend-pause:t", { days: "7" })).toBeNull();
    expect(textOnly("admin:team-close-test:t", { reason: "Spam testers." })).toEqual({ reason: "Spam testers." });
    expect(trimAtSignIn("admin:suspend:u", { note: "Spam", side: "tester" }, "whole")).toEqual({ note: "Spam", side: "tester", [SIGNED_IN_MARK]: true });
  });
});

describe("batch 35 §11: what a restored draft puts back", () => {
  it("the Decide tick resets on restore: the total and note come back, the tick never does", () => {
    expect(decideFromDraft({ total: "16.00", note: "Complete.", tickedFor: 1600, tickCents: 600 })).toEqual({ total: "16.00", note: "Complete.", tickedFor: null });
    expect(decideFromDraft({ [SIGNED_IN_MARK]: true })).toEqual({ total: "", note: "", tickedFor: null });
    const d = src("app/admin/DisputeDecision.tsx");
    // The draft holds the total and the note only, and the restore sets the tick from the helper (null).
    expect(d).toContain('useKept<Record<string, unknown>>(adminDraftKey("decide", id), { total, note }, total.trim() === "" && note.trim() === "", (d) => {');
    expect(d).toContain("setTickedFor(back.tickedFor);");
    // (Batch 35 §39) One Discard for the total and the note: both emptied (blank total: keep the pay), the tick needed again.
    expect(d).toContain('{keep.restored && (total !== "" || note !== "") && <DraftTag kind="discard" field="decide" onUseSaved={() => { setTotal(""); setNote(""); setTickedFor(null); }} />}');
    expect(d).not.toContain('kind="saved"');
    // Decide stays disabled until a restored raise is ticked again (batch 35 §1).
    expect(d).toContain("disabled={busy || (extra > 0 && !ticked)}");
    // Cleared only when Decide goes through.
    const body = d.slice(d.indexOf('await api("/api/admin/decide"'));
    expect(body.indexOf("await keep.clear();")).toBeGreaterThan(-1);
    expect(body.indexOf("await keep.clear();")).toBeLessThan(body.indexOf("} catch (e) {"));
  });

  it("an admin button's draft puts back only its own boxes (and a side its choice still offers); one typed for another state never comes back", () => {
    const fields = [{ name: "note" }];
    const choice = { name: "side", options: [{ value: "developer" }, { value: "tester" }] };
    expect(adminDraftValues({ note: "Spam", side: "tester", id: "other", since: "x", [SIGNED_IN_MARK]: true }, fields, choice)).toEqual({ note: "Spam", side: "tester" });
    expect(adminDraftValues({ note: "Spam", side: "nobody" }, fields, choice)).toEqual({ note: "Spam" });
    expect(adminDraftValues({ note: "Spam", side: "developer" }, fields)).toEqual({ note: "Spam" }); // no choice: the fixed side is sent from extra, never the draft's
    // Suspend keeps the sides open when it was typed.
    expect(adminDraftValues({ note: "Spam", [DRAFT_FOR]: "developer,tester" }, fields, choice, "developer,tester")).toEqual({ note: "Spam" });
    expect(adminDraftValues({ note: "Spam", [DRAFT_FOR]: "developer,tester" }, fields, choice, "tester")).toBeNull();
    expect(adminDraftValues({ note: "Spam" }, fields, choice, "tester")).toBeNull();
  });
});

describe("batch 35 §11: every admin box keeps its draft", () => {
  it("AdminButton: every box (reason, note, days) under admin:<action>:<id>, Discard, cleared when the press goes through; a button with no box keeps nothing", () => {
    const b = src("app/admin/AdminButton.tsx");
    expect(b).toContain("useKept<Record<string, unknown>>(adminDraftKey(action, id), draftFor === undefined ? v : { ...v, [DRAFT_FOR]: draftFor }, !typedAny, (d) => {");
    expect(b).toContain("}, fields.length === 0);"); // off without a box (Reinstate, Lift the pause, Mark replied, Approve, Close now, …)
    expect(b).toContain('{keep.restored && put && typedAny && <DraftTag kind="discard" onUseSaved={() => setV({})} />}');
    const press = b.slice(b.indexOf("await api(`/api/admin/${action}`"));
    expect(press.indexOf("await keep.clear();")).toBeLessThan(press.indexOf("} catch (e) {"));
    expect(press.slice(press.indexOf("} catch (e) {")).split("finally")[0]).not.toContain("keep.clear");
  });

  it("the boxes with a typed box all go through AdminButton (Suspend, Delete, Pause, Stop, Extend, Don't approve)", () => {
    const all = ["app/admin/AccountActions.tsx", "app/admin/PagedList.tsx", "app/admin/TestActions.tsx", "app/admin/page.tsx"].map(src).join("\n");
    for (const a of ["suspend", "delete-account", "pause-test", "stop-test", "extend-pause", "decline-chargeback"]) expect(all, a).toMatch(new RegExp(`<AdminButton[^>]*action="${a}"[^>]*fields=\\{\\[`));
    // Suspend's box belongs to the sides open (a box swapped in for a new state starts empty).
    const acc = src("app/admin/AccountActions.tsx");
    expect((acc.match(/draftFor=\{openKey\}/g) ?? []).length).toBe(3);
    expect(acc).toContain('const openKey = open.join(",");');
    // A test paused while its Pause box was shown: that Pause's Why goes (batch 27 section 5).
    expect(src("app/admin/TestActions.tsx")).toContain('if (adminPaused && !was.current) void dropKept(adminDraftKey("pause-test", id));');
    expect(src("app/admin/PagedList.tsx")).toContain("usePauseDraftGoes(t.id, t.adminPaused);");
    expect(src("app/admin/TestActions.tsx")).toContain("usePauseDraftGoes(id, adminPaused);");
  });

  it("the team close-out's reason: admin:team-close-<scope>:<id>, Discard (beside Preview until the box shows), cleared when Close goes through", () => {
    const t = src("app/admin/TeamCloseBox.tsx");
    expect(t).toContain('useKept<{ reason?: unknown }>(adminDraftKey(`team-close-${scope}`, id), { reason }, reason.trim() === "", (d) => setReason(typeof d.reason === "string" ? d.reason : ""));');
    expect(t).toContain('<DraftTag kind="discard" onUseSaved={() => setReason("")} />');
    expect(t).toContain("{!boxShown && tag}");
    const press = t.slice(t.indexOf('api<{ line: string }>("/api/admin/team-close"'));
    expect(press.indexOf("await keep.clear();")).toBeLessThan(press.indexOf("} catch (e) {"));
  });

  it("the hold lift's note to the developer: admin:approve-hold:<id>, Discard, cleared when Approve goes through", () => {
    const l = src("app/admin/PagedList.tsx");
    expect(l).toContain('useKept<{ note?: unknown }>(adminDraftKey("approve-hold", id), { note }, note.trim() === "", (d) => setNote(typeof d.note === "string" ? d.note : ""));');
    expect(l).toContain('{keep.restored && note !== "" && <DraftTag kind="discard" onUseSaved={() => setNote("")} />}');
    const press = l.slice(l.indexOf('await api("/api/admin/approve-hold"'));
    expect(press.indexOf("await keep.clear();")).toBeLessThan(press.indexOf("} catch (e) {"));
  });

  it("no other text box or amount under src/app/admin is left without a draft", () => {
    const dir = path.resolve(__dirname, "../src/app/admin");
    const files = fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith(".tsx")).map((d) => path.join(d.parentPath ?? d.path, d.name));
    const boxes: string[] = [];
    for (const f of files) {
      const s = fs.readFileSync(f, "utf8");
      // A typed box: a textarea, or an input that is not a tick, a radio or the lists' search.
      for (const m of s.match(/<(textarea|input)\b[^>]*/g) ?? []) if (!/type="(checkbox|radio|search)"/.test(m)) boxes.push(`${path.basename(f)}: ${m.slice(0, 60)}`);
    }
    const kept = new Set(["AdminButton.tsx", "DisputeDecision.tsx", "TeamCloseBox.tsx", "PagedList.tsx"]);
    for (const b of boxes) expect(kept.has(b.split(":")[0]), b).toBe(true);
    for (const f of kept) expect(src(`app/admin/${f}`), f).toContain("useKept");
  });
});
