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
let IGNORED: string[] | null = null;
const TESTER_EVENT = "tester-alerts";
const DEV_EVENT = "dev-alerts";
const STORE = "pt-alerts";

function broadcast(data: { off?: boolean; ignored?: string[] }) {
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

const same = (a: string[] | null, b: string[]) => !!a && a.length === b.length && a.every((x) => b.includes(x));
export const ignoredAlertsNow = () => IGNORED;
/** The developer's Alerts (the types they're not stopped for) as saved or heard from the server: the menu, every stop box's chips and (`share`) the other tabs follow. */
export function publishIgnoredAlerts(ignored: string[], share = true) {
  const changed = !same(IGNORED, ignored);
  IGNORED = [...ignored];
  if (typeof window === "undefined" || (!changed && !share)) return;
  window.dispatchEvent(new CustomEvent(DEV_EVENT, { detail: { ignored: IGNORED } }));
  if (share) broadcast({ ignored: IGNORED });
}

/** Another tab of this browser saved one of the settings. */
function onStorage(e: StorageEvent) {
  if (e.key !== STORE || !e.newValue) return;
  try {
    const d = JSON.parse(e.newValue) as { off?: unknown; ignored?: unknown };
    if (typeof d.off === "boolean") publishTesterAlertsOff(d.off, false);
    if (Array.isArray(d.ignored)) publishIgnoredAlerts(d.ignored.map(String), false);
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

/** The developer's ignored types as shown now. `start`: what the page was drawn with (it seeds the tab; a refreshed page's newer value replaces it). */
export function useIgnoredAlerts(start?: string[]): string[] {
  const [list, setList] = useState<string[]>(() => start ?? IGNORED ?? []);
  const key = start ? JSON.stringify([...start].sort()) : "";
  useEffect(() => {
    const on = (e: Event) => setList([...((e as CustomEvent<{ ignored: string[] }>).detail?.ignored ?? [])]);
    window.addEventListener(DEV_EVENT, on);
    listen();
    if (key) {
      const drawn = JSON.parse(key) as string[];
      setList(drawn);
      publishIgnoredAlerts(drawn, false);
    } else if (IGNORED) setList(IGNORED);
    return () => window.removeEventListener(DEV_EVENT, on);
  }, [key]);
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
