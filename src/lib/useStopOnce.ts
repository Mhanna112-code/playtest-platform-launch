"use client";
import { useState } from "react";
import { ApiError } from "./client";
import { pageLoadedAt } from "./live";
import { offerStop } from "./topStop";
import type { Change } from "@/components/ChangesBox";

/**
 * (Owner, Nov 5, §271) A press outside the panels' usePress (Join call, Block, Report, an excerpt request, a chat message): it sends the page's load time (`seenAt`,
 * else the load PageLoaded noted: never the browser's own clock), so a pause or the team's lift of it since then stops it once; its box shows under the button and the
 * next press goes ahead (`confirmed`, with the box's time). A page with neither sends nothing and never stops (as before).
 * (Owner, Dec 10 2026) The same mechanism as every other stop: ChangesBox draws it as the one line on a page whose top box takes its changes (lib/stopLine.ts),
 * and the line (or box) clears the moment the button is pressed again (`marks`), the box's time kept for that second press.
 */
export function useStopOnce(seenAt?: string) {
  const [box, setBox] = useState<{ changes: Change[]; at: string; shown: boolean } | null>(null);
  /** What the press adds to its body. (Owner, Dec 10 2026) Called as the button is pressed: the line under it clears until the new outcome. */
  const marks = (): Record<string, unknown> => {
    if (box) {
      if (box.shown) setBox({ ...box, shown: false });
      return { confirmed: true, boxAt: box.at };
    }
    const loaded = seenAt || pageLoadedAt();
    return loaded ? { seenAt: loaded } : {};
  };
  /** A stop: its box shows (true). Anything else: false (the caller shows the refusal). */
  const stopped = (e: unknown) => {
    if (!(e instanceof ApiError) || e.code !== "stop_once") return false;
    setBox({ changes: (e.data.changes as Change[]) ?? [], at: typeof e.data.now === "string" ? e.data.now : new Date().toISOString(), shown: true });
    offerStop(e.data);
    return true;
  };
  return { box: box?.shown ? box.changes : null, marks, stopped, clear: () => setBox(null) };
}
