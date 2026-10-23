import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, money, pronouns } from "@/lib/format";
import { callOutcome, joinedWords, callJoinable, bookedLateLabel, isBookedLate, callReference, cancelNeedsReason, chargeAmount, defaultCallMinutes, choiceNoteLine, closesInLine, lateLabel, termsLine } from "@/lib/rules";
import { requirePageUser } from "@/lib/server/page-auth";
import { asListing, writtenQuestions } from "@/lib/server/tests";
import { Chat } from "@/components/Chat";
import { DevCallPanel, type DevCall, type DevTester } from "./DevCallPanel";
import { CallLength } from "./CallLength";
import { InvitePanel } from "./InvitePanel";
import { invitable, inviteExpired } from "@/lib/server/invites";
import { owedForBox, sweepHeldCalls } from "@/lib/server/holds";
import { paidLines } from "@/lib/server/paid";
import { termsRowLines } from "@/lib/server/terms";
import { BlockButton } from "@/components/BlockButton";
import { RateBox } from "@/components/RateBox";
import { contractRatings, rateBlocker, ratingSummary } from "@/lib/server/ratings";
import { LiveTop } from "@/components/LiveTop";
import { qOptional, qText } from "@/lib/questions";
import { Users } from "lucide-react";
import { Applications } from "./Applications";
import { rateLabel } from "@/lib/server/requests";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DisputeSide } from "./DisputeSide";
import { OwedBox } from "@/components/OwedBox";
import { PayBox } from "./PayBox";
import { TopPanel } from "./TopPanel";
import { ByQuestion } from "./ByQuestion";
import { byQuestion } from "@/lib/byQuestion";

export const metadata = { title: "Test · Playtest" };
export const dynamic = "force-dynamic";

export default async function TestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; offered?: string; skipped?: string; closed?: string; resent?: string; spotclosed?: string; spots?: string }> }) {
  await (await import("@/lib/server/calls")).sweepNobodyJoined();
  const { id } = await params;
  const { saved, offered, skipped, closed, resent } = await searchParams;
  const u = await requirePageUser();
  const seenAt = new Date().toISOString();
  const t = await db.test.findUnique({
    where: { id },
    include: {
      contracts: {
        orderBy: { joinedAt: "asc" },
        include: {
          tester: true,
          submissions: { include: { review: true, dispute: true, recordings: true }, orderBy: { sentAt: "asc" } },
          calls: { include: { review: true, dispute: true, slot: true }, orderBy: { startsAt: "asc" } },
        },
      },
    },
  });
  if (!t || t.developerId !== u.id) notFound();
  const next = await db.test.findFirst({ where: { previousId: id }, select: { id: true } });
  const working = t.contracts.filter((c) => c.status === "working");
  const paid = await db.payment.groupBy({ by: ["contractId"], where: { contractId: { in: t.contracts.map((c) => c.id) }, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } });
  const paidSoFar = (id: string) => paid.find((p) => p.contractId === id)?._sum.amountCents ?? 0;
  await sweepHeldCalls(u.id);
  const paidKinds = await paidLines(t.contracts.map((c) => c.id));
  const termsRows = await termsRowLines(t.contracts.map((c) => c.id));
  const reqs = await db.callRequest.findMany({ where: { testId: id, status: "pending", startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } });
  // A developer batch sent to several testers shows once per tester; that's fine: each copy is that tester's.
  const msgs = await db.message.findMany({ where: { testId: id }, orderBy: { createdAt: "asc" }, include: { sender: true }, take: 2000 });
  const pendingApps = await db.application.findMany({ where: { testId: id, status: "pending" }, orderBy: { createdAt: "asc" } });
  const appUsers = await db.user.findMany({ where: { id: { in: pendingApps.map((a) => a.testerId) } }, include: { profile: true } });
  const appRatings = new Map(await Promise.all(appUsers.map(async (x) => [x.id, (await ratingSummary(x.id)).line] as const)));
  const invitedIds = (await db.invite.findMany({ where: { testId: id, status: "sent" } })).map((i) => i.testerId);
  const preJoin = await db.user.findMany({ where: { id: { in: [...pendingApps.map((a) => a.testerId), ...invitedIds] } } });
  const apps = pendingApps.map((a) => {
    const x = appUsers.find((y) => y.id === a.testerId)!;
    return { id: a.id, userId: x.id, name: displayName(x), note: a.note, profile: [...(x.profile?.devices ?? []), ...(x.profile?.languages ?? []), ...(appRatings.get(x.id) ? [appRatings.get(x.id)!] : [])].join(", ") };
  });
  const blockedIds = new Set((await db.block.findMany({ where: { blockerId: u.id } })).map((b) => b.blockedId));
  const blockedBy = new Set((await db.block.findMany({ where: { blockedId: u.id } })).map((b) => b.blockerId));
  const [testers, invites, owedList] = await Promise.all([invitable(u.id, id), db.invite.findMany({ where: { testId: id, status: { in: ["sent", "joined"] } }, orderBy: { createdAt: "desc" } }), owedForBox(u.id)]);
  const people = new Map((await db.user.findMany({ where: { id: { in: invites.map((i) => i.testerId) } } })).map((x) => [x.id, displayName(x)]));
  const expired = inviteExpired(t);
  const soon = t.openUntil && t.openUntil > new Date() && t.openUntil.getTime() - Date.now() < 3 * 86_400_000;
  const now = new Date();
  const lateOf = (c: { dueAt: Date; tester: { name: string; email: string } }, x: { createdAt: Date }) => (isBookedLate(x.createdAt, c.dueAt) ? bookedLateLabel(displayName(c.tester), c.dueAt, (d) => fmtDate(d).replace(/, \d{4}$/, "")) : undefined);
  const partPaid = (id: string) => payments.filter((p) => (p.submissionId === id || p.callId === id) && (p.status === "charged" || p.status === "not_set_up")).reduce((a, p) => a + p.amountCents, 0);
  const payments = await db.payment.findMany({ where: { contractId: { in: t.contracts.map((c) => c.id) } }, orderBy: { createdAt: "asc" } });
  // The developer's live-call panel: one row per working tester (terms like the parts listing) and their calls/requests.
  const whole = (c: number | null) => money(c).replace(/\.00$/, "");
  const devTesters: DevTester[] = working.map((c) => {
    const subOf = (kind: string) => c.submissions.find((x) => x.kind === kind);
    const part = (label: string, cents: number | null, kind: string) => {
      if (cents == null) return null;
      const sub = subOf(kind);
      return sub ? `${label} sent, paid ${whole(partPaid(sub.id))} of ${whole(cents)}` : `${label} not sent`;
    };
    const callPaid = payments.filter((x) => x.contractId === c.id && x.callId && (x.status === "charged" || x.status === "not_set_up")).reduce((a, x) => a + x.amountCents, 0);
    const terms = [
      `due ${fmtDate(c.dueAt).replace(/, \d{4}$/, "")}`,
      part("Written", c.writtenCents, "written"),
      part("Recording", c.recordingCents, "recording"),
      c.liveRateCents != null ? `Live call ${whole(c.liveRateCents)}/h, ${whole(callPaid)} paid so far` : "Live call not in contract",
    ].filter(Boolean).join(" · ");
    const toCall = (x: (typeof c.calls)[number]): DevCall => ({ id: x.id, joinable: callJoinable(x, now), when: x.startsAt.toISOString(), minutes: x.minutes, rate: rateLabel(x.rateCents, c.liveRateCents), canCancel: !cancelNeedsReason(x.startsAt, now), started: x.startsAt <= now, reported: !!x.noShowBy, late: lateOf(c, x) });
    const live = c.calls.filter((x) => x.status === "booked" && !x.review);
    const setIds = [...new Set(live.filter((x) => x.setId).map((x) => x.setId!))];
    const sets = setIds.map((sid) => {
      const cs = live.filter((x) => x.setId === sid).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
      const daily = cs.length > 1 && cs[1].startsAt.getTime() - cs[0].startsAt.getTime() < 2 * 86_400_000;
      const next = cs.find((x) => x.startsAt > now) ?? cs[cs.length - 1];
      return { id: sid, label: `${daily ? "Daily" : "Weekly"}: ${cs[0].startsAt.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })} · ${cs.length} calls, next ${fmtDate(next.startsAt).replace(/, \d{4}$/, "")} · ${rateLabel(cs[0].rateCents, c.liveRateCents)}`, calls: cs.map(toCall) };
    });
    const booked = new Set(c.calls.filter((x) => x.status === "booked" && x.startsAt > now).map((x) => x.setId ?? x.id)).size;
    return {
      contractId: c.id, name: displayName(c.tester), terms, booked,
      calls: live.filter((x) => !x.setId).map(toCall),
      sets,
      requests: reqs.filter((r) => r.contractId === c.id).map((r) => ({
        id: r.id, minutes: r.minutes, times: (r.times.length ? r.times : [r.startsAt]).map((d) => d.toISOString()), weeks: r.weeks, repeat: r.repeat, mine: r.fromSide === "developer",
        rate: r.askRateCents != null ? `asks ${whole(r.askRateCents)}/h` : rateLabel(c.liveRateCents, c.liveRateCents),
      })),
    };
  });
  // (NEWEST+5) Rating a tester: only after they rated you (14 days); their rating shows once you rate (or the window closes).
  const rateInfo = new Map(
    await Promise.all(
      t.contracts.map(async (c) => [c.id, { ...(await contractRatings(c.id)), blocker: await rateBlocker(c.id, "developer"), avg: (await ratingSummary(c.testerId)).line }] as const),
    ),
  );
  return (
    <>
      <AutoRefresh query={`test=${t.id}`} />
      <LiveTop scope={`test:${t.id}`} seenAt={seenAt} />
      <TopPanel
        id={t.id}
        title={t.title}
        status={t.status}
        terms={termsLine(asListing(t))}
        openUntil={t.openUntil ? t.openUntil.toISOString() : null}
        version={t.version}
        seenAt={seenAt}
        nextRoundId={next?.id ?? null}
        spotsLine={`${working.length} of ${t.spots} spots used`}
        joinMode={t.joinMode}
        deadlineDays={t.deadlineDays}
        categories={t.categories}
        working={working.map((c) => ({ contractId: c.id, name: displayName(c.tester) }))}
      />
      {(u.holdStartedAt || owedList.length > 0) && <OwedBox onHold={!!u.holdStartedAt} owed={owedList} />}
      {soon && <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">{closesInLine(t.title, t.openUntil!, new Date())}</p>}
      <Applications testId={t.id} seenAt={seenAt} apps={apps} />
      {preJoin.length > 0 && (
        <section className="panel">
          <h2>Chats with applicants and invited testers</h2>
          {preJoin.map((x) => (
            <details key={x.id} className="text-sm">
              <summary className="cursor-pointer">Chat with {displayName(x)} ({msgs.filter((m) => m.testerId === x.id).length})</summary>
              <div className="pt-2">
                <Chat
                  closed={blockedIds.has(x.id) || blockedBy.has(x.id)}
                  path={`/api/tests/${t.id}/message`}
                  extra={{ testerId: x.id }}
                  other={displayName(x)}
                  messages={msgs.filter((m) => m.testerId === x.id).map((m) => ({ id: m.id, mine: m.senderId === u.id, who: m.senderId === u.id ? "You" : displayName(m.sender), body: m.body, at: m.createdAt.toISOString() }))}
                />
              </div>
            </details>
          ))}
        </section>
      )}
      {t.status !== "stopped" && (
        <InvitePanel
          testId={t.id}
          seenAt={seenAt}
          options={{ devices: t.devices, languages: t.languages }}
          testers={testers}
          sent={invites.map((i) => ({ id: i.id, name: people.get(i.testerId) ?? "?", status: i.status === "joined" ? "joined" : expired ? "expired" : "waiting for them to join" }))}
        />
      )}
      <DevCallPanel
        testId={t.id}
        seenAt={seenAt}
        canRequest={t.status === "open"}
        testers={devTesters}
        past={t.contracts
          .flatMap((c) => c.calls.filter((x) => x.status === "cancelled" || x.review).map((x) => ({
            id: x.id, who: displayName(c.tester), when: x.startsAt.toISOString(), minutes: x.minutes, logged: x.actualMinutes, cancelled: x.status === "cancelled",
            joined: joinedWords(x, "developer", displayName(c.tester), now), outcome: callOutcome(x, displayName(u), "developer"),
            devJoinedAt: x.devJoinedAt?.toISOString() ?? null, testerJoinedAt: x.testerJoinedAt?.toISOString() ?? null,
          })))
          .sort((a, b) => b.when.localeCompare(a.when))}
      />
      {saved && (
        <p className="ok">
          {Number(offered) > 0 ? `Saved. Offered the new terms to ${offered} working tester${Number(offered) === 1 ? "" : "s"}.` : "Saved. New testers join on the new listing; testers already in keep their contract."}
          {closed && ` Closed ${closed.split(", ").length} application${closed.split(", ").length === 1 ? "" : "s"}: ${closed.slice(0, 500)}.`}
          {resent && ` Invites re-sent on the new listing: ${resent.slice(0, 500)}.`}
          {skipped && ` Not re-invited: ${skipped.slice(0, 500)}.`}
        </p>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2"><Users className="h-5 w-5 text-volt-300" /> Testers joined</h2>
          <span className="text-sm text-ink-400">{working.length} of {t.spots}</span>
        </div>
        {t.contracts.length === 0 && <p className="note">Nobody has joined yet.</p>}
        {t.contracts.map((c) => (
          <div key={c.id} className="panel" id={`tester-${c.id}`}>
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="mr-auto"><a href={`/app/testers/${c.testerId}`}>{displayName(c.tester)}</a></h3>
              <span className="badge">{c.status === "working" ? `Working · due ${fmtDate(c.dueAt)}` : c.status === "left" ? "Left the test" : "Work ended"}</span>
              {c.keepPrivate && <span className="badge">Keeps it private</span>}
            </div>
            <p className="note">
              Their contract: {termsLine(c)} · joined {fmtDate(c.joinedAt)}
            </p>
            <p className="text-sm">{paidKinds.get(c.id)}</p>
            {c.calls.filter((x) => x.status !== "cancelled" && isBookedLate(x.createdAt, c.dueAt)).map((x) => (
              <p key={x.id} className="note">Call on {fmtDateTime(x.startsAt)}: {lateOf(c, x)}</p>
            ))}
            {termsRows.get(c.id) && <p className="note">{termsRows.get(c.id)}</p>}
            {rateInfo.get(c.id)?.avg && <p className="note">{displayName(c.tester)}: {rateInfo.get(c.id)?.avg}</p>}
            {(() => {
              const ri = rateInfo.get(c.id);
              if (!ri?.tester) return null;
              const name = displayName(c.tester);
              return (
                <>
                  {ri.testerRevealed ? (
                    <p className="note">{name} rated you: {ri.tester.stars} ★{ri.tester.comment ? ` · “${ri.tester.comment}”` : ""}</p>
                  ) : (
                    <p className="note">{name} rated you: you&apos;ll see it after you rate {pronouns(c.tester.pronoun).obj} (or on {fmtDate(ri.revealOn!)}).</p>
                  )}
                  {ri.developer && <p className="note">You rated {name}: {ri.developer.stars} ★</p>}
                  {ri.blocker === "" && (
                    <RateBox path={`/api/tests/${t.id}/rate`} body={{ contractId: c.id }} seenAt={seenAt} name={name} working={false} headline={`Your rating of ${name} is final. Both ratings show once you rate.`} lines={[]} />
                  )}
                </>
              );
            })()}
            {blockedIds.has(c.testerId) ? <p className="note">You blocked {displayName(c.tester)}. Unblock in Settings → Blocked people.</p> : <BlockButton seenAt={seenAt} testId={t.id} userId={c.testerId} name={displayName(c.tester)} effect="Their session ends now (work they sent stays payable), calls between you are cancelled, and chat closes." />}
            {c.submissions.length === 0 && c.calls.length === 0 && <p className="note">Nothing sent yet.</p>}
            {c.calls.filter((x) => x.status === "booked" && x.startsAt <= now).map((x) => (
              <div key={x.id} className="space-y-2 rounded-lg border border-white/10 p-3">
                <p className="text-sm font-medium">
                  Live call · {x.rateCents == null ? "Not in their contract" : "In their contract"} · {fmtDateTime(x.startsAt)} · {x.minutes} min booked
                </p>
                {x.review ? (
                  <ReviewResult seenAt={seenAt} review={x.review} payments={payments.filter((p) => p.callId === x.id)} dispute={x.dispute} testId={t.id} />
                ) : (
                  <>
                    {x.devJoinedAt && x.testerJoinedAt && <p className="note">Both joined at {fmtDateTime(new Date(Math.max(x.devJoinedAt.getTime(), x.testerJoinedAt.getTime())))}</p>}
                    <CallLength seenAt={seenAt} testId={t.id} callId={x.id} minutes={x.actualMinutes ?? defaultCallMinutes(x.startsAt, x.minutes, x.devJoinedAt, x.testerJoinedAt)} />
                    <PayBox key={x.actualMinutes ?? 0} kind="call" id={x.id} name={displayName(c.tester)} seenAt={seenAt} paidSoFarCents={paidSoFar(c.id)} askedCents={x.askedCents} partPaidCents={partPaid(x.id)}
                      listingCents={callReference(x.rateCents, x.actualMinutes ?? x.minutes, c.liveRateCents).cents}
                      listingText={callReference(x.rateCents, x.actualMinutes ?? x.minutes, c.liveRateCents).text.replace(/^(Listing|Agreed): /, "")} />
                  </>
                )}
              </div>
            ))}
            {c.submissions.map((s) => (
              <div key={s.id} className="space-y-2 rounded-lg border border-white/10 p-3">
                <p className="text-sm font-medium">
                  {s.kind === "written" ? "Written answers" : "Recording"} · {s.agreedCents == null ? "Not in their contract" : "In their contract"} · sent{" "}
                  {fmtDateTime(s.updatedAt)}
                  {s.late && <span className="ml-2 badge">{lateLabel(c.dueAt, fmtDate)}</span>}
                </p>
                {s.kind === "written" &&
                  writtenQuestions(c).map((q, i) => (
                    <div key={i} className="text-sm">
                      <p className="font-medium text-ink-200">{qText(q)}{qOptional(q) && <span className="ml-1 font-normal text-ink-500">· not required</span>}</p>
                      <p className="whitespace-pre-wrap">{(s.answers as string[])[i]}</p>
                    </div>
                  ))}
                {s.notes && <p className="whitespace-pre-wrap text-sm">Notes: {s.notes}</p>}
                {s.recordings.filter((r) => r.uploadedAt).map((r) => (
                  <div key={r.id} className="text-sm">
                    <video controls preload="metadata" className="max-h-72 w-full rounded bg-black" src={`/api/recordings/${r.id}/file`} />
                    <a href={`/api/recordings/${r.id}/file`} target="_blank" rel="noreferrer">{r.filename}</a>
                  </div>
                ))}
                {s.review ? (
                  <ReviewResult seenAt={seenAt} review={s.review} payments={payments.filter((p) => p.submissionId === s.id)} dispute={s.dispute} testId={t.id} />
                ) : (
                  <PayBox kind="submission" id={s.id} name={displayName(c.tester)} seenAt={seenAt} paidSoFarCents={paidSoFar(c.id)} askedCents={s.askedCents} partPaidCents={partPaid(s.id)}
                    note={s.agreedCents != null && s.payBy && !s.choiceOfferedAt ? choiceNoteLine(fmtDate(s.payBy).replace(/, \d{4}$/, ""), displayName(c.tester), chargeAmount(s.agreedCents, s.askedCents, partPaid(s.id)), pronouns(c.tester.pronoun).poss) : undefined}
                    listingCents={s.agreedCents} listingText={`${money(s.agreedCents)} for ${s.kind === "written" ? "written answers" : "a recording"}`} />
                )}
              </div>
            ))}
            <details className="text-sm">
              <summary className="cursor-pointer">Chat with {displayName(c.tester)} ({msgs.filter((m) => m.testerId === c.testerId).length})</summary>
              <div className="pt-2">
                <Chat
                  closed={blockedIds.has(c.testerId) || blockedBy.has(c.testerId)}
                  path={`/api/tests/${t.id}/message`}
                  extra={{ contractId: c.id }}
                  other={displayName(c.tester)}
                  messages={msgs.filter((m) => m.testerId === c.testerId).map((m) => ({ id: m.id, mine: m.senderId === u.id, who: m.senderId === u.id ? "You" : displayName(m.sender), body: m.body, at: m.createdAt.toISOString() }))}
                />
              </div>
            </details>
          </div>
        ))}
        <ByQuestion
          blocks={byQuestion(
            (t.questions as string[]) ?? [],
            t.contracts.flatMap((c) =>
              c.submissions
                .filter((s) => s.kind === "written")
                .map((s) => ({
                  contractId: c.id, tester: displayName(c.tester), questions: writtenQuestions(c), answers: (s.answers as string[]) ?? [], notes: s.notes, sentAt: s.updatedAt,
                  status: (!s.review ? "waiting" : s.review.rejected && !(s.dispute?.decidedCents) ? "rejected" : "paid") as "paid" | "rejected" | "waiting",
                  paidCents: Math.max(s.review?.amountCents ?? 0, s.dispute?.decidedCents ?? 0),
                })),
            ),
          )}
        />
      </section>
    </>
  );
}

type Rev = { amountCents: number; rejected: boolean; reason: string; createdAt: Date };
type Pay = { status: string; amountCents: number; kind: string };
type Disp = { id: string; status: string; reason: string; decidedCents: number | null; decisionNote: string; devSide: string } | null;

/** What happened to a piece after Pay / Reject, for the developer. */
function ReviewResult({ review, payments, dispute, testId, seenAt }: { review: Rev; payments: Pay[]; dispute: Disp; testId: string; seenAt: string }) {
  const main = payments.find((p) => p.kind !== "dispute" && p.status !== "failed") ?? payments.find((p) => p.kind !== "dispute");
  return (
    <div className="space-y-1 rounded-lg bg-white/[0.03] p-3 text-sm">
      {review.rejected ? (
        <p><b>Rejected</b> {fmtDateTime(review.createdAt)}: “{review.reason}” · nothing charged</p>
      ) : (
        <p>
          <b>Paid {money(review.amountCents)}</b> {fmtDateTime(review.createdAt)}
          {main?.status === "charged" && review.amountCents > 0 && " · ✓ charged now"}
          {main?.status === "not_set_up" && " · payments not set up: recorded, nothing charged"}
          {review.reason && <> · “{review.reason}”</>}
        </p>
      )}
      {dispute && (
        <p>
          {dispute.status === "open" ? `Disputed: “${dispute.reason}” · waiting for the team.` : `Dispute decided: total ${money(dispute.decidedCents)}${dispute.decisionNote ? ` · “${dispute.decisionNote}”` : ""}.`}
        </p>
      )}
      {dispute?.devSide && <p>Your side: “{dispute.devSide}”</p>}
      {dispute && dispute.status === "open" && !dispute.devSide && <DisputeSide seenAt={seenAt} testId={testId} disputeId={dispute.id} />}
    </div>
  );
}
