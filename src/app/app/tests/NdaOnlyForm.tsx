"use client";
import { useState } from "react";
import { usePress } from "@/lib/usePress";
import { ChangesBox } from "@/components/ChangesBox";
import { CharacterCount } from "@/components/CharacterCount";
import { LIMITS } from "@/lib/limits";

export function NdaOnlyForm(p: { id: string; version: number; ndaText: string; seenAt: string }) {
  const [text, setText] = useState(p.ndaText);
  const [version, setVersion] = useState(p.version);
  const [saved, setSaved] = useState(p.ndaText);
  const press = usePress(p.seenAt, (data) => {
    if (typeof data.version === "number") setVersion(data.version);
    const current = data.current as { ndaText?: string } | undefined;
    if (typeof current?.ndaText === "string") setSaved(current.ndaText);
  });
  return <form className="panel space-y-3" onSubmit={async (e) => {
    e.preventDefault();
    const result = await press.press(`/api/tests/${p.id}/edit`, {
      ndaOnly: true, version, fields: { ndaText: text },
      base: { ndaText: saved }, has: { ndaText: text }, pageSeenAt: p.seenAt,
    });
    if (result) press.finish("NDA saved.", { reload: true });
  }}>
    <p className="info">Only the NDA can be edited while this test is paused or stopped. Saving it does not reopen the test or change payment dates.</p>
    <label className="label" htmlFor="ndaText">NDA (optional)</label>
    <p className="note">Leave blank for no NDA. Excerpts stay hidden while an NDA is present. Testers acknowledge changes separately; an edit does not mean they accepted it earlier.</p>
    <textarea id="ndaText" className="input" rows={6} maxLength={LIMITS.nda} value={text} disabled={press.busy} onChange={(e) => setText(e.target.value)} />
    <CharacterCount value={text} max={LIMITS.nda} />
    {saved !== p.ndaText && saved !== text && <div className="info"><p>Saved NDA:</p><p className="whitespace-pre-wrap">{saved || "No NDA"}</p><button type="button" className="btn-ghost" onClick={() => setText(saved)}>Use saved NDA</button></div>}
    <button className="btn" disabled={press.busy || text === saved}>{press.busy ? "Saving…" : "Save"}</button>
    {press.doneLine && <p className="ok">{press.doneLine}</p>}
    <ChangesBox changes={press.changes} error={press.error} press="Save" tail="Press Save again to save." />
  </form>;
}
