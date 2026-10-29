import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { adminPage } from "@/lib/server/adminLists";
import { notify } from "@/lib/server/notify";
import { STOP_NOTE_KIND, stopEventText, stopNoteText, stopReasonOf } from "@/lib/rules";
import { LIMITS } from "@/lib/limits";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, seen, setup } from "./fixtures";

// Batch 17 §15: Stop the test needs a reason testers read (like End early's): required, up to 10,000, on the tester's session page and in the email, never in the bell line;
// in the developer's Contract changes and the admin's timeline; a paused or restricted developer's Stop needs it too; the team's Stop keeps its own note, never shown to testers.

// The email lines go through notify(email, bellLine, emailLines, …): watch them (the real notify still runs).
vi.mock("@/lib/server/notify", async (orig) => {
  const real = await orig<typeof import("@/lib/server/notify")>();
  return { ...real, notify: vi.fn(real.notify) };
});
const notifyMock = vi.mocked(notify);
beforeEach(() => {
  notifyMock.mockClear();
});

const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "../src", p), "utf8");
async function admin() {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}
const aact = (cookie: string, action: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);
const stop = (testId: string, cookie: string, more: Record<string, unknown>) => act(testId, "stop", cookie, { seenAt: seen(), confirmed: true, ...more });
const mark = () => `zq${randomUUID().slice(0, 8)}`;

describe("the server: a required reason (section 15)", () => {
  it("empty or blank is refused with End early's style of line; nothing stops", async () => {
    const { dev, testId } = await setup();
    const { sessionId } = await joined(testId);
    for (const reason of [undefined, "", "   \n "]) {
      const r = await stop(testId, dev.cookie, reason === undefined ? {} : { reason });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatchObject({ code: "bad_reason", message: "Say why you're stopping the test (testers read it)." });
    }
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).status).not.toBe("stopped");
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("working");
  });

  it("at most 10,000 characters: one more is refused (never cut); 10,000 goes through", async () => {
    const { dev, testId } = await setup();
    const { sessionId } = await joined(testId);
    expect(LIMITS.stopReason).toBe(10_000);
    const r = await stop(testId, dev.cookie, { reason: "w".repeat(10_001) });
    expect(r.body.error).toMatchObject({ code: "bad_reason", message: "Keep it to 10,000 characters." });
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).status).not.toBe("stopped");
    expect((await stop(testId, dev.cookie, { reason: "w".repeat(10_000) })).status).toBe(200);
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).endReason).toHaveLength(10_000);
  });

  it("stored on every stopped contract (endReason and a note in their contract changes) and in the test's timeline; one character is enough", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Okafor", "he");
    const why = `We found what we needed ${mark()}.`;
    expect((await stop(testId, dev.cookie, { reason: `  ${why}  ` })).status).toBe(200); // trimmed, like End early's
    for (const id of [a.sessionId, b.sessionId]) {
      const c = await db.contract.findUniqueOrThrow({ where: { id } });
      expect(c).toMatchObject({ status: "ended", endKind: "stopped", endReason: why });
      const notes = await db.contractNote.findMany({ where: { contractId: id, kind: STOP_NOTE_KIND } });
      expect(notes.map((n) => n.text)).toEqual([`Test stopped: “${why}”`]);
      expect(stopReasonOf(notes[0].text)).toBe(why);
    }
    const ev = await db.testEvent.findFirstOrThrow({ where: { testId, kind: "stopped" } });
    expect(ev.text).toBe(`The developer stopped the test: “${why}”`);
    expect(stopReasonOf(ev.text)).toBe(why);
    // Nobody working: still required, still recorded on the test.
    const s2 = await setup();
    expect((await stop(s2.testId, s2.dev.cookie, { reason: "Wrap" })).body.error.message).toBe("Say a little more: at least 5 characters."); // (batch 20 section 27)
    expect((await stop(s2.testId, s2.dev.cookie, { reason: "Wrap!" })).status).toBe(200);
    expect((await db.testEvent.findFirstOrThrow({ where: { testId: s2.testId, kind: "stopped" } })).text).toBe(stopEventText("Wrap!"));
  });

  it("the helpers: older stops and other lines carry no reason", () => {
    expect(stopNoteText("Done")).toBe("Test stopped: “Done”");
    expect(stopEventText("Done")).toBe("The developer stopped the test: “Done”");
    expect(stopReasonOf("Test stopped: “Line one\nline “two””")).toBe("Line one\nline “two”");
    for (const old of ["The test was stopped", "The team stopped this test", "The test was closed", "Renamed: “A” → “B”"]) expect(stopReasonOf(old)).toBe("");
  });
});

describe("what testers read (section 15)", () => {
  it("the email has the reason in full; the bell line never does", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId, "Ana Silva");
    const MARK = mark();
    const why = `Thanks all ${MARK}. ${"Long notes. ".repeat(400)}`.trim();
    expect((await stop(testId, dev.cookie, { reason: why })).status).toBe(200);
    const call = notifyMock.mock.calls.find((c) => c[0] === a.tester.user.email && c[1] === "“Harbor Run” was stopped");
    expect(call).toBeTruthy();
    expect(call![2]).toEqual([`Nora Lane stopped “Harbor Run”: “${why}”`, "Your work on it has ended. Work you already sent is still reviewed and paid. Calls ahead are cancelled."]);
    expect(call![3]).toBe(`/app/sessions/${a.sessionId}`);
    expect(await db.notification.count({ where: { userId: a.tester.user.id, text: "“Harbor Run” was stopped" } })).toBe(1);
    expect(await db.notification.count({ where: { text: { contains: MARK } } })).toBe(0);
  });

  it("the session page: in italics in a scroll box under the stopped line (only the developer's own Stop, marked by its note); the history and dashboard show it the same way", () => {
    const page = src("app/app/sessions/[id]/page.tsx");
    const block = page.slice(page.indexOf('id="stopped-line"'), page.indexOf("</div>}", page.indexOf('id="stopped-line"')));
    expect(block).toContain('c.status === "ended" && c.endKind === "stopped" && c.endReason && contractNotes.some((n) => n.kind === STOP_NOTE_KIND) && <ReasonQuote text={c.endReason} />');
    expect(page).toContain("Test stopped`}<ReasonQuote text={stopReasonOf(n.text)} />");
    expect(src("app/app/page.tsx")).toContain("Test stopped<ReasonQuote text={stopReasonOf(n.text)} />");
    // ReasonQuote is the italic scroll box End early's reason uses.
    expect(src("components/ScrollText.tsx")).toMatch(/export function ReasonQuote[\s\S]*overflow-y-auto[\s\S]*italic/);
  });
});

describe("the developer's Stop pop-up (section 15)", () => {
  it("a required Why? like End early's (the same box): N / 10,000, and Stop disabled with “Say why first” until it has text", () => {
    const top = src("app/app/tests/[id]/TopPanel.tsx");
    expect(top).toContain('<WhyBox id="stop-reason" label="Why? (testers read it)"');
    expect(top).toContain('requiredMsg="Say why you\'re stopping the test (testers read it)."'); // the server's own line
    expect(src("lib/server/tests.ts")).toContain("\"Say why you're stopping the test (testers read it).\"");
    expect(top).toContain("max={LIMITS.stopReason}");
    expect(top).toContain('confirmDisabled={busy || !stopReady} confirmHint={!stopReason.trim() ? "Say why first" : undefined}');
    expect(top).toContain('go("stop", { reason: stopReason })');
    expect(top).toContain('<WhyBox id="reason" label="Why? (each tester you tick reads it)"'); // End early uses the same box
    const why = src("components/WhyBox.tsx");
    expect(why).toContain('{value.length.toLocaleString("en-US")} / {max.toLocaleString("en-US")}');
    const confirm = src("components/ConfirmButton.tsx");
    expect(confirm).toContain("disabled={confirmDisabled}");
    expect(confirm).toContain('{confirmDisabled && confirmHint && <p className="mt-3 text-right text-xs text-slate-400" data-say-why="">{confirmHint}</p>}');
    // One TopPanel for both views: the restricted (paused) view's Stop is the same pop-up.
    expect((src("app/app/tests/[id]/page.tsx").match(/<TopPanel\b/g) ?? []).length).toBe(2);
  });

  it("the developer's Contract changes shows the Stop and its reason; each stopped tester's contract changes too", () => {
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page).toContain("<ContractChanges entries={changeEntries} stop={stopEntry}");
    expect(page).toContain("Test stopped · {fmtDateTime(n.createdAt)}<ReasonQuote text={stopReasonOf(n.text)} />");
    const cc = src("app/app/tests/[id]/ContractChanges.tsx");
    expect(cc).toContain("{fmt(stop.at)} · You stopped the test</p>");
    expect(cc).toContain("<ReasonQuote text={stop.reason} />");
  });

  it("the admin's test timeline shows the reason", async () => {
    const a = await admin();
    const { dev, testId } = await setup();
    await joined(testId);
    const why = `Build is broken ${mark()}`;
    expect((await stop(testId, dev.cookie, { reason: why })).status).toBe(200);
    const page = (await adminPage("t-timeline", a.user.id, null, testId)) as { rows: { text: string }[] };
    expect(page.rows.some((r) => r.text.endsWith(`The developer stopped the test: “${why}”`))).toBe(true);
  });
});

describe("a paused or restricted developer's Stop needs it too (section 15)", () => {
  for (const cause of ["team-paused", "hold", "suspended"] as const) {
    it(`${cause}: refused without a reason, goes through (silently) with one, and the testers read it`, async () => {
      const { dev, testId } = await setup();
      const a = await joined(testId);
      await bookCall(testId, dev.cookie, a.sessionId, a.tester.cookie, 72);
      if (cause === "team-paused") expect((await aact((await admin()).cookie, "pause-test", { id: testId, note: "Checking" })).status).toBe(200);
      else await db.user.update({ where: { id: dev.user.id }, data: cause === "hold" ? { holdStartedAt: new Date(), holdReason: "failed" } : { devSuspendedAt: new Date() } });
      // (Batch 29 §11: a paused page's presses stop once for news too) The database clock can run a few ms ahead of this process: let the setup's events settle first.
      await new Promise((r) => setTimeout(r, 40));
      const loaded = seen();
      const none = await act(testId, "stop", dev.cookie, { seenAt: loaded });
      expect(none.body.error).toMatchObject({ code: "bad_reason", message: "Say why you're stopping the test (testers read it)." });
      const long = await act(testId, "stop", dev.cookie, { seenAt: loaded, reason: "w".repeat(10_001) });
      expect(long.body.error.message).toBe("Keep it to 10,000 characters.");
      expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).status).not.toBe("stopped");
      const why = `Pausing for good ${mark()}`;
      expect((await act(testId, "stop", dev.cookie, { seenAt: loaded, reason: why })).status).toBe(200);
      expect((await db.contract.findUniqueOrThrow({ where: { id: a.sessionId } })).endReason).toBe(why);
      expect(await db.contractNote.count({ where: { contractId: a.sessionId, kind: STOP_NOTE_KIND } })).toBe(1);
    });
  }
});

describe("the team's Stop is unchanged (section 15)", () => {
  it("its note is never shown to testers: no stop note, a neutral endReason, and neither the bell nor the email carries it", async () => {
    const a = await admin();
    const { dev, testId } = await setup();
    const t = await joined(testId);
    const MARK = mark();
    expect((await aact(a.cookie, "stop-test", { id: testId, note: `Policy ${MARK}` })).status).toBe(200);
    const c = await db.contract.findUniqueOrThrow({ where: { id: t.sessionId } });
    expect(c).toMatchObject({ status: "ended", endKind: "stopped", endReason: "The test was stopped." });
    expect(await db.contractNote.count({ where: { contractId: t.sessionId, kind: STOP_NOTE_KIND } })).toBe(0);
    expect(stopReasonOf((await db.testEvent.findFirstOrThrow({ where: { testId, kind: "stopped" } })).text)).toBe("");
    const toTester = notifyMock.mock.calls.filter((x) => x[0] === t.tester.user.email);
    expect(toTester.length).toBeGreaterThan(0);
    for (const x of toTester) expect(JSON.stringify(x)).not.toContain(MARK);
    expect(await db.notification.count({ where: { userId: t.tester.user.id, text: { contains: MARK } } })).toBe(0);
    // The developer still reads it (their banner and email), as before.
    expect(notifyMock.mock.calls.some((x) => x[0] === dev.user.email && x[2].some((l) => l.includes(MARK)))).toBe(true);
    // The developer's own Stop is refused afterwards (unchanged), reason or not.
    expect((await stop(testId, dev.cookie, { reason: "Also stopping" })).status).toBe(409);
  });
});
