import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PUT as uploadPUT } from "@/app/api/recordings/[id]/upload/route";
import { GET as fileGET } from "@/app/api/recordings/[id]/file/route";
import { parseRange } from "@/lib/server/storage";
import { PLACE_FOR_MS, PLACE_KEY, placeToRestore, reloadKeepingPlace, restorePlace } from "@/lib/keepPlace";
import { DONE_HOLD_MS, releaseIn } from "@/lib/usePress";
import { encodeSize, HEAD_BYTES, webmDurationMs, webmWithDuration, withDuration } from "@/lib/webmDuration";
import { req } from "./helpers";
import { joined, sact, setup } from "./fixtures";

const src = (f: string) => fs.readFileSync(path.join(process.cwd(), "src", f), "utf8");
/** The source without its comments (a comment may say what a line was before). */
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const walk = (dir: string): string[] =>
  fs.readdirSync(path.join(process.cwd(), "src", dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []));

function fakeWindow(opts: { path?: string; search?: string; hash?: string; y?: number; store?: Map<string, string> } = {}) {
  const store = opts.store ?? new Map<string, string>();
  const w = {
    scrollY: opts.y ?? 0,
    location: { pathname: opts.path ?? "/app/sessions/s1", search: opts.search ?? "", hash: opts.hash ?? "", reload: vi.fn() },
    history: { state: { k: 1 }, replaceState: vi.fn((_s: unknown, _t: string, url: string) => { w.location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : ""; }) },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    scrollTo: vi.fn(),
  };
  return { w, store };
}

// (Owner, Oct 31, batch 35 §40) Keep your place after a press.
describe("batch 35 §40: keep your place after a press", () => {
  it("no press on the app's pages reloads the whole page: they redraw in place (finish), and the few full reloads keep their place", () => {
    const files = [...walk("app/app"), ...walk("components"), ...walk("app/admin")];
    const reloading = files.filter((f) => code(f).includes("window.location.reload()"));
    // Only SessionWatch's own two: a side switch in another tab (the page moves to the other side) and a restriction that just began on the dashboard (to its top).
    expect(reloading).toEqual(["components/SessionWatch.tsx"]);
    expect(code("components/SessionWatch.tsx").match(/window\.location\.reload\(\)/g)).toHaveLength(2);
    // The presses the owner named: the tester's session page and the developer's test page.
    for (const [f, n] of [
      ["app/app/sessions/[id]/RecordingUpload.tsx", 3], ["app/app/sessions/[id]/SessionActions.tsx", 3], ["app/app/sessions/[id]/ChoiceBox.tsx", 1], ["app/app/tests/[id]/PayBox.tsx", 1],
      ["app/app/tests/[id]/DevCallPanel.tsx", 2], ["app/app/tests/[id]/Applications.tsx", 1], ["app/app/tests/[id]/InvitePanel.tsx", 2], ["app/app/tests/[id]/TopPanel.tsx", 1],
      ["components/CallRequests.tsx", 1], ["components/CallRequestsPanel.tsx", 1], ["components/RateBox.tsx", 1], ["components/ScreenRecorder.tsx", 1], ["components/PressButton.tsx", 1],
    ] as const) expect((code(f).match(/\bfinish\(/g) ?? []).length, f).toBeGreaterThanOrEqual(n);
    // Invite no longer jumps to "#invite" after it went through.
    expect(code("app/app/tests/[id]/InvitePanel.tsx")).not.toContain('window.location.hash = "invite"');
    // The in-place redraw is the router's refresh, inside a transition (so the box knows when it landed).
    const lib = code("lib/usePress.ts");
    expect(lib).toContain("startRefresh(() => router.refresh());");
    expect(lib).toContain("setTimeout(() => reloadKeepingPlace(), result ? DONE_RELOAD_MS : 0);");
    // The last-resort reloads keep their place too.
    for (const f of ["components/AutoRefresh.tsx", "components/ShellWatch.tsx", "components/SessionWatch.tsx", "app/app/sessions/[id]/TesterTop.tsx", "app/app/find/[id]/JoinBox.tsx"]) expect(code(f), f).toContain("reloadKeepingPlace()");
  });

  it("a full reload drops the stale #… first and comes back at the same scroll", () => {
    const { w, store } = fakeWindow({ path: "/app/sessions/s1", search: "?x=1", hash: "#parts", y: 1234.6 });
    reloadKeepingPlace(w as never);
    expect(w.history.replaceState).toHaveBeenCalledWith({ k: 1 }, "", "/app/sessions/s1?x=1");
    expect(w.location.reload).toHaveBeenCalledTimes(1);
    const kept = JSON.parse(store.get(PLACE_KEY)!);
    expect([kept.path, kept.y]).toEqual(["/app/sessions/s1?x=1", 1235]);
    // No hash: the address is left as it is.
    const plain = fakeWindow({ y: 10 });
    reloadKeepingPlace(plain.w as never);
    expect(plain.w.history.replaceState).not.toHaveBeenCalled();
    // On the load that follows (HashJump), the place is put back once, and the #… is never jumped to.
    const after = fakeWindow({ path: "/app/sessions/s1", search: "?x=1", store });
    expect(restorePlace(after.w as never)).toBe(true);
    expect(after.w.scrollTo).toHaveBeenCalledWith({ top: 1235 });
    expect(store.has(PLACE_KEY)).toBe(false);
    expect(restorePlace(after.w as never)).toBe(false);
    expect(src("components/HashJump.tsx")).toContain("if (!restorePlace()) go();");
  });

  it("a kept place is only for the reload it was kept for: the same address, a few seconds later", () => {
    const now = Date.parse("2026-10-31T12:00:00Z");
    const raw = JSON.stringify({ path: "/app/tests/t1", y: 900, at: now - 2000 });
    expect(placeToRestore(raw, "/app/tests/t1", now)).toBe(900);
    expect(placeToRestore(raw, "/app/tests/t2", now)).toBeNull();
    expect(placeToRestore(raw, "/app/tests/t1", now + PLACE_FOR_MS)).toBeNull();
    expect(placeToRestore(null, "/app/tests/t1", now)).toBeNull();
    expect(placeToRestore("{oops", "/app/tests/t1", now)).toBeNull();
  });
});

// (Owner, Oct 31, batch 35 §41) A finished press stays finished.
describe("batch 35 §41: a finished press stays finished until the page has redrawn", () => {
  it("one helper: usePress stays busy (every button greyed) from finish until the redraw has landed and the line has shown", () => {
    const lib = code("lib/usePress.ts");
    expect(lib).toContain("busy: busy || fin.done");
    expect(lib).toContain("export function useFinished(onFresh?: () => void)");
    // The box lets go only when the transition is over (the redraw landed) and the result line has had its time.
    expect(lib).toMatch(/if \(refreshing \|\| !w\) return;/);
    expect(releaseIn(Date.now() + 500)).toBeGreaterThan(0);
    expect(releaseIn(Date.now() - 1)).toBe(0);
    expect(DONE_HOLD_MS).toBeGreaterThanOrEqual(600);
    // The presses with their own busy state use the same helper.
    for (const f of ["app/app/sessions/[id]/ChoiceBox.tsx", "app/app/sessions/[id]/RecordingUpload.tsx", "app/app/sessions/[id]/SessionActions.tsx", "app/app/sessions/[id]/TesterTop.tsx", "app/admin/AdminButton.tsx", "app/admin/DisputeDecision.tsx", "app/admin/PagedList.tsx", "components/OwedBox.tsx", "components/ChargebackSteps.tsx", "components/BlockButton.tsx", "components/Excerpts.tsx", "app/app/NoThanks.tsx", "app/app/DismissRemoved.tsx"])
      expect(code(f), f).toContain("useFinished(");
  });

  it("Pay more: the amount, note and ticks are hidden and the button stays greyed with “Paid $10.00 more to <name>.”; after the redraw it's empty again", () => {
    const pay = code("app/app/tests/[id]/PayBox.tsx");
    expect(pay).not.toContain("setTimeout(");
    expect(pay).toContain("more ? `Paid ${money(res.amountCents)} more to ${p.name}.` : `Paid ${money(res.amountCents)} to ${p.name}.`");
    expect(pay).toContain("{!done && <>");
    expect(pay).toContain("{!done && cents != null && cents > 0 && (");
    expect(pay).toContain("{!done && over && (");
    expect(pay).toContain("<PressDone line={doneLine} />");
    expect(pay).toContain("onFresh: () => { emptyBox(); setPayKey(newPressId()); }");
    expect(pay).toMatch(/disabled=\{busy \|\| bank\.open/);
  });

  it("the other boxes hide their inputs while finished: Charge, dispute, Add your side, Rate, the admin buttons and Decide", () => {
    expect(code("app/app/sessions/[id]/ChoiceBox.tsx")).toContain("{fin.done ? (");
    expect(code("app/app/sessions/[id]/SessionActions.tsx")).toContain('fin.finish("Your dispute is sent to the team.");');
    expect(code("app/app/tests/[id]/DisputeSide.tsx")).toContain("{!sent && <textarea");
    const rate = code("components/RateBox.tsx");
    expect(rate).toContain("{!done && <select");
    expect(rate).toContain("{!done && <input");
    const admin = code("app/admin/AdminButton.tsx");
    expect(admin).toContain("{!fin.done && fields.map((f) =>");
    expect(admin).toContain('fin.finish("Done.", { reload: true });');
    expect(admin).toContain("disabled={busy || disabled || fin.done}");
    expect(code("app/admin/DisputeDecision.tsx")).toContain("{fin.done ? (");
    expect(code("app/admin/PagedList.tsx")).toContain('fin.finish("Approved.", { reload: true });');
    // No "Done" line next to a live-looking button any more.
    for (const f of ["app/admin/AdminButton.tsx", "app/admin/DisputeDecision.tsx", "app/admin/PagedList.tsx", "components/OwedBox.tsx", "components/ChargebackSteps.tsx", "components/BankWaiting.tsx"])
      expect(code(f), f).not.toMatch(/setTimeout\(\(\) => window\.location/);
    expect(code("components/PressDone.tsx")).toContain('data-press-done=""');
  });
});

/** A small WebM head as MediaRecorder writes it: EBML header, a Segment of unknown size, Info without a Duration, Tracks, then a Cluster. */
function recorderHead(opts: { segmentSize?: number; infoExtra?: number[]; seekHead?: boolean } = {}) {
  const el = (id: number[], body: number[]) => [...id, ...encodeSize(body.length, 1)!, ...body];
  const ebml = el([0x1a, 0x45, 0xdf, 0xa3], [...el([0x42, 0x82], [...Buffer.from("webm")])]);
  const info = el([0x15, 0x49, 0xa9, 0x66], [...el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]), ...el([0x4d, 0x80], [...Buffer.from("Chrome")]), ...(opts.infoExtra ?? [])]);
  const tracks = el([0x16, 0x54, 0xae, 0x6b], [0xae, 0x83, 0xd7, 0x81, 0x01]);
  const cluster = [0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x81, 0x00, 0xa3, 0x84, 0x81, 0x00, 0x00, 0x80];
  const body = [...(opts.seekHead ? el([0x11, 0x4d, 0x9b, 0x74], [0x4d, 0xbb, 0x80]) : []), ...info, ...tracks, ...cluster];
  const segSize = opts.segmentSize == null ? [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff] : [...encodeSize(opts.segmentSize, 2)!];
  return new Uint8Array([...ebml, 0x18, 0x53, 0x80, 0x67, ...segSize, ...body]);
}

// (Owner, Oct 31, batch 35 §42) Recordings can be scrubbed.
describe("batch 35 §42: recordings can be scrubbed", () => {
  it("a browser recording gets its length written into its Info (the rest of the file unchanged)", async () => {
    const head = recorderHead();
    expect(webmDurationMs(head)).toBeNull();
    const out = withDuration(head, 83_250)!;
    expect(out.length).toBe(head.length + 11);
    expect(webmDurationMs(out)).toBeCloseTo(83_250, 6);
    // The Cluster that follows is byte for byte the same.
    expect(Buffer.from(out.subarray(out.length - 21)).equals(Buffer.from(head.subarray(head.length - 21)))).toBe(true);
    // A Blob: only its head is patched; a big tail goes as it is.
    const tail = new Uint8Array(HEAD_BYTES + 5000).map((_, i) => i % 251);
    const blob = new Blob([head, tail], { type: "video/webm" });
    const fixed = await webmWithDuration(blob, 83_250);
    expect(fixed.size).toBe(blob.size + 11);
    expect(fixed.type).toBe("video/webm");
    const bytes = new Uint8Array(await fixed.arrayBuffer());
    expect(webmDurationMs(bytes.subarray(0, 4096))).toBeCloseTo(83_250, 6);
    expect(Buffer.from(bytes.subarray(bytes.length - 1000)).equals(Buffer.from(tail.subarray(tail.length - 1000)))).toBe(true);
  });

  it("a known Segment size grows with it; a Duration of 0 is written over; a real one is kept; anything unknown is left alone", async () => {
    const sized = recorderHead({ segmentSize: 300 });
    const out = withDuration(sized, 5000)!;
    expect(webmDurationMs(out)).toBeCloseTo(5000, 6);
    const segSizeAt = 4 + 1 + 7 + 4; // EBML header (4 + 1 + 7), the Segment ID
    expect(((out[segSizeAt] & 0x3f) << 8) | out[segSizeAt + 1]).toBe(311);
    const zero = recorderHead({ infoExtra: [0x44, 0x89, 0x88, 0, 0, 0, 0, 0, 0, 0, 0] });
    const z = withDuration(zero, 2000)!;
    expect(z.length).toBe(zero.length);
    expect(webmDurationMs(z)).toBeCloseTo(2000, 6);
    expect(withDuration(z, 9999)).toBe(z); // already there: kept
    expect(withDuration(recorderHead({ seekHead: true }), 2000)).toBeNull(); // its positions would move
    expect(withDuration(new Uint8Array([1, 2, 3, 4]), 2000)).toBeNull();
    expect(withDuration(recorderHead(), 0)).toBeNull();
    const notWebm = new Blob([new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])], { type: "video/mp4" });
    expect(await webmWithDuration(notWebm, 1000)).toBe(notWebm);
    // An Info whose 1-byte size no longer fits takes an 8-byte size.
    const big = recorderHead({ infoExtra: [0xec, 0x80 + 102, ...Array(102).fill(0)] }); // an Info of 120 bytes: 131 needs a longer size
    const b2 = withDuration(big, 1000)!;
    expect(b2.length).toBe(big.length + 11 + 7);
    expect(webmDurationMs(b2)).toBeCloseTo(1000, 6);
    expect(code("components/ScreenRecorder.tsx")).toContain('await webmWithDuration(new Blob(chunks, { type: "video/webm" }), startedAt ? performance.now() - startedAt : 0)');
  });

  it("the Range header: one range, open-ended, a suffix, clamped; several ranges or other units serve the whole file; outside the file is refused", () => {
    expect(parseRange(null, 100)).toBe("none");
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=0-1,5-6", 100)).toBe("none");
    expect(parseRange("items=0-1", 100)).toBe("none");
    expect(parseRange("bytes=100-", 100)).toBe("bad");
    expect(parseRange("bytes=9-3", 100)).toBe("bad");
    expect(parseRange("bytes=-0", 100)).toBe("bad");
    expect(parseRange("bytes=0-", 0)).toBe("bad");
  });

  it("the local file route answers byte ranges: 206 Partial Content with Content-Range, Accept-Ranges on every answer, 416 outside the file", async () => {
    const { dev, testId } = await setup({ recordingCents: "15.00" });
    const { tester, sessionId } = await joined(testId);
    const content = "0123456789abcdefghij";
    const start = await sact(sessionId, "recording-start", tester.cookie, { filename: "run.webm", size: content.length, contentType: "video/webm" });
    const { recordingId, uploadUrl } = start.body;
    expect((await uploadPUT(new Request(`http://localhost:3400${uploadUrl}`, { method: "PUT", headers: { cookie: tester.cookie }, body: content }), { params: Promise.resolve({ id: recordingId }) })).status).toBe(200);
    await sact(sessionId, "recording-done", tester.cookie, { recordingId });
    const get = (range?: string) => fileGET(req(`/api/recordings/${recordingId}/file`, { cookie: dev.cookie, headers: range ? { range } : {} }), { params: Promise.resolve({ id: recordingId }) });
    const whole = await get();
    expect(whole.status).toBe(200);
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(whole.headers.get("content-length")).toBe("20");
    expect(await whole.text()).toBe(content);
    const part = await get("bytes=5-9");
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 5-9/20");
    expect(part.headers.get("content-length")).toBe("5");
    expect(part.headers.get("content-type")).toBe("video/webm");
    expect(await part.text()).toBe("56789");
    const rest = await get("bytes=15-");
    expect([rest.status, rest.headers.get("content-range"), await rest.text()]).toEqual([206, "bytes 15-19/20", "fghij"]);
    const last = await get("bytes=-3");
    expect(await last.text()).toBe("hij");
    const bad = await get("bytes=50-60");
    expect([bad.status, bad.headers.get("content-range")]).toEqual([416, "bytes */20"]);
    // Still only the people who may watch it.
    expect((await fileGET(req(`/api/recordings/${recordingId}/file`, { headers: { range: "bytes=0-3" } }), { params: Promise.resolve({ id: recordingId }) })).status).toBe(404);
  });
});
