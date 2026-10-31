import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as keptGET, POST as keptPOST } from "@/app/api/kept/route";
import { hashPassword, logIn } from "@/lib/server/passwords";
import { SESSION_COOKIE } from "@/lib/server/session";
import { PROFILE_DRAFT_FIELDS, SIGNED_IN_MARK, SIGN_IN_DRAFTS, textOnly, trimAtSignIn } from "@/lib/keptText";
import { DISCARD_LABEL, DraftTag, USE_SAVED_LABEL, draftButtonLabel } from "@/lib/useKept";
import { profileDraft, profileFromDraft } from "@/app/app/profile/ProfileForm";
import { json, makeUser, req } from "./helpers";

// Batch 35 §10 (owner, Oct 30): a box with no saved version reads "Discard" instead of "Use saved" (same behaviour); the Apply / Ask to rejoin note and the
// profile edits are kept as drafts too. The project has no DOM test environment: the server is driven through its routes, the profile's draft through its pure
// helpers, and the wiring is checked in the source.

(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const PASSWORD = "discard-35-password";

async function person(over: Parameters<typeof makeUser>[0] = {}) {
  const u = await makeUser(over);
  await db.user.update({ where: { id: u.user.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
  return u;
}
const keep = async (cookie: string, uid: string, key: string, data: unknown) => json(await keptPOST(req("/api/kept", { cookie, headers: { "x-uid": uid }, body: { key, data } })));
const read = async (cookie: string, uid: string, key: string) => (await json(await keptGET(req(`/api/kept?key=${encodeURIComponent(key)}`, { cookie, headers: { "x-uid": uid } })))).body.data as Record<string, unknown> | null;
async function signBackIn(u: { user: { id: string; email: string } }) {
  await db.session.deleteMany({ where: { userId: u.user.id } });
  const s = await logIn({ email: u.user.email, password: PASSWORD });
  return `${SESSION_COOKIE}=${s.token}`;
}

/** Every .ts / .tsx file under src. */
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [path.join(dir, d.name)] : []));
}

describe("batch 35 §10: Discard where nothing is saved", () => {
  it("the label is a prop of DraftTag: kind saved reads Use saved, kind discard reads Discard (same button, same press)", () => {
    expect(DISCARD_LABEL).toBe("Discard");
    expect(USE_SAVED_LABEL).toBe("Use saved");
    expect(draftButtonLabel("discard")).toBe("Discard");
    expect(draftButtonLabel("saved")).toBe("Use saved");
    const discard = html(createElement(DraftTag, { kind: "discard", onUseSaved: () => null }));
    expect(discard).toContain(">Draft<");
    expect(discard).toContain(">Discard</button>");
    expect(discard).not.toContain("Use saved");
    expect(discard).toContain('data-draft-kind="discard"');
    expect(discard).toContain('type="button"');
    const saved = html(createElement(DraftTag, { kind: "saved", onUseSaved: () => null }));
    expect(saved).toContain(">Use saved</button>");
    expect(saved).not.toContain("Discard");
    // Still signed in: only the tag, no button.
    expect(html(createElement(DraftTag, { kind: "discard" }))).not.toContain("<button");
  });

  it("each box has its label: Discard on the boxes with no saved version, Use saved where one exists", () => {
    const want: Record<string, { discard: number; saved: number }> = {
      "app/app/tests/[id]/TopPanel.tsx": { discard: 2, saved: 0 }, // End early, Stop
      "app/app/tests/[id]/DisputeSide.tsx": { discard: 1, saved: 0 }, // the developer's dispute side
      "components/RateBox.tsx": { discard: 1, saved: 0 }, // rating comments (both sides)
      "components/Chat.tsx": { discard: 1, saved: 0 }, // chat messages
      "app/app/help/ContactForm.tsx": { discard: 1, saved: 0 }, // Contact us
      "app/app/tests/[id]/DevCallPanel.tsx": { discard: 1, saved: 0 }, // the developer's Request a call
      "components/CallRequests.tsx": { discard: 1, saved: 0 }, // the tester's Propose times
      "app/app/find/[id]/JoinBox.tsx": { discard: 1, saved: 0 }, // the Apply / Ask to rejoin note
      "app/app/sessions/[id]/SessionActions.tsx": { discard: 1, saved: 1 }, // the tester's dispute reason; written answers
      "app/app/tests/TestForm.tsx": { discard: 0, saved: 2 }, // Edit / Post (each field, and the access keys)
      "app/app/tests/[id]/PayBox.tsx": { discard: 0, saved: 1 }, // Pay / Pay more
      "app/app/profile/ProfileForm.tsx": { discard: 0, saved: 1 }, // the profile
    };
    for (const [f, n] of Object.entries(want)) {
      const s = src(f);
      expect((s.match(/<DraftTag kind="discard"/g) ?? []).length, f).toBe(n.discard);
      expect((s.match(/<DraftTag kind="saved"/g) ?? []).length, f).toBe(n.saved);
    }
    // No other DraftTag anywhere, and none without its kind.
    const root = path.resolve(__dirname, "../src");
    for (const file of walk(root)) {
      const s = fs.readFileSync(file, "utf8");
      const rel = path.relative(root, file).split(path.sep).join("/");
      if (rel === "lib/useKept.tsx") continue;
      const tags = s.match(/<DraftTag\b[^>]*/g) ?? [];
      if (tags.length) expect(Object.keys(want), rel).toContain(rel);
      for (const t of tags) expect(t, rel).toMatch(/^<DraftTag kind="(saved|discard)"/);
    }
    // Edit / Post keep "Use saved for all".
    expect(src("app/app/tests/TestForm.tsx")).toContain("onClick={putAllSaved}>{USE_SAVED_ALL_LABEL}</button>");
  });

  it("Discard on a call request clears only the form being typed (sent / pending requests and booked calls untouched)", () => {
    expect(src("app/app/tests/[id]/DevCallPanel.tsx")).toContain('<DraftTag kind="discard" onUseSaved={keep.signedIn ? () => { setRows([newRow()]); setMinutes(""); setTicked([]); } : undefined} />');
    expect(src("components/CallRequests.tsx")).toContain('<DraftTag kind="discard" onUseSaved={keep.signedIn ? () => { setRows([newRow()]); setMinutes(""); } : undefined} />');
  });
});

describe("batch 35 §10: the Apply note's draft", () => {
  it("the server keeps it (apply:<testId>), and it comes back marked after a sign-in; Discard empties it and the draft goes", async () => {
    const t = await person({ tester: true, name: "Ana Silva" });
    const key = "apply:t35d";
    expect((await keep(t.cookie, t.user.id, key, { note: "I play a lot of sailing games." })).status).toBe(200);
    expect((await read(t.cookie, t.user.id, key))?.[SIGNED_IN_MARK]).toBeUndefined(); // still signed in: Draft only
    const cookie = await signBackIn(t);
    expect(await read(cookie, t.user.id, key)).toEqual({ note: "I play a lot of sailing games.", [SIGNED_IN_MARK]: true });
    expect((await keep(cookie, t.user.id, key, null)).status).toBe(200);
    expect(await read(cookie, t.user.id, key)).toBeNull();
    // Under the other setting the note is written text, so it would come back too.
    expect(textOnly(key, { note: "Hi" })).toEqual({ note: "Hi" });
  });

  it("the join box keeps it, shows Draft / Discard at the note, and clears it only when Apply, Ask to rejoin or Join goes through", () => {
    const j = src("app/app/find/[id]/JoinBox.tsx");
    expect(j).toContain('const keep = useKept(`apply:${p.testId}`, { note }, note === "", (v) => setNote(typeof v.note === "string" ? v.note : ""));');
    expect(j).toContain('{keep.restored && note !== "" && <DraftTag kind="discard" onUseSaved={keep.signedIn ? () => setNote("") : undefined} />}');
    // The hook runs before the box's early returns (the waiting views).
    expect(j.indexOf("const keep = useKept(")).toBeLessThan(j.indexOf('if (p.application?.status === "pending"'));
    // The pop-up's press and the button's press: cleared right after the server took it (a stop or refusal throws first, so the draft stays).
    const popup = j.slice(j.indexOf("async function sendFromPopup"), j.indexOf("async function press("));
    expect(popup.indexOf("await keep.clear();")).toBeGreaterThan(popup.indexOf("const r = await api<"));
    expect(popup.indexOf("await keep.clear();")).toBeLessThan(popup.indexOf("} catch (e) {"));
    const go = j.slice(j.indexOf("async function go("), j.indexOf("// (Batch 34 §16, owner's finding)"));
    expect(go).toContain('if (action !== "withdraw-application") await keep.clear();');
    expect(go.indexOf("await keep.clear();")).toBeGreaterThan(go.indexOf("const r = await api<"));
    expect(go.indexOf("await keep.clear();")).toBeLessThan(go.indexOf("window.location.href = `/app/sessions/${r.sessionId}`"));
  });
});

describe("batch 35 §10: the profile's draft", () => {
  const saved = { name: "Ana Silva", pronoun: "", isDeveloper: false, isTester: true, devices: ["Windows PC"], categories: [], languages: ["English"], bio: "I test RPGs." };

  it("the draft is the fields that differ from the saved profile; nothing differs: nothing to keep", () => {
    expect(PROFILE_DRAFT_FIELDS).toEqual(["name", "pronoun", "devices", "languages", "categories", "bio"]);
    expect(profileDraft(saved, saved)).toEqual({});
    const typed = { ...saved, bio: "I test RPGs and sailing games.", devices: ["Windows PC", "Mac"], isDeveloper: true };
    expect(profileDraft(typed, saved)).toEqual({ bio: "I test RPGs and sailing games.", devices: ["Windows PC", "Mac"] }); // never the sides
    // Back: only the profile's fields of the right shape.
    expect(profileFromDraft({ f: { bio: "x", devices: ["Mac"], languages: "English", isDeveloper: true }, [SIGNED_IN_MARK]: true })).toEqual({ bio: "x", devices: ["Mac"] });
    expect(profileFromDraft(null)).toEqual({});
  });

  it("the server keeps it per side; after a sign-in it comes back whole (text and selections), marked", async () => {
    const t = await person({ tester: true, name: "Ana Silva" });
    const key = "profile:tester";
    const data = { f: { bio: "I test RPGs and sailing games.", devices: ["Windows PC", "Mac"], languages: ["English", "Spanish"] } };
    expect((await keep(t.cookie, t.user.id, key, data)).status).toBe(200);
    expect(SIGN_IN_DRAFTS).toBe("whole");
    const cookie = await signBackIn(t);
    expect(await read(cookie, t.user.id, key)).toEqual({ ...data, [SIGNED_IN_MARK]: true });
    // Under the other setting only the name and bio would come back.
    expect(trimAtSignIn(key, data, "written")).toEqual({ f: { bio: "I test RPGs and sailing games." }, [SIGNED_IN_MARK]: true });
    expect(trimAtSignIn(key, { f: { devices: ["Mac"] } }, "written")).toBeNull();
  });

  it("the form keeps it, shows Draft / Use saved beside Save profile (back to the saved values), and clears it only when Save profile goes through", () => {
    const f = src("app/app/profile/ProfileForm.tsx");
    expect(f).toContain("const keep = useKept(`profile:${side}`, { f: draft }, Object.keys(draft).length === 0, (d) => {");
    expect(f).toContain("for (const k of Object.keys(f) as (keyof Init)[]) typed.current.add(k);"); // a live refresh never overwrites the restored fields
    expect(f).toContain("}, !!first);"); // the first setup keeps nothing
    expect(f).toContain("{keep.restored && Object.keys(draft).length > 0 && <DraftTag kind=\"saved\" onUseSaved={keep.signedIn ? useSaved : undefined} />}");
    expect(f).toContain("typed.current.clear();\n    setV(init);");
    const save = f.slice(f.indexOf("async function save("), f.indexOf("} catch (err) {"));
    expect(save.indexOf("if (!first) await keep.clear();")).toBeGreaterThan(save.indexOf('await api("/api/profile"'));
    // The first setup: nothing is read, saved or cleared.
    const kept = src("lib/useKept.tsx");
    expect(kept).toContain("if (off) return;");
    expect(kept).toContain("if (!off && (saved.current || !ready.current)) await send(null);");
  });
});
