"use client";
import { useEffect, useState } from "react";
import { PRESS_ERROR_EVENT } from "./client";

/**
 * (Owner, Oct 31, batch 35 §60) A refusal or stop line under a button goes once the page redraws with a NEW version of itself: the redraw in place (§40, the
 * §37 live redraw, AutoRefresh) keeps the boxes' state, so a line like "Answer the new terms first: Switch or Keep." stayed after the tester left or the test
 * ended. The page's version is what each AutoRefresh on it was drawn with (`v`, the same fingerprint its poll compares). When a line appears, its baseline
 * is the page's version on the server at that moment (each AutoRefresh's poll): the redraw that brings the very change the line is about is that version and
 * keeps the line; a later one clears it. A redraw that brings nothing new keeps it. A page without a fingerprint (Edit) keeps its lines as before.
 */
const shownBy = new Map<string, string>();
const sources = new Map<string, () => Promise<string | null>>();
const subs = new Set<() => void>();

/** Dispatched (with the message) whenever a press is refused or stopped (lib/client.ts api): the same line again shows again. */
export { PRESS_ERROR_EVENT };

/** One string for the page's versions (one per AutoRefresh on it). */
export const versionOf = (m: ReadonlyMap<string, string>) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([q, v]) => `${q}=${v}`).join("|");
/** The line's baseline is set and the page now shows another version: the line goes. */
export const isNewVersion = (base: string | undefined, now: string) => base !== undefined && base !== "" && now !== base;

export const shownVersion = () => versionOf(shownBy);
export function publishShownVersion(query: string, v: string) {
  if (shownBy.get(query) === v) return;
  shownBy.set(query, v);
  subs.forEach((f) => f());
}
export function setVersionSource(query: string, fetchV: () => Promise<string | null>) {
  sources.set(query, fetchV);
  return () => {
    if (sources.get(query) === fetchV) sources.delete(query);
    shownBy.delete(query);
  };
}
/** The page's version on the server now (the shown one where a check fails). */
export async function serverVersion() {
  const m = new Map(shownBy);
  await Promise.all([...sources].map(async ([q, f]) => {
    const v = await f().catch(() => null);
    if (v !== null) m.set(q, v);
  }));
  return versionOf(m);
}

/** (Owner, Nov 5, §207) The page's version on the server now, or null when any of its checks couldn't be read (offline, held back): never the shown one instead. */
export async function serverVersionOrNull() {
  const m = new Map(shownBy);
  let unread = false;
  await Promise.all([...sources].map(async ([q, f]) => {
    const v = await f().catch(() => null);
    if (v === null) unread = true;
    else m.set(q, v);
  }));
  return unread ? null : versionOf(m);
}

/**
 * The refusal's own redraw brings this server version; only a later shown version clears it.
 * (Owner, Nov 5, §207; bug in the Nov 4 recording R8c) When the server's version couldn't be read at that moment, the baseline was the version the page still
 * showed (from before the change the refusal is about), so the refusal's own redraw counted as a newer version and took the line away at once ("Your Accept
 * didn't go through: Ana Silva withdrew this request." never showed). Now the first version shown after the refusal is its own redraw (the baseline), and only a
 * later one clears it.
 */
export function watchNewPageVersion(onNew: () => void) {
  let alive = true;
  let base: string | undefined;
  let unread = false;
  const start = shownVersion();
  let firstNew: string | undefined;
  void serverVersionOrNull().then((v) => {
    if (!alive) return;
    if (v !== null) base = v;
    else {
      unread = true;
      base = firstNew;
    }
  });
  const onShown = () => {
    const now = shownVersion();
    if (base === undefined) {
      if (firstNew === undefined && now !== start) {
        firstNew = now;
        if (unread) base = now;
      }
      return;
    }
    if (isNewVersion(base, now)) onNew();
  };
  subs.add(onShown);
  return () => { alive = false; subs.delete(onShown); };
}

/** True once the page redrew with a new version after `what` (a line, a stop list) appeared. `text`: the line's words (the same refusal again shows again). */
export function useGoneOnNewVersion(what: unknown, text = ""): boolean {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    setGone(false);
    if (!what) return;
    let stopWatching = () => {};
    const arm = () => {
      stopWatching();
      stopWatching = watchNewPageVersion(() => setGone(true));
    };
    arm();
    const onErr = (e: Event) => {
      const m = (e as CustomEvent<string>).detail;
      if (text && m && text.includes(m)) { setGone(false); arm(); }
    };
    window.addEventListener(PRESS_ERROR_EVENT, onErr);
    return () => {
      stopWatching();
      window.removeEventListener(PRESS_ERROR_EVENT, onErr);
    };
  }, [what, text]);
  return gone && !!what;
}
