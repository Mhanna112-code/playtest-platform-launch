"use client";
import { SubscribersTag } from "@/components/SubscribeLink";
import { useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";
import { KeyRound, Pencil, Play, Repeat } from "lucide-react";
import { checkFields } from "@/components/FieldChecks";
import { FormMistakes } from "@/components/FormMistakes";
import { FIELD } from "@/lib/client";
import { CategoryBadges } from "@/components/Category";
import { PartBadges, StatusPill } from "@/components/Ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { AlertsMenu } from "@/components/AlertsMenu";
import { LIMITS } from "@/lib/limits";
import { OctagonX } from "lucide-react";

/** A working tester, for End early's rows and the Stop / End dialogs: what they sent, what is still to send, calls ahead. */
type Tester = { contractId: string; name: string; sent: string[]; toSend: string[]; ahead: number; /** Sent parts and held calls not paid or rejected yet (what still waits for review). */ waiting: string[] };

/**
 * The test page's top title panel: the developer's big buttons (Stop the test, End early, Next round).
 * Its stop-once box sits directly under this panel.
 */
export function TopPanel(p: { joinClosedLine?: string; id: string; title: string; status: string; terms: string; spotsLine: string; seenAt: string; working: Tester[]; nextRoundId: string | null; joinMode?: string; deadlineDays?: number; categories?: string[]; openUntil?: string | null; version?: number; productName?: string; mature?: boolean; nda?: boolean; keysLeft?: number | null; parts?: { written: boolean; recording: boolean; live: boolean }; paused?: boolean; ignoredAlerts?: string[]; restricted?: boolean; /** The team stopped it: no Next round either. */ teamStopped?: boolean; /** (Batch 8) false on the free plan: "Subscribers" on Next round */ perks?: boolean; /** (Owner, Oct 28 afternoon) every spot taken: "Full" instead of "Accepting testers" */ full?: boolean;
  /** (Batch 15 section 39) The Alerts types this state can still have (a paused or stopped test shows fewer); omitted: all. */ alertKeys?: string[];
  /** (Batch 15 section 29) After Stop / End early from the restricted view: on to the dashboard top with "Done: …". */ doneTo?: string }) {
  const { press, changes, error, busy, at } = usePress(p.seenAt);
  // (Batch 16 section 10) End early's mistakes are red at their box and listed under its button, not as a plain line.
  const box = (k: string) => (at === k ? <ChangesBox changes={changes} error={k === "end-early" && error.startsWith(FIELD) ? "" : error} didntGo={k === "stop" || k === "end-early"} /> : null);
  const [open, setOpen] = useState<"" | "end" | "next">("");
  // End early: the full app's ticks and "All", one reason, and a confirm dialog before it presses.
  const [picked, setPicked] = useState<string[]>([]);
  const [noTick, setNoTick] = useState(false);
  const [reason, setReason] = useState("");
  const [openErr] = useState("");
  const stopped = p.status === "stopped";
  const ahead = p.working.reduce((n, w) => n + w.ahead, 0);
  const chosen = p.working.filter((w) => picked.includes(w.contractId));
  const chosenAhead = chosen.reduce((n, w) => n + w.ahead, 0);
  const allPicked = p.working.length > 0 && picked.length === p.working.length;

  async function go(action: string, body: Record<string, unknown> = {}) {
    const r = await press<{ id?: string }>(`/api/tests/${p.id}/${action}`, body, action);
    if (!r) return;
    // (Owner, Oct 28 evening) Next round creates the draft and goes straight to Post a test with it.
    if (action === "next-round" && r.id) window.location.href = `/app/tests/new?draft=${r.id}`;
    // (Batch 15 section 29) A restricted developer's Stop / End early: the dashboard top says it's done.
    else if (p.doneTo && (action === "stop" || action === "end-early"))
      window.location.href = `${p.doneTo}?done=${encodeURIComponent(action === "stop" ? `Done: you stopped ${p.title}.` : `Done: you ended ${picked.length === 1 ? "1 tester's" : `${picked.length} testers'`} work on ${p.title}.`)}`;
    else window.location.reload();
  }

  return (
    <div className="space-y-2">
      {/* The full app's test header: title, badges (status; who can join, linking to Edit; deadline), then the actions. */}
      <section className="panel relative z-20 !space-y-5" aria-label="Test">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-[12rem] flex-1 space-y-2">
            {p.productName && <p className="kicker">{p.productName}</p>}
            <h1 className="text-3xl font-bold tracking-tight text-white">{p.title}</h1>
            <div className="flex flex-wrap gap-2">
              {p.paused && p.status !== "stopped" ? <span className="badge border-amber-300/40 text-amber-200">Paused</span> : <StatusPill status={p.status} full={p.full} />}
              {p.parts && <PartBadges written={p.parts.written} recording={p.parts.recording} live={p.parts.live} />}
              {p.mature && <span className="badge border-rose-300/40 text-rose-200">Mature (18+)</span>}
              {p.nda && <span className="badge">NDA</span>}
              {p.keysLeft != null && <span className="badge"><KeyRound className="h-3.5 w-3.5" /> {p.keysLeft} key{p.keysLeft === 1 ? "" : "s"} left</span>}
              <CategoryBadges categories={p.categories ?? []} />
              {p.joinMode && (
                <a href={`/app/tests/${p.id}/edit`} className={`badge no-underline hover:no-underline ${p.joinMode === "apply" ? "border-sky-300/40 text-sky-200" : ""}`} title="Change who can join in Edit">
                  {p.joinMode === "apply" ? "You approve each tester" : p.joinMode === "invite" ? "Invite only" : "Anyone who matches joins instantly"}
                </a>
              )}
            </div>
          </div>
          {/* The full app's header: the buttons at the top right (Edit, Next round, End early, Stop the test). */}
          {/* (Owner, Oct 28 evening) A stopped test shows only what still works: Alerts and Next round (it starts a new draft from this test); no Edit, End early or Stop. */}
          {(
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {!p.restricted && !stopped && <a className="btn-secondary px-3 py-1.5 text-sm no-underline hover:no-underline" href={`/app/tests/${p.id}/edit`}><Pencil className="h-4 w-4" /> Edit</a>}
              {(!p.restricted || p.alertKeys) && <AlertsMenu ignored={p.ignoredAlerts ?? []} keys={p.alertKeys} />}
              {p.restricted || p.teamStopped || p.status === "draft" ? null : p.nextRoundId ? (
                <a className="btn-secondary px-3 py-1.5 text-sm no-underline hover:no-underline" href={`/app/tests/${p.nextRoundId}`}><Repeat className="h-4 w-4" /> Go to the next round</a>
              ) : (
                <button className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setOpen(open === "next" ? "" : "next")}><Repeat className="h-4 w-4" /> Next round{p.perks === false && <SubscribersTag />}</button>
              )}
              {/* (Owner, Oct 28) A draft (a next round not opened yet) has no Next round and no End early. */}
              {p.status !== "draft" && !stopped && <button className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setOpen(open === "end" ? "" : "end")} disabled={p.working.length === 0}>
                End early
              </button>}
              {/* Stop the test: the full app's "Are you sure?" pop-up first; the stop-once box shows right under it. */}
              {!stopped && <ConfirmButton live className="btn-secondary px-3 py-1.5 text-sm text-rose-200" disabled={busy} title={`Are you sure you want to stop “${p.title}”?`} confirmLabel="Stop the test"
                body={(
                  <div className="space-y-2">
                    <p>{p.working.length ? <>The work of <strong className="text-white">{p.working.length === 1 ? "1 tester" : `${p.working.length} testers`}</strong> ends now.</> : "Nobody is working on it right now."}</p>
                    {p.working.length > 0 && (
                      <ul className="list-disc space-y-1 pl-5">
                        <li>What they&apos;ve sent still waits for you to pay.</li>
                        {p.working.some((w) => w.toSend.length > 0) && <li>The parts they haven&apos;t sent close with no pay.</li>}
                        {ahead > 0 && <li>{ahead === 1 ? "The call still ahead is" : `The ${ahead} calls still ahead are`} cancelled.</li>}
                      </ul>
                    )}
                    <p>The test stops for good: it takes no new testers and can&apos;t be edited or reopened. You can still read everything and pay what was sent.</p>
                    <p className="font-medium text-white">This can&apos;t be undone.</p>
                  </div>
                )}
                onConfirm={() => go("stop")}>
                <OctagonX className="h-4 w-4" /> Stop the test
              </ConfirmButton>}
              {box("stop")}
            </div>
          )}
        </div>
        {/* At the bottom right: the terms line, and "Open until" (folds out to change it, until it has passed). */}
        <div className="flex flex-wrap items-start justify-end gap-x-4 gap-y-1 text-right">
          <p className="text-xs text-slate-400">{p.terms} · {p.spotsLine}</p>
          {/* A draft (a next round not opened yet): the full app's "Accept testers again" row. */}
          {p.status === "draft" && !p.restricted && (
            <span className="flex flex-wrap items-center justify-end gap-3">
              <span className="text-xs text-slate-500">Hidden from new testers.</span>
              <button className="btn-secondary px-3 py-1.5 text-sm" disabled={busy} onClick={() => void go("open")}>
                <Play className="h-4 w-4" /> Accept testers again
              </button>
              {box("open")}
            </span>
          )}
          {/* (Owner, Oct 26) Open until is shown here as a date only; it changes through Edit. */}
          {/* (Batch 15 section 18) Open until is the last day to join; after it: "Joining closed · testers working until Dec 3". */}
          {p.openUntil && (p.joinClosedLine ? <p className="text-xs text-amber-200" data-joining-closed="">{p.joinClosedLine}</p> : <p className="text-xs text-slate-400" data-open-until="">Open until (last day to join) {new Date(p.openUntil).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</p>)}
        </div>
        {openErr && <p className="err">{openErr}</p>}
        {open === "end" && (
          <div className="space-y-3 rounded-lg border border-white/10 p-3 text-sm" data-end-early="" data-mistakes-root="">
            <fieldset id="end-early-testers" className="max-h-56 space-y-1.5 overflow-y-auto pr-1" aria-label="Testers still working" data-field-group="" data-match="tick at least one tester" data-red-msg={noTick ? "Tick at least one tester." : undefined}>
              <label className="flex items-center gap-2 text-slate-300"><input type="checkbox" checked={allPicked} onChange={(e) => { setNoTick(false); setPicked(e.target.checked ? p.working.map((w) => w.contractId) : []); }} /> All ({p.working.length})</label>
              {p.working.map((w) => (
                <label key={w.contractId} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-slate-200">
                  <input type="checkbox" checked={picked.includes(w.contractId)} onChange={(e) => { setNoTick(false); setPicked(e.target.checked ? [...picked, w.contractId] : picked.filter((x) => x !== w.contractId)); }} />
                  <strong className="text-white">{w.name}</strong>
                  <span className="text-xs text-slate-400">
                    {w.sent.length ? `sent the ${w.sent.join(" and ")}` : "nothing sent yet"}{w.toSend.length ? ` · still to send: ${w.toSend.join(" and ")}` : ""}{w.ahead ? ` · ${w.ahead} call${w.ahead === 1 ? "" : "s"} ahead` : ""}
                  </span>
                </label>
              ))}
            </fieldset>
            {noTick && <p className="err-field">Tick at least one tester.</p>}
            <div>
              <label className="label req" htmlFor="reason">Why? (each tester you tick reads it)</label>
              {/* (Owner, Oct 30, batch 15 section 22) Required, up to 10,000 characters with a counter; no 5-character minimum. */}
              <textarea id="reason" rows={3} className="input" placeholder="e.g. We have what we need for this build: thank you!" data-required="" data-required-msg="Say why you're ending their work (they read it)." data-match="ending their work|keep it to" value={reason} onChange={(e) => setReason(e.target.value)} />
              <p className={`text-xs ${reason.length > LIMITS.endEarlyReason ? "text-rose-300" : "text-slate-500"}`} data-end-count="">{reason.length.toLocaleString("en-US")} / {LIMITS.endEarlyReason.toLocaleString("en-US")}</p>
            </div>
            <p className="note">Their work ends now. What they already sent still waits for you to pay; calls ahead are cancelled.</p>
            <div>
              {(!reason.trim() || !picked.length) && <p className="text-xs text-slate-400" data-say-why="">{!picked.length ? "Tick at least one tester first" : "Say why first"}</p>}
              <ConfirmButton live className="btn-secondary px-3 py-1.5 text-sm text-rose-200" disabled={busy || !reason.trim() || !picked.length || reason.length > LIMITS.endEarlyReason} confirmLabel="End their work now"
                title={`End the work of ${chosen.length === 1 ? chosen[0].name : `${chosen.length} testers`} now?`}
                before={() => {
                  if (!picked.length) { setNoTick(true); return false; }
                  return checkFields(document.querySelector("[data-end-early]") as HTMLElement | null);
                }}
                body={(
                  <div className="space-y-2">
                    <ul className="list-disc space-y-1 pl-5">
                      <li>Their work ends now, and each tester is told, with your reason.</li>
                      <li>{chosen.some((w) => w.waiting.length)
                        ? <>What is waiting for you ({[...new Set(chosen.flatMap((w) => w.waiting))].join(", ")}) <strong className="text-white">stays waiting for your review</strong>: pay it as usual ($0 with a reason).</>
                        : <>Nothing they&apos;ve sent or held is waiting for review.</>}</li>
                      {chosen.some((w) => w.toSend.length) && <li>What they haven&apos;t sent closes with no pay.</li>}
                      {chosenAhead > 0 && <li>{chosenAhead === 1 ? "The call still ahead is" : `The ${chosenAhead} calls still ahead are`} cancelled.</li>}
                      <li>You can invite them back later.</li>
                    </ul>
                  </div>
                )}
                onConfirm={() => go("end-early", { contractIds: picked, reason })}>
                End their work now
              </ConfirmButton>
            </div>
            {box("end-early")}
            <FormMistakes text={at === "end-early" && error.startsWith(FIELD) ? error : ""} press="End their work now" />
          </div>
        )}
        {open === "next" && (
          <div className="space-y-2 rounded-lg border border-white/10 p-3">
            <p className="text-sm">A copy of this test for your next build, saved as a draft so you can put in the new build&apos;s link first.</p>
            <button className="btn" disabled={busy} onClick={() => go("next-round", {})}>Start the next round</button>
            {box("next-round")}
          </div>
        )}
      </section>
    </div>
  );
}
