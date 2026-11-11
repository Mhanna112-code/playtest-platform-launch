import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as excerptsPOST } from "@/app/api/excerpts/route";
import { POST as profilePOST } from "@/app/api/profile/route";
import { POST as notifyPOST } from "@/app/api/account/notify/route";
import { POST as passwordPOST } from "@/app/api/auth/password/route";
import { logAccountChange } from "@/lib/server/accountChanges";
import { excerptLength } from "@/lib/server/excerpts";
import { EXCERPT_LENGTH_LINE } from "@/components/Excerpts";
import { ATTACH_FORMATS_LINE, VIDEO_FORMATS_LINE, uploadMistake } from "@/lib/videoFormats";
import { json, makeUser, req } from "./helpers";
import { act, atHours, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 11, §380 D2b) The remaining small forms get §380 D2's treatment: the button stays pressable with a field wrong; one press marks the field red on the
// page AND still asks the server, whose order is refusals (final, then soft) → stop-once box → the field's own mistakes; nothing is saved or made while one
// remains. Each form: a mistake + a refusal or box → the refusal / box (nothing saved); the mistake alone → the red mistake (nothing saved).

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
type Res = { status: number; body: { error?: { code?: string; message?: string } } & Record<string, unknown> };
const code = (r: Res) => [r.status, r.body.error?.code];
const later = () => new Promise((r) => setTimeout(r, 30));
const past = () => new Date(Date.now() - 60_000).toISOString();
const post = (route: (r: Request) => Promise<Response>, url: string, cookie: string, body: Record<string, unknown>) => route(req(url, { cookie, body })).then(json);
const ANS = "The harbour level was clear and the boats handled well on the first try.";
const LESS_THAN_24H = "The call is less than 24 hours away: say why you're cancelling (the other side sees it).";

/** A booked call 10 hours away (a reason is required to cancel it). */
async function soonCall() {
  const s = await setup();
  const j = await joined(s.testId);
  const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 48);
  await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() + 10 * 3_600_000) } });
  return { ...s, ...j, call };
}

describe("§380 D2b: Cancel a call (the reason required under 24 hours)", () => {
  it("the developer: no reason + a stop-once box → the box; then the red reason; nothing cancelled until it's given", async () => {
    const w = await soonCall();
    const loaded = seen();
    await later();
    await db.testEvent.create({ data: { testId: w.testId, kind: "left", text: "Cara Diaz left the test" } });
    const cancel = (body: Record<string, unknown>) => act(w.testId, "cancel-call", w.dev.cookie, { callId: w.call.id, reason: "", seenAt: loaded, ...body });
    const first = await cancel({});
    expect(code(first), JSON.stringify(first.body)).toEqual([409, "stop_once"]);
    const second = await cancel({ confirmed: true, boxAt: seen() });
    expect([second.status, second.body.error?.message]).toEqual([400, LESS_THAN_24H]);
    expect((await db.call.findUniqueOrThrow({ where: { id: w.call.id } })).status).toBe("booked");
    expect((await cancel({ reason: "Something came up.", confirmed: true, boxAt: seen() })).status).toBe(200);
  });

  it("the tester: no reason + a stop-once box (a new call request) → the box; the reason alone → red only; nothing cancelled", async () => {
    const w = await soonCall();
    const loaded = seen();
    await later();
    expect((await act(w.testId, "request-time", w.dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [w.sessionId], minutes: 30, times: [atHours(80)] })).status).toBe(200);
    await settle();
    const cancel = (body: Record<string, unknown>) => sact(w.sessionId, "cancel-call", w.tester.cookie, { callId: w.call.id, reason: "", seenAt: loaded, loadedAt: loaded, ...body });
    const first = await cancel({});
    expect(code(first), JSON.stringify(first.body)).toEqual([409, "stop_once"]);
    const second = await cancel({ seenAt: seen(), loadedAt: seen(), confirmed: true, boxAt: seen() });
    expect([second.status, second.body.error?.message]).toEqual([400, LESS_THAN_24H]);
    expect((await db.call.findUniqueOrThrow({ where: { id: w.call.id } })).status).toBe("booked");
  });

  it("the page: Cancel is pressable with the reason missing (marks it red and still goes)", () => {
    const m = src("components/CancelMenu.tsx");
    expect(m).toContain("onClick={() => { checkFields(root.current); setMine(true); p.onCancel(reason); }}");
    expect(m).not.toContain("if (!checkFields(root.current)) return;");
  });
});

describe("§380 D2b: Ask to show an excerpt", () => {
  async function paidAnswers() {
    const s = await setup();
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: [ANS, "Nowhere, it was smooth."], seenAt: seen(), confirmed: true });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    expect((await reviewPOST(req("/api/review", { cookie: s.dev.cookie, body: { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, payKey: randomUUID(), seenAt: seen(), confirmed: true } })).then(json)).status).toBe(200);
    return { ...s, ...j, sub };
  }
  const ask = (cookie: string, body: Record<string, unknown>) => post(excerptsPOST, "/api/excerpts", cookie, { action: "request", ...body });

  it("too short + a refusal (one already waiting on this part) → the refusal; too short alone → the red length; no row made", async () => {
    const w = await paidAnswers();
    expect((await ask(w.tester.cookie, { submissionId: w.sub.id, index: 0, text: "the boats handled well" })).status).toBe(200);
    const refused = await ask(w.tester.cookie, { submissionId: w.sub.id, index: 0, text: "boats" });
    expect([refused.status, refused.body.error?.code]).toEqual([409, "pending"]);
    // A bad pick and words added are refusals' followers too.
    expect(code(await ask(w.tester.cookie, { submissionId: w.sub.id, index: 9, text: "the boats handled well" }))).toEqual([409, "pending"]);
    expect(await db.excerpt.count({ where: { submissionId: w.sub.id } })).toBe(1);
    await db.excerpt.deleteMany({ where: { submissionId: w.sub.id } });
    const red = await ask(w.tester.cookie, { submissionId: w.sub.id, index: 0, text: "boats" });
    expect([red.status, red.body.error?.message]).toEqual([400, excerptLength]);
    expect(code(await ask(w.tester.cookie, { submissionId: w.sub.id, index: 0, text: "the boats handled really well" }))).toEqual([400, "not_from_answer"]);
    expect(code(await ask(w.tester.cookie, { submissionId: w.sub.id, index: 9, text: "the boats handled well" }))).toEqual([400, "bad_pick"]);
    expect(await db.excerpt.count({ where: { submissionId: w.sub.id } })).toBe(0);
  });

  it("the page: Ask the developer stays pressable; the press marks the box red with the server's own line", () => {
    expect(EXCERPT_LENGTH_LINE).toBe(excerptLength);
    const x = src("components/Excerpts.tsx");
    expect(x).toContain("if (n < MIN || n > MAX) markServerMistakes(root.current, [EXCERPT_LENGTH_LINE]);");
    expect(x).toContain("disabled={busy} onClick={send}>");
  });
});

describe("§380 D2b: Upload (written attachments and recordings)", () => {
  const start = (sessionId: string, cookie: string, body: Record<string, unknown>) => sact(sessionId, "recording-start", cookie, body);

  it("a wrong type + a refusal (her part is over) → the refusal; the wrong type alone → the red type; no row, no upload", async () => {
    const s = await setup();
    const a = await joined(s.testId);
    const b = await joined(s.testId, "Ben Carter", "he");
    expect((await sact(a.sessionId, "leave", a.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    const over = await start(a.sessionId, a.tester.cookie, { filename: "notes.exe", size: 100, contentType: "application/x-msdownload", part: "written" });
    expect(over.status, JSON.stringify(over.body)).toBe(409);
    expect(await db.recording.count({ where: { contractId: a.sessionId } })).toBe(0);
    const red = await start(b.sessionId, b.tester.cookie, { filename: "notes.exe", size: 100, contentType: "application/x-msdownload", part: "written" });
    expect([red.status, red.body.error?.message]).toEqual([400, ATTACH_FORMATS_LINE]);
    const empty = await start(b.sessionId, b.tester.cookie, { filename: "clip.mp4", size: 0, contentType: "video/mp4", part: "recording" });
    expect([empty.status, empty.body.error?.message]).toEqual([400, "That file is empty."]);
    const big = await start(b.sessionId, b.tester.cookie, { filename: "clip.mp4", size: 501 * 1024 * 1024, contentType: "video/mp4", part: "recording" });
    expect([big.status, big.body.error?.message]).toEqual([413, "Recordings can be at most 500 MB."]);
    expect(await db.recording.count({ where: { contractId: b.sessionId } })).toBe(0);
  });

  it("the picker's check is the server's (one shared uploadMistake); the press sends the details, never the bytes", () => {
    expect(uploadMistake({ filename: "a.mkv", contentType: "video/x-matroska", size: 10, part: "recording" })?.message).toBe(VIDEO_FORMATS_LINE);
    expect(uploadMistake({ filename: "a.png", contentType: "image/png", size: 10, part: "written" })).toBeNull();
    expect(src("lib/server/recordings.ts")).toContain("const mistake = uploadMistake({ filename, contentType: given, size, part });");
    const up = src("lib/upload.ts");
    expect(up).toContain("const mistake = fileMistake(file, filename, part);");
    expect(up).toContain("{ filename, size: file.size, contentType, part }");
    expect(src("app/app/sessions/[id]/RecordingUpload.tsx")).toContain("if (mistake) markServerMistakes(rootRef.current, [mistake]);");
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).toContain('const mistake = fileMistake(file, file.name, "written"); setRed(mistake);');
  });
});

describe("§380 D2b: Profile save and the settings forms", () => {
  const base = { name: "Ana Silva", pronoun: "", isDeveloper: false, isTester: true, devices: ["Windows PC"], categories: [], languages: ["English"], bio: "" };

  it("Save profile: no name and no devices + a stop-once box (changed in another tab) → the box; then the red mistakes; nothing saved", async () => {
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    await db.testerProfile.upsert({ where: { userId: t.user.id }, update: { devices: ["Windows PC"], languages: ["English"] }, create: { userId: t.user.id, devices: ["Windows PC"], languages: ["English"], categories: [] } });
    const seenAt = past();
    await logAccountChange(t.user.id, "tabA", { scopes: ["profile"], field: "bio", label: "Bio", before: "", after: "Roguelikes", side: "tester" });
    const bad = { ...base, name: "", devices: [], seenAt, tab: "tabB" };
    const first = await post(profilePOST, "/api/profile", t.cookie, bad);
    expect(code(first), JSON.stringify(first.body)).toEqual([409, "stop_once"]);
    const second = await post(profilePOST, "/api/profile", t.cookie, { ...bad, confirmed: true, boxAt: first.body.error && (first.body.error as { now?: string }).now });
    expect(code(second)).toEqual([400, "bad_name"]);
    expect((await db.user.findUniqueOrThrow({ where: { id: t.user.id } })).name).toBe("Ana Silva");
    // The mistake alone (no box): red only, nothing saved.
    const alone = await post(profilePOST, "/api/profile", t.cookie, { ...base, devices: [] });
    expect(code(alone)).toEqual([400, "bad_devices"]);
    expect((await db.testerProfile.findUniqueOrThrow({ where: { userId: t.user.id } })).devices).toEqual(["Windows PC"]);
  });

  it("the email setting: an unknown choice + a stop-once box → the box; then the red choice; nothing saved", async () => {
    const u = await makeUser({ dev: true });
    const seenAt = past();
    await logAccountChange(u.user.id, "tabA", { scopes: ["settings"], field: "emailPref", label: "Email", before: "Daily", after: "Off" });
    const first = await post(notifyPOST, "/api/account/notify", u.cookie, { emailPref: "hourly", seenAt, tab: "tabB" });
    expect(code(first), JSON.stringify(first.body)).toEqual([409, "stop_once"]);
    const second = await post(notifyPOST, "/api/account/notify", u.cookie, { emailPref: "hourly", seenAt, tab: "tabB", confirmed: true, boxAt: seen() });
    expect(code(second)).toEqual([400, "bad_pref"]);
    expect(code(await post(notifyPOST, "/api/account/notify", u.cookie, { emailPref: "hourly" }))).toEqual([400, "bad_pref"]);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.user.id } })).emailPref).not.toBe("hourly");
  });

  it("Change password: a short new password + a stop-once box → the box; then the red password; the password unchanged", async () => {
    const u = await makeUser({ dev: true });
    const seenAt = past();
    expect((await post(passwordPOST, "/api/auth/password", u.cookie, { password: "first-pass-1", confirm: "first-pass-1", seenAt, tab: "tabA" })).status).toBe(200);
    await settle();
    const hash = (await db.user.findUniqueOrThrow({ where: { id: u.user.id } })).passwordHash;
    const first = await post(passwordPOST, "/api/auth/password", u.cookie, { current: "first-pass-1", password: "short", confirm: "short", seenAt, tab: "tabB" });
    expect(code(first), JSON.stringify(first.body)).toEqual([409, "stop_once"]);
    const second = await post(passwordPOST, "/api/auth/password", u.cookie, { current: "first-pass-1", password: "short", confirm: "short", seenAt, tab: "tabB", confirmed: true, boxAt: seen() });
    expect(second.status).toBe(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.user.id } })).passwordHash).toBe(hash);
  });

  it("the pages send with fields still red (data-red-and-blue): the box or refusal shows with the red notes", () => {
    expect(src("app/app/profile/ProfileForm.tsx")).toContain('<form className="card space-y-5" onSubmit={save} data-red-and-blue="" noValidate>');
    expect(src("app/app/profile/PasswordForm.tsx")).toContain('data-red-and-blue=""');
    expect(src("app/app/notifications/AlertSettings.tsx")).toContain('data-red-and-blue=""');
  });
});
