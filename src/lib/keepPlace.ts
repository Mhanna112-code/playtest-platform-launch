/**
 * (Owner, Oct 31, batch 35 §40) Keep your place after a press. A press that goes through redraws the page in place (router.refresh, see `useFinished` in
 * lib/usePress.ts): the scroll stays at the part pressed in, and a "#…" in the address (from a bell line, an email link or See it) is never jumped to again.
 * Where a full reload is truly needed (a backstop, the page's own "Refresh"), `reloadKeepingPlace` drops the stale "#…" first (HashJump would bring its target,
 * e.g. "Your parts", into view on load) and the page comes back where it was.
 */
export const PLACE_KEY = "pt-keep-place";
/** A kept place is put back only on the reload it was kept for (a few seconds later), never on a later visit. */
export const PLACE_FOR_MS = 15_000;

export type Place = { path: string; y: number; at: number };

type Win = Pick<Window, "scrollY" | "sessionStorage" | "history"> & { location: Pick<Location, "pathname" | "search" | "hash" | "reload"> };

/** The address without its "#…". */
export const withoutHash = (loc: Pick<Location, "pathname" | "search">) => loc.pathname + loc.search;

/** Reloads the page and comes back to the same place: the scroll is kept (sessionStorage, for this tab) and a "#…" in the address goes first. */
export function reloadKeepingPlace(w: Win = window) {
  const place: Place = { path: withoutHash(w.location), y: Math.round(w.scrollY), at: Date.now() };
  try {
    w.sessionStorage.setItem(PLACE_KEY, JSON.stringify(place));
  } catch {
    // storage blocked: the browser's own scroll restoration still applies
  }
  if (w.location.hash) {
    try {
      w.history.replaceState(w.history.state, "", place.path);
    } catch {
      // ignore: the reload still happens
    }
  }
  w.location.reload();
}

/** The scroll to put back on this load: a place kept a moment ago for this same address, else null. */
export function placeToRestore(raw: string | null, path: string, now = Date.now()): number | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<Place>;
    if (p.path !== path || typeof p.y !== "number" || typeof p.at !== "number") return null;
    if (now - p.at < 0 || now - p.at > PLACE_FOR_MS) return null;
    return p.y;
  } catch {
    return null;
  }
}

/** On load (HashJump): the place a keep-place reload left, put back once. True when it did (the page then doesn't jump to a "#…"). */
export function restorePlace(w: Win & Pick<Window, "scrollTo"> = window): boolean {
  let raw: string | null = null;
  try {
    raw = w.sessionStorage.getItem(PLACE_KEY);
    if (raw) w.sessionStorage.removeItem(PLACE_KEY);
  } catch {
    return false;
  }
  const y = placeToRestore(raw, withoutHash(w.location));
  if (y == null) return false;
  w.scrollTo({ top: y });
  return true;
}
