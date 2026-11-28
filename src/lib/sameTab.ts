import { TAB } from "./client";
import { BUSY_STALE_MS } from "./pageClaim";

/**
 * (Owner, Nov 28) The same browser tab moving on after its own press never waits for itself. `TAB` (lib/client.ts) is new on every full page load, so a press
 * that ends with one (Edit's Save, Post a test, Delete draft, Stop / End early, a session's Leave reload, ...) left the claim "busy" under the OLD load's id: the
 * old load never said "done" (it was gone), and the new load in the same tab waited for it ("Saving changes in other tab…" with "Open now", no other tab open).
 * Now the old load names itself in this tab's sessionStorage as it goes (pagehide), and the next load in this tab sends that id with its claim (`prev`): the server
 * lets it take the page at once when that old load still holds it (lib/server/pageClaim.ts claimPage). A genuinely different tab, browser or device never has
 * it, so it still waits for a press on its way (§380 J).
 * The note is read once per page (then removed), and only counts for BUSY_STALE_MS after it was written (after that a busy mark is stale anyway): a tab
 * duplicated later (Chrome copies sessionStorage) finds nothing, and the id named is always a load this tab no longer shows.
 */
export const PREV_TAB_KEY = "pt-prev-tab";
export const PREV_TAB_FOR_MS = BUSY_STALE_MS;

type Note = { tab: string; at: number };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const store = (): Store | null => {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // storage blocked: the old rules apply (the wait, at most the cap)
  }
};

/** This page's read of the note (undefined: not read yet). */
let read: Note | null | undefined;

/** This load is going (pagehide: a full navigation, a reload, closing, or the browser's memory): the next load in this tab may take its page at once. */
export function notePageLeft(s: Store | null = store(), tab = TAB, now = Date.now()) {
  if (!tab) return;
  try {
    s?.setItem(PREV_TAB_KEY, JSON.stringify({ tab, at: now } satisfies Note));
  } catch {
    // storage full or blocked
  }
  read = undefined; // back to this load from the browser's memory: read again (the load that came after may have named itself)
}

/** The id of the load this tab showed just before this one ("" when none, it's this load itself, or the note is too old). */
export function prevTab(s: Store | null = store(), tab = TAB, now = Date.now()): string {
  if (read === undefined) {
    read = null;
    try {
      const v = JSON.parse(s?.getItem(PREV_TAB_KEY) ?? "null") as Partial<Note> | null;
      s?.removeItem(PREV_TAB_KEY);
      if (v && typeof v.tab === "string" && v.tab && typeof v.at === "number") read = { tab: v.tab, at: v.at };
    } catch {
      read = null;
    }
  }
  if (!read || read.tab === tab) return "";
  const age = now - read.at;
  return age >= 0 && age < PREV_TAB_FOR_MS ? read.tab.slice(0, 64) : "";
}

let watching = false;
/** Once per page (OnePage): name this load in the tab as it goes. Never removed: a page left by the App Router may still hold a claim when the tab moves on. */
export function watchPageLeft() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  window.addEventListener("pagehide", () => notePageLeft());
}

/** Tests: a fresh page. */
export const resetSameTab = () => {
  read = undefined;
};
