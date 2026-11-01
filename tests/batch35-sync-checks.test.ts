import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { joined, sact, setup } from "./fixtures";

const src = (f: string) => fs.readFileSync(path.join(process.cwd(), "src", f), "utf8");
/** The source without its comments (a comment may say what a line was before). */
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

// (Owner, Oct 31, batch 35 §37) One check, not two: the page redraw and the live "Updated" box move together.
describe("batch 35 §37: the page redraw and the Updated box move together", () => {
  let win: EventTarget;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
    win = new EventTarget();
    vi.stubGlobal("window", win);
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const lib = () => import("@/lib/liveSync");

  it("one 20-second timer drives both: the redraw's poll and the box's check run on the same beat", async () => {
    const L = await lib();
    const every = vi.spyOn(globalThis, "setInterval");
    const poll = vi.fn();
    const box = vi.fn();
    const leavePoll = L.rideLiveClock(); // AutoRefresh
    const leaveBox = L.rideLiveClock(); // LiveTop
    win.addEventListener(L.LIVE_TICK, poll);
    win.addEventListener(L.LIVE_TICK, box);
    expect(every).toHaveBeenCalledTimes(1);
    expect(L.liveClockTimers()).toBe(1);
    expect(L.LIVE_EVERY).toBe(20_000);
    vi.advanceTimersByTime(19_999);
    expect(poll).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect([poll.mock.calls.length, box.mock.calls.length]).toEqual([1, 1]);
    vi.advanceTimersByTime(40_000);
    expect([poll.mock.calls.length, box.mock.calls.length]).toEqual([3, 3]);
    // Two beats asked in the same moment (a refused press and a page shown again) are one tick.
    vi.advanceTimersByTime(1000);
    L.liveBeat();
    L.liveBeat();
    expect(poll).toHaveBeenCalledTimes(4);
    leavePoll();
    expect(L.liveClockTimers()).toBe(1); // the box still rides it
    leaveBox();
    expect(L.liveClockTimers()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(poll).toHaveBeenCalledTimes(4);
    every.mockRestore();
  });

  it("a new box line redraws the page at once and shows as the redraw lands, together", async () => {
    const L = await lib();
    const redraw = vi.fn(() => true);
    const off = L.onBoxLines(redraw); // the page's redraw driver (AutoRefresh / JoinWatch)
    const sync = L.boxSync();
    const apply = vi.fn();
    const started = Date.now();
    vi.advanceTimersByTime(200); // the check's request
    sync.lines(started, apply);
    expect(redraw).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled(); // held: the rows haven't changed yet
    expect(sync.holding()).toBe(true);
    vi.advanceTimersByTime(400);
    sync.drawn(); // the redraw lands
    expect(apply).toHaveBeenCalledWith(true);
    expect(sync.holding()).toBe(false);
    // A second driver on the page (the join page with an invite) doesn't redraw twice for one ask.
    const other = vi.fn(() => true);
    const off2 = L.onBoxLines(other);
    vi.advanceTimersByTime(5000);
    sync.lines(Date.now(), vi.fn());
    expect(redraw.mock.calls.length + other.mock.calls.length).toBe(2);
    off();
    off2();
    sync.stop();
  });

  it("the poll's redraw of the same beat carries the line: no second redraw; a redraw during the check shows it at once", async () => {
    const L = await lib();
    const redraw = vi.fn(() => true);
    const off = L.onBoxLines(redraw);
    const sync = L.boxSync();
    const started = Date.now();
    L.noteRedrawAsked(); // AutoRefresh's poll found a new fingerprint and redraws
    vi.advanceTimersByTime(150);
    const apply = vi.fn();
    sync.lines(started, apply);
    expect(redraw).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    sync.drawn();
    expect(apply).toHaveBeenCalledWith(true);
    // The page drew while the check was out: shown at once, nothing asked.
    vi.advanceTimersByTime(5000);
    const started2 = Date.now();
    vi.advanceTimersByTime(100);
    sync.drawn();
    vi.advanceTimersByTime(100);
    const apply2 = vi.fn();
    sync.lines(started2, apply2);
    expect(apply2).toHaveBeenCalledWith(true);
    expect(redraw).not.toHaveBeenCalled();
    off();
  });

  it("nothing on the page redraws (Edit's watch-only poll, the bank's check open): the line shows at once; a redraw that never lands lets it show after 3 s", async () => {
    const L = await lib();
    const sync = L.boxSync();
    const now = vi.fn();
    const offEdit = L.onBoxLines(() => false);
    sync.lines(Date.now(), now);
    expect(now).toHaveBeenCalledWith(false);
    offEdit();
    const off = L.onBoxLines(() => true);
    vi.advanceTimersByTime(5000);
    const late = vi.fn();
    sync.lines(Date.now(), late);
    vi.advanceTimersByTime(L.HOLD_FOR_REDRAW - 1);
    expect(late).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(late).toHaveBeenCalledWith(false);
    off();
  });

  it("the wiring: LiveTop checks whenever the page redraws and asks for a redraw on new lines; AutoRefresh and JoinWatch answer; no component keeps its own 20 s timer", () => {
    const top = code("components/LiveTop.tsx");
    // A redraw (a new server render time) shows held lines and checks at once.
    expect(top).toContain("drawnWith.current = seenAt;");
    expect(top).toMatch(/sync\.drawn\(\);\s*void check\.current\(\);\s*\}, \[seenAt, sync\]\);/);
    expect(top).toContain("else sync.lines(started, apply);");
    expect(top).toContain("const leave = rideLiveClock();");
    expect(top).toContain("window.addEventListener(LIVE_TICK, onTick);");
    expect(top).not.toContain("setInterval");
    expect(top).not.toMatch(/everys*=|every?:/); // its own rhythm is gone
    // (Batch 35 §90) The seen rule: shown on the page = seen.
    expect(top).toContain("if (added.length) setShownOnPage(scope, r.now);");
    const auto = code("components/AutoRefresh.tsx");
    expect(auto).not.toContain("setInterval");
    expect(auto).toContain("window.addEventListener(LIVE_TICK, onBeat);");
    expect(auto).toMatch(/onBoxLines\(\(\) => \{\s*if \(!alive \|\| !refresh \|\| bankCheckOpen\(\) \|\| restrictedNow\.current\) return false;\s*router\.refresh\(\);\s*return true;/);
    expect(auto).toMatch(/noteRedrawAsked\(\);[^\n]*\n\s*router\.refresh\(\);/); // the poll's own redraw: the box's line of that beat waits for it
    const join = code("app/app/find/[id]/JoinWatch.tsx");
    expect(join).not.toContain("setInterval");
    expect(join).toContain("window.addEventListener(LIVE_TICK, check);");
    expect(join).toContain("onBoxLines(");
    // JoinBox doesn't redraw a second time for listing lines that came with the redraw.
    expect(code("app/app/find/[id]/JoinBox.tsx")).toContain("afterChanges(added, announcedWithRedraw());");
    // Every page with the box has a redraw driver riding the same clock.
    expect(src("app/app/tests/[id]/page.tsx")).toContain("<AutoRefresh query={`test=${t.id}`} v={pageV} />");
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("<AutoRefresh query={`session=${c.id}`} v={pageV} />");
    expect(src("app/app/find/[id]/page.tsx")).toContain("<JoinWatch testId={t.id} v={joinFp} />");
    expect(src("app/app/page.tsx")).toContain('<AutoRefresh query="invites=1" v={invitesFp} />');
  });
});

// (Owner, Oct 31, batch 35 §38) No "Files and recordings" box under the tester's written answers: files go in each answer with 📎.
describe("batch 35 §38: no Files and recordings box under the written answers", () => {
  it("the box is gone from the session page; the answers' 📎, its preview and × stay; files in no answer are listed with ×", () => {
    expect(fs.existsSync(path.join(process.cwd(), "src/app/app/sessions/[id]/WrittenAttachments.tsx"))).toBe(false);
    const page = code("app/app/sessions/[id]/page.tsx");
    expect(page).not.toContain("WrittenAttachments");
    const form = code("app/app/sessions/[id]/SessionActions.tsx");
    for (const gone of ["Files and recordings", "Attach a file (images, PDF, text or zip; 500 MB each, 5 at most) or a video", "Record your screen", "written-files:"]) expect(form).not.toContain(gone);
    expect(form).toContain('title="Attach a file">📎');
    expect(form).toContain("onRemove={(id) => { onChange(removeAttachmentMarker(value, id, attachments)); onRemove(id); }}");
    expect(form).toContain("const loose = attachments.filter((a) => ![...answers, notes].some((t) => hasMarkerFor(t, a.id, attachments)));");
    expect(form).toContain("Files not in an answer (they go with your answers when you send them):");
    expect(form).toContain("onClick={() => removeAttachment(a.id)}>×</button>");
    // The recorded part keeps its own recorder (with its microphone choice).
    expect(src("app/app/sessions/[id]/RecordingUpload.tsx")).toContain("<ScreenRecorder");
    expect(src("components/ScreenRecorder.tsx")).toContain("With my microphone");
    // Older answers whose files were only in that box still show them on every view (the sent view, the developer's piece, admin See the work).
    expect(page).toContain("<AttachmentList items={c.recordings.filter((r) => r.part === \"written\" && r.uploadedAt && r.submissionId === written.id)} />");
  });

  it("the limits hold through 📎's upload (the written part): 5 files, 5 recordings, 500 MB each", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const start = (body: Record<string, unknown>) => sact(j.sessionId, "recording-start", j.tester.cookie, { part: "written", ...body });
    expect((await start({ filename: "big.png", size: 500 * 1024 * 1024 + 1, contentType: "image/png" })).body.error.message).toBe("Files can be at most 500 MB.");
    expect((await start({ filename: "big.mp4", size: 500 * 1024 * 1024 + 1, contentType: "video/mp4" })).body.error.message).toBe("Recordings can be at most 500 MB.");
    for (let i = 0; i < 5; i++) {
      const f = await start({ filename: `f${i}.png`, size: 100, contentType: "image/png" });
      expect(f.status).toBe(200);
      const v = await start({ filename: `v${i}.mp4`, size: 100, contentType: "video/mp4" });
      expect(v.status).toBe(200);
    }
    expect((await start({ filename: "six.png", size: 100, contentType: "image/png" })).body.error.message).toBe("You can attach at most 5 files to your written answers.");
    expect((await start({ filename: "six.mp4", size: 100, contentType: "video/mp4" })).body.error.message).toBe("You can attach at most 5 recordings to your written answers.");
  });
});
