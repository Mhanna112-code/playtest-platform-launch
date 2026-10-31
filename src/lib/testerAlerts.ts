import { useEffect, useState } from "react";

/**
 * (Owner, Oct 28, batch 17 section 13) Whether this tester's Alerts is Off, as this tab last heard it: from the server with each stop box (`alertsOff`), from the
 * Alerts button on the session page, and from "Turn off alerts" in a box. The tester's stop box drops "Turn off alerts" and "You can turn these stops off below"
 * while it's Off.
 *
 * (Batch 20 section 8, bug found by the owner) One setting, wherever it shows. The developer's "Don't stop me for: Call changes" chip DID save (the server had the
 * type), but the Alerts menu kept the ticks it was first drawn with (its own state, seeded once and never told; a refresh of the page doesn't reset it), so it
 * still showed Call changes unticked, and its next tick would have saved its old list over the chip's. Now both settings live here: every chip, menu and toggle
 * reads them, and every save publishes the saved value (an event in this tab, a storage event in this browser's other tabs, and the pages' 20-second poll
 * everywhere else).
 */
let OFF: boolean | null = null;
/** (Owner, Oct 31, batch 35 §73) The developer's Alerts belong to each test: the ticks heard per test id. */
const IGNORED = new Map<string, string[]>();
const TESTER_EVENT = "tester-alerts";
const DEV_EVENT = "dev-alerts";
const STORE = "pt-alerts";

function broadcast(data: { off?: boolean; ignored?: string[]; testId?: string }) {
  try {
    window.localStorage.setItem(STORE, JSON.stringify({ ...data, at: Date.now() }));
  } catch {
    // storage blocked: the other tabs pick it up on their poll
  }
}

export const setTesterAlertsOff = (off: boolean) => {
  OFF = off;
};
export const testerAlertsAreOff = () => OFF === true;
/** The tester's Alerts as saved or heard from the server: every toggle and box chip in this tab follows, and (`share`, after a save here) this browser's other tabs. */
export function publishTesterAlertsOff(off: boolean, share = true) {
  const changed = OFF !== off;
  OFF = off;
  if (typeof window === "undefined" || (!changed && !share)) return;
  window.dispatchEvent(new CustomEvent(TESTER_EVENT, { detail: { off } }));
  if (share) broadcast({ off });
}

const same = (a: string[] | undefined, b: string[]) => !!a && a.length === b.length && a.every((x) => b.includes(x));
export const ignoredAlertsNow = (testId: string) => IGNORED.get(testId) ?? null;
/** (Batch 35 §73) The test a stop box's "Don't stop me for" chips save on: the test page's or Edit's, from the address ("" on any other page: no chips). */
export function alertsTestNow(): string {
  if (typeof window === "undefined" || !window.location) return "";
  const id = /^\/app\/tests\/([^/?#]+)/.exec(window.location.pathname)?.[1] ?? "";
  return id === "new" ? "" : id;
}
/** One test's developer Alerts (the types they're not stopped for there) as saved or heard from the server: that test's menu, every stop box's chips and
 * (`share`) the other tabs follow. Another test's ticks are never touched. */
export function publishIgnoredAlerts(testId: string, ignored: string[], share = true) {
  if (!testId) return;
  const changed = !same(IGNORED.get(testId), ignored);
  IGNORED.set(testId, [...ignored]);
  if (typeof window === "undefined" || (!changed && !share)) return;
  window.dispatchEvent(new CustomEvent(DEV_EVENT, { detail: { testId, ignored: [...ignored] } }));
  if (share) broadcast({ testId, ignored: [...ignored] });
}

/** Another tab of this browser saved one of the settings. */
function onStorage(e: StorageEvent) {
  if (e.key !== STORE || !e.newValue) return;
  try {
    const d = JSON.parse(e.newValue) as { off?: unknown; ignored?: unknown; testId?: unknown };
    if (typeof d.off === "boolean") publishTesterAlertsOff(d.off, false);
    if (Array.isArray(d.ignored) && typeof d.testId === "string") publishIgnoredAlerts(d.testId, d.ignored.map(String), false);
  } catch {
    // ignore
  }
}
let listening = false;
function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("storage", onStorage);
}

/** One test's developer ignored types as shown now. `start`: what the page was drawn with (it seeds the tab; a refreshed page's newer value replaces it), and
 * the other tests' ticks never reach it. */
export function useIgnoredAlerts(testId: string, start?: string[]): string[] {
  const [list, setList] = useState<string[]>(() => start ?? IGNORED.get(testId) ?? []);
  const key = start ? JSON.stringify([...start].sort()) : "";
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ testId: string; ignored: string[] }>).detail;
      if (d?.testId === testId) setList([...(d.ignored ?? [])]);
    };
    window.addEventListener(DEV_EVENT, on);
    listen();
    if (key) {
      const drawn = JSON.parse(key) as string[];
      setList(drawn);
      publishIgnoredAlerts(testId, drawn, false);
    } else setList(IGNORED.get(testId) ?? []);
    return () => window.removeEventListener(DEV_EVENT, on);
  }, [key, testId]);
  return list;
}

/** The tester's Alerts Off as shown now (`start`: what the page was drawn with). */
export function useTesterAlertsOff(start?: boolean): boolean {
  const [off, setOff] = useState<boolean>(() => start ?? OFF === true);
  useEffect(() => {
    const on = (e: Event) => setOff(!!(e as CustomEvent<{ off: boolean }>).detail?.off);
    window.addEventListener(TESTER_EVENT, on);
    listen();
    if (start !== undefined) {
      setOff(start);
      publishTesterAlertsOff(start, false);
    } else if (OFF !== null) setOff(OFF);
    return () => window.removeEventListener(TESTER_EVENT, on);
  }, [start]);
  return off;
}
