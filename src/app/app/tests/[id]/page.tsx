import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, money, pronouns } from "@/lib/format";
import { bookedLateLabel, isBookedLate, callReference, cancelNeedsReason, chargeAmount, defaultCallMinutes, choiceNoteLine, closesInLine, lateLabel, termsLine } from "@/lib/rules";
import { requirePageUser } from "@/lib/server/page-auth";
import { asListing, writtenQuestions } from "@/lib/server/tests";
import { roomUrl } from "@/lib/server/calls";
import { Chat } from "@/components/Chat";
import { CallPanel } from "./CallPanel";
import { CallLength } from "./CallLength";
import { InvitePanel } from "./InvitePanel";
import { CATEGORIES, DEVICES, LANGUAGES } from "@/lib/options";
import { invitable, inviteExpired } from "@/lib/server/invites";
import { owedForBox, sweepHeldCalls } from "@/lib/server/holds";
import { paidLines } from "@/lib/server/paid";
import { termsRowLines } from "@/lib/server/terms";
import { BlockButton } from "@/components/BlockButton";
import { Applications } from "./Applications";
import { CallRequests } from "@/components/CallRequests";
import { rateLabel } from "@/lib/server/requests";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DisputeSide } from "./DisputeSide";
import { OwedBox } from "@/components/OwedBox";
import { PayBox } from "./PayBox";
import { TopPanel } from "./TopPanel";

export const metadata = { title: "Test · Playtest" };
export const dynamic = "force-dynamic";

export default async function TestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; offered?: string }> }) {
  const { id } = await params;
  const { saved, offered } = await searchParams;
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
  const invitedIds = (await db.invite.findMany({ where: { testId: id, status: "sent" } })).map((i) => i.testerId);
  const preJoin = await db.user.findMany({ where: { id: { in: [...pendingApps.map((a) => a.testerId), ...invitedIds] } } });
  const apps = pendingApps.map((a) => {
    const x = appUsers.find((y) => y.id === a.testerId)!;
    return { id: a.id, name: displayName(x), note: a.note, profile: [...(x.profile?.devices ?? []), ...(x.profile?.languages ?? [])].join(", ") };
  });
  const blockedIds = new Set((await db.block.findMany({ where: { blockerId: u.id } })).map((b) => b.blockedId));
  const blockedBy = new Set((await db.block.findMany({ where: { blockedId: u.id } })).map((b) => b.blockerId));
  const [testers, invites, owedList] = await Promise.all([invitable(u.id, id), db.invite.findMany({ where: { testId: id, status: { in: ["sent", "joined"] } }, orderBy: { createdAt: "desc" } }), owedForBox(u.id)]);
  const people = new Map((await db.user.findMany({ where: { id: { in: invites.map((i) => i.testerId) } } })).map((x) => [x.id, displayName(x)]));
  const expired = inviteExpired(t, working.length);
  const soon = t.openUntil && t.openUntil > new Date() && t.openUntil.getTime() - Date.now() < 3 * 86_400_000;
  const now = new Date();
  const lateOf = (c: { dueAt: Date; tester: { name: string; email: string } }, x: { createdAt: Date }) => (isBookedLate(x.createdAt, c.dueAt) ? bookedLateLabel(displayName(c.tester), c.dueAt, (d) => fmtDate(d).replace(/, \d{4}$/, "")) : undefined);
  const booked = t.contracts.flatMap((c) => c.calls.filter((x) => x.status === "booked" && !x.review).map((x) => ({ ...x, name: displayName(c.tester), late: lateOf(c, x), rateText: rateLabel(x.rateCents, c.liveRateCents) })));
  const partPaid = (id: string) => payments.filter((p) => (p.submissionId === id || p.callId === id) && (p.status === "charged" || p.status === "not_set_up")).reduce((a, p) => a + p.amountCents, 0);
  const payments = await db.payment.findMany({ where: { contractId: { in: t.contracts.map((c) => c.id) } }, orderBy: { createdAt: "asc" } });
  return (
    <>
      <AutoRefresh query={`test=${t.id}`} />
      <TopPanel
        id={t.id}
        title={t.title}
        status={t.status}
        terms={termsLine(asListing(t)) + (t.openUntil ? ` · open until ${fmtDate(t.openUntil)}` : "")}
        seenAt={seenAt}
        nextRoundId={next?.id ?? null}
        spotsLine={`${working.length} of ${t.spots} spots used`}
        working={working.map((c) => ({ contractId: c.id, name: displayName(c.tester) }))}
      />
      {(u.holdStartedAt || owedList.length > 0) && <OwedBox onHold={!!u.holdStartedAt} owed={owedList} />}
      {soon && <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{closesInLine(t.title, t.openUntil!, new Date())}</p>}
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
          options={{ devices: DEVICES, languages: LANGUAGES, categories: CATEGORIES }}
          testers={testers}
          sent={invites.map((i) => ({ id: i.id, name: people.get(i.testerId) ?? "?", status: i.status === "joined" ? "joined" : expired ? "expired" : "waiting for them to join" }))}
        />
      )}
      <CallPanel
        testId={t.id}
        seenAt={seenAt}
        booked={booked.map((b) => ({ id: b.id, when: b.startsAt.toISOString(), minutes: b.minutes, name: b.name, room: roomUrl(b, b.slot), canCancel: !cancelNeedsReason(b.startsAt, now), started: b.startsAt <= now, reported: !!b.noShowBy, late: b.late, rate: b.rateText }))}
      />
      <section className="panel" aria-label="Call requests">
        <h3>Call requests</h3>
        <CallRequests
          side="developer"
          path={`/api/tests/${t.id}`}
          seenAt={seenAt}
          canRequest={t.status === "open" && working.length > 0}
          targets={working.map((c) => ({ contractId: c.id, name: displayName(c.tester), rate: c.liveRateCents == null ? "not in contract" : `${money(c.liveRateCents).replace(/\.00$/, "")}/h` }))}
          requests={reqs.map((r) => {
            const k = t.contracts.find((c) => c.id === r.contractId)!;
            return { id: r.id, when: r.startsAt.toISOString(), mine: r.fromSide === "developer", who: displayName(k.tester), contractId: r.contractId, rate: r.askRateCents != null ? `asks ${money(r.askRateCents).replace(/\.00$/, "")}/h` : rateLabel(k.liveRateCents, k.liveRateCents) };
          })}
        />
      </section>
      {saved && (
        <p className="ok">
          {Number(offered) > 0 ? `Saved. Offered the new terms to ${offered} working tester${Number(offered) === 1 ? "" : "s"}.` : "Saved. New testers join on the new listing; testers already in keep their contract."}
        </p>
      )}

      <section className="space-y-3">
        <h2>Testers</h2>
        {t.contracts.length === 0 && <p className="note">Nobody has joined yet.</p>}
        {t.contracts.map((c) => (
          <div key={c.id} className="panel" id={`tester-${c.id}`}>
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="mr-auto">{displayName(c.tester)}</h3>
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
            {blockedIds.has(c.testerId) ? <p className="note">You blocked {displayName(c.tester)}. Unblock in Settings → Blocked people.</p> : <BlockButton userId={c.testerId} name={displayName(c.tester)} effect="Their session ends now (work they sent stays payable), calls between you are cancelled, and chat closes." />}
            {c.submissions.length === 0 && c.calls.length === 0 && <p className="note">Nothing sent yet.</p>}
            {c.calls.filter((x) => x.status === "booked" && x.startsAt <= now).map((x) => (
              <div key={x.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-medium">
                  Live call · {x.rateCents == null ? "Not in their contract" : "In their contract"} · {fmtDateTime(x.startsAt)} · {x.minutes} min booked
                </p>
                {x.review ? (
                  <ReviewResult review={x.review} payments={payments.filter((p) => p.callId === x.id)} dispute={x.dispute} testId={t.id} />
                ) : (
                  <>
                    {x.devJoinedAt && x.testerJoinedAt && <p className="note">Both joined at {fmtDateTime(new Date(Math.max(x.devJoinedAt.getTime(), x.testerJoinedAt.getTime())))}</p>}
                    <CallLength testId={t.id} callId={x.id} minutes={x.actualMinutes ?? defaultCallMinutes(x.startsAt, x.minutes, x.devJoinedAt, x.testerJoinedAt)} />
                    <PayBox key={x.actualMinutes ?? 0} kind="call" id={x.id} name={displayName(c.tester)} seenAt={seenAt} paidSoFarCents={paidSoFar(c.id)} askedCents={x.askedCents} partPaidCents={partPaid(x.id)}
                      listingCents={callReference(x.rateCents, x.actualMinutes ?? x.minutes, c.liveRateCents).cents}
                      listingText={callReference(x.rateCents, x.actualMinutes ?? x.minutes, c.liveRateCents).text.replace(/^(Listing|Agreed): /, "")} />
                  </>
                )}
              </div>
            ))}
            {c.submissions.map((s) => (
              <div key={s.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-medium">
                  {s.kind === "written" ? "Written answers" : "Recording"} · {s.agreedCents == null ? "Not in their contract" : "In their contract"} · sent{" "}
                  {fmtDateTime(s.updatedAt)}
                  {s.late && <span className="ml-2 badge">{lateLabel(c.dueAt, fmtDate)}</span>}
                </p>
                {s.kind === "written" &&
                  writtenQuestions(c).map((q, i) => (
                    <div key={i} className="text-sm">
                      <p className="font-medium text-slate-700">{q}</p>
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
                  <ReviewResult review={s.review} payments={payments.filter((p) => p.submissionId === s.id)} dispute={s.dispute} testId={t.id} />
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
      </section>
    </>
  );
}

type Rev = { amountCents: number; rejected: boolean; reason: string; createdAt: Date };
type Pay = { status: string; amountCents: number; kind: string };
type Disp = { id: string; status: string; reason: string; decidedCents: number | null; decisionNote: string; devSide: string } | null;

/** What happened to a piece after Pay / Reject, for the developer. */
function ReviewResult({ review, payments, dispute, testId }: { review: Rev; payments: Pay[]; dispute: Disp; testId: string }) {
  const main = payments.find((p) => p.kind !== "dispute" && p.status !== "failed") ?? payments.find((p) => p.kind !== "dispute");
  return (
    <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
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
      {dispute && dispute.status === "open" && !dispute.devSide && <DisputeSide testId={testId} disputeId={dispute.id} />}
    </div>
  );
}
