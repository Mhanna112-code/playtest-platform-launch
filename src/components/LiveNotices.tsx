"use client";
import { useEffect, useRef, useState } from "react";
import type { Change } from "@/components/ChangesBox";
import { JustUpdated } from "@/components/GapDialog";
import { LongList } from "@/components/LongList";
import { mergeChanges, useLiveAppend } from "@/lib/live";

/**
 * (Owner, Oct 26) Live blue notices inside a confirm pop-up (Stop, End early) or the Invite anyway box: while it is open, each change the page picks up
 * is listed here as it arrives, newest first: the 3 newest, then "Show N more", in the same "Just updated" style as the page's live boxes. A confirm
 * pressed with changes it has not seen still stops once, as before.
 */
export function LiveNotices({ open }: { open: boolean }) {
  const [lines, setLines] = useState<Change[]>([]);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) setLines([]); // a fresh opening starts empty
    wasOpen.current = open;
  }, [open]);
  useLiveAppend(open, (added) => setLines((old) => mergeChanges(old, added)));
  if (!open || !lines.length) return null;
  const newest = [...lines].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="info basis-full" role="status" aria-live="polite" data-live-notices="">
      <LongList className="space-y-1" tall="max-h-52">
        {newest.map((c, i) => (
          <li key={`${c.at}|${c.text}|${i}`}><JustUpdated at={c.at} /> {c.text}</li>
        ))}
      </LongList>
    </div>
  );
}
