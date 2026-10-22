"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client";

/**
 * Join sends the listing version the tester saw. If the listing changed since, the first press stops and shows the new
 * terms; the second press joins on them. Closed, stopped or full tests refuse for good.
 */
export function JoinBox({ testId, listingVersion }: { testId: string; listingVersion: number }) {
  const [version, setVersion] = useState(listingVersion);
  const [keepPrivate, setKeepPrivate] = useState(false);
  const [changed, setChanged] = useState<{ terms: string; questions: string[] } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ sessionId: string }>(`/api/tests/${testId}/join`, { listingVersion: version, keepPrivate, confirmed: changed != null });
      window.location.href = `/app/sessions/${r.sessionId}`;
    } catch (e) {
      if (e instanceof ApiError && e.code === "listing_changed") {
        setChanged({ terms: String(e.data.terms), questions: (e.data.questions as string[]) ?? [] });
        setVersion(Number(e.data.listingVersion));
      } else {
        setChanged(null);
        setErr((e as Error).message);
      }
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm">
        <input type="checkbox" checked={keepPrivate} onChange={(e) => setKeepPrivate(e.target.checked)} /> I&apos;ll keep this build and what I see private
      </label>
      <button className="btn" disabled={busy} onClick={join}>{busy ? "Joining…" : "Join this test"}</button>
      {changed && (
        <div className="info" role="status">
          <p className="font-medium">The developer changed this test since you opened it. The new terms:</p>
          <p>{changed.terms}</p>
          {changed.questions.length > 0 && (
            <ul className="list-disc pl-5">
              {changed.questions.map((q) => <li key={q}>{q}</li>)}
            </ul>
          )}
          <p>Press Join again to join on these terms.</p>
        </div>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
