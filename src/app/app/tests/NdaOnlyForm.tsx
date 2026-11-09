"use client";
import { useState } from "react";
import { usePress } from "@/lib/usePress";
import { ChangesBox } from "@/components/ChangesBox";
import { TheirsNote } from "@/components/FieldNote";
import { SAVED_ELSEWHERE } from "@/lib/editMerge";
import { NDA_ONLY_EDIT } from "@/lib/ndaEditing";
import { NdaCard } from "./NdaCard";

const clock = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/**
 * The NDA-only editor (a paused, held, suspended or stopped test: lib/ndaEditing.ts), its own page and Save. (Owner, Nov 9, §336) Its NDA is Edit's own card
 * (NdaCard): the same heading, lines, box, counter and red line; an NDA saved in another tab or device meanwhile shows in the card's notice slot as Edit's blue
 * "Saved in another tab or device at …" note with Use theirs.
 */
export function NdaOnlyForm(p: { id: string; version: number; ndaText: string; seenAt: string }) {
  const [text, setText] = useState(p.ndaText);
  const [version, setVersion] = useState(p.version);
  const [saved, setSaved] = useState(p.ndaText);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const press = usePress(p.seenAt, (data) => {
    if (typeof data.version === "number") setVersion(data.version);
    const current = data.current as { ndaText?: string } | undefined;
    if (typeof current?.ndaText === "string") { setSaved(current.ndaText); setSavedAt(new Date()); }
  });
  const theirs = saved !== p.ndaText && saved !== text;
  return <form className="panel space-y-3" data-red-and-blue="" noValidate onSubmit={async (e) => {
    e.preventDefault();
    const result = await press.press(`/api/tests/${p.id}/edit`, {
      ndaOnly: true, version, fields: { ndaText: text },
      base: { ndaText: saved }, has: { ndaText: text }, pageSeenAt: p.seenAt,
    });
    if (result) press.finish("NDA saved.", { reload: true });
  }}>
    <p className="info">{NDA_ONLY_EDIT} Saving it does not reopen the test or change payment dates.</p>
    <NdaCard value={text} saved={p.ndaText} disabled={press.busy} onChange={setText}
      note={theirs ? <TheirsNote heading={`${SAVED_ELSEWHERE} ${clock(savedAt ?? new Date())}`} items={[{ field: "ndaText", name: "NDA", value: saved, onUse: () => setText(saved) }]} /> : null} />
    <button className="btn" disabled={press.busy || text === saved}>{press.busy ? "Saving…" : "Save"}</button>
    {press.doneLine && <p className="ok">{press.doneLine}</p>}
    <ChangesBox changes={press.changes} error={press.error} press="Save" tail="Press Save again to save." />
  </form>;
}
