import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  refresh: vi.fn(),
  setBack: vi.fn(),
  busy: vi.fn(() => true),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: (effect: () => void | (() => void)) => m.effects.push(effect),
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value, m.setBack],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("@/lib/pageBusy", () => ({ pageBusy: m.busy, watchTyping() {} }));
vi.mock("@/lib/liveSync", () => ({ LIVE_TICK: "live-tick", rideLiveClock: () => () => {}, noteRedrawAsked() {}, onBoxLines: () => () => {} }));
import { JoinWatch } from "@/app/app/find/[id]/JoinWatch";

let page: EventTarget & { location: { href: string } };
let doc: { visibilityState: string };
let cleanup: (() => void)[];
const fetchMock = vi.fn();
function mount() {
  JoinWatch({ testId: "harbor", v: "initial" });
  cleanup = m.effects.map((effect) => effect()).filter((fn): fn is () => void => typeof fn === "function");
}
const tick = () => page.dispatchEvent(new Event("live-tick"));
const reply = (v: string, back: { line: string; href: string } | null) => ({ ok: true, json: async () => ({ v, back }) });

beforeEach(() => {
  vi.clearAllMocks();
  m.effects = [];
  cleanup = [];
  page = Object.assign(new EventTarget(), { location: { href: "/app/find/harbor" } });
  doc = { visibilityState: "visible" };
  vi.stubGlobal("window", page);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup.forEach((fn) => fn());
  vi.unstubAllGlobals();
});

describe("accepted rejoin follows the session like Join", () => {
  it.each(["changed", "initial"])("opens the accepted session even with a busy page and fingerprint %s", async (version) => {
    const back = { line: "You're back in Harbor Run", href: "/app/sessions/restored" };
    fetchMock.mockResolvedValue(reply(version, back));
    mount();
    tick();
    await vi.waitFor(() => expect(page.location.href).toBe(back.href));
    expect(m.setBack).toHaveBeenCalledWith(back);
    expect(m.refresh).not.toHaveBeenCalled();
    expect(m.busy).not.toHaveBeenCalled();
  });

  it("waiting and declined changes redraw once, without navigating", async () => {
    fetchMock.mockResolvedValue(reply("declined", null));
    mount();
    tick();
    await vi.waitFor(() => expect(m.refresh).toHaveBeenCalledTimes(1));
    tick();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(page.location.href).toBe("/app/find/harbor");
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it("waits until a hidden tab is visible, then follows on focus", async () => {
    fetchMock.mockResolvedValue(reply("accepted", { line: "You're in Harbor Run", href: "/app/sessions/new" }));
    doc.visibilityState = "hidden";
    mount();
    tick();
    expect(fetchMock).not.toHaveBeenCalled();
    doc.visibilityState = "visible";
    page.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(page.location.href).toBe("/app/sessions/new"));
  });

  it("a response arriving after leaving the page cannot navigate or redraw", async () => {
    let finish!: (value: unknown) => void;
    const json = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    fetchMock.mockResolvedValue({ ok: true, json });
    mount();
    tick();
    await vi.waitFor(() => expect(json).toHaveBeenCalled());
    cleanup.forEach((fn) => fn());
    cleanup = [];
    finish({ v: "accepted", back: { line: "You're back", href: "/app/sessions/old" } });
    await Promise.resolve();
    await Promise.resolve();
    expect(page.location.href).toBe("/app/find/harbor");
    expect(m.refresh).not.toHaveBeenCalled();
    expect(m.setBack).not.toHaveBeenCalled();
  });
});
