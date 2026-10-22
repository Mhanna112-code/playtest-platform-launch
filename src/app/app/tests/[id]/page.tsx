import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, money } from "@/lib/format";
import { callReference, canCancelCall, lateLabel, termsLine } from "@/lib/rules";
import { requirePageUser } from "@/lib/server/page-auth";
import { asListing, writtenQuestions } from "@/lib/server/tests";
import { roomUrl } from "@/lib/server/calls";
import { Chat } from "@/components/Chat";
import { CallPanel } from "./CallPanel";
import { CallLength } from "./CallLength";
import { InvitePanel } from "./InvitePanel";
import { CATEGORIES, DEVICES, LANGUAGES } from "@/lib/options";
import { invitable, inviteExpired } from "@/lib/server/invites";
import { owed } from "@/lib/server/holds";
import { OwedBox } from "@/components/OwedBox";
import { PayBox } from "./PayBox";
import { TopPanel } from "./TopPanel";

export const metadata = { title: "Test · Playtest" };
export const dynamic = "force-dynamic";

export default async function TestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const { saved } = await searchParams;
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
          messages: { orderBy: { createdAt: "asc" }, include: { sender: true }, take: 300 },
        },
      },
    },
  });
  if (!t || t.developerId !== u.id) notFound();
  const next = await db.test.findFirst({ where: { previousId: id }, select: { id: true } });
  const working = t.contracts.filter((c) => c.status === "working");
  const paid = await db.payment.groupBy({ by: ["contractId"], where: { contractId: { in: t.contracts.map((c) => c.id) }, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } });
  const paidSoFar = (id: string) => paid.find((p) => p.contractId === id)?._sum.amountCents ?? 0;
  const [testers, invites, owedList] = await Promise.all([invitable(u.id, id), db.invite.findMany({ where: { testId: id, status: { in: ["sent", "joined"] } }, orderBy: { createdAt: "desc" } }), owed(u.id)]);
  const people = new Map((await db.user.findMany({ where: { id: { in: invites.map((i) => i.testerId) } } })).map((x) => [x.id, displayName(x)]));
  const expired = inviteExpired(t, working.length);
  const soon = t.openUntil && t.openUntil > new Date() && t.openUntil.getTime() - Date.now() < 3 * 86_400_000;
  const openSlots = await db.callSlot.findMany({ where: { testId: id, status: "open", startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } });
  const now = new Date();
  const nameOf = new Map(t.contracts.map((c) => [c.testerId, displayName(c.tester)]));
  const booked = t.contracts.flatMap((c) => c.calls.filter((x) => x.status === "booked" && !x.review).map((x) => ({ ...x, name: displayName(c.tester) })));
  const payments = await db.payment.findMany({ where: { contractId: { in: t.contracts.map((c) => c.id) } }, orderBy: { createdAt: "asc" } });
  return (
    <>
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
      {(u.holdStartedAt || owedList.length > 0) && <OwedBox onHold={!!u.holdStartedAt} owed={owedList.map((p) => ({ amountCents: p.amountCents, until: p.owedUntil!.toISOString() }))} />}
      {soon && <p className="info">{t.title} closes on {fmtDate(t.openUntil!)}: testers should send their work before then.</p>}
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
        minutes={t.liveMinutes ?? 30}
        stopped={t.status === "stopped"}
        testers={working.map((c) => ({ id: c.testerId, name: displayName(c.tester) }))}
        open={openSlots.map((s) => ({ id: s.id, when: s.startsAt.toISOString(), minutes: s.minutes, who: s.allowedTesterIds.length ? "only " + s.allowedTesterIds.map((x) => nameOf.get(x) ?? "?").join(", ") : "all testers" }))}
        booked={booked.map((b) => ({ id: b.id, when: b.startsAt.toISOString(), minutes: b.minutes, name: b.name, room: roomUrl(b, b.slot), canCancel: canCancelCall(b.startsAt, now).ok, started: b.startsAt <= now, reported: !!b.noShowBy }))}
      />
      {saved && <p className="ok">Saved. New testers join on the new listing; testers already in keep their contract.</p>}

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
            {c.submissions.length === 0 && c.calls.length === 0 && <p className="note">Nothing sent yet.</p>}
            {c.calls.filter((x) => x.status === "booked" && x.startsAt <= now).map((x) => (
              <div key={x.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-medium">
                  Live call · {x.rateCents == null ? "Extra (not in the listing)" : "In their contract"} · {fmtDateTime(x.startsAt)} · {x.minutes} min booked
                </p>
                {x.review ? (
                  <ReviewResult review={x.review} payments={payments.filter((p) => p.callId === x.id)} dispute={x.dispute} />
                ) : (
                  <>
                    <CallLength testId={t.id} callId={x.id} minutes={x.actualMinutes ?? x.minutes} />
                    <PayBox key={x.actualMinutes ?? 0} kind="call" id={x.id} name={displayName(c.tester)} seenAt={seenAt} paidSoFarCents={paidSoFar(c.id)}
                      listingCents={callReference(x.rateCents, x.actualMinutes ?? x.minutes).cents}
                      listingText={callReference(x.rateCents, x.actualMinutes ?? x.minutes).text.replace(/^Listing: /, "")} />
                  </>
                )}
              </div>
            ))}
            {c.submissions.map((s) => (
              <div key={s.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-medium">
                  {s.kind === "written" ? "Written answers" : "Recording"} · {s.agreedCents == null ? "Extra (not in the listing)" : "In their contract"} · sent{" "}
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
                  <ReviewResult review={s.review} payments={payments.filter((p) => p.submissionId === s.id)} dispute={s.dispute} />
                ) : (
                  <PayBox kind="submission" id={s.id} name={displayName(c.tester)} seenAt={seenAt} paidSoFarCents={paidSoFar(c.id)}
                    listingCents={s.agreedCents} listingText={`${money(s.agreedCents)} for ${s.kind === "written" ? "written answers" : "a recording"}`} />
                )}
              </div>
            ))}
            <details className="text-sm">
              <summary className="cursor-pointer">Chat with {displayName(c.tester)} ({c.messages.length})</summary>
              <div className="pt-2">
                <Chat
                  path={`/api/tests/${t.id}/message`}
                  extra={{ contractId: c.id }}
                  other={displayName(c.tester)}
                  messages={c.messages.map((m) => ({ id: m.id, mine: m.senderId === u.id, who: m.senderId === u.id ? "You" : displayName(m.sender), body: m.body, at: m.createdAt.toISOString() }))}
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
type Disp = { status: string; reason: string; decidedCents: number | null; decisionNote: string } | null;

/** What happened to a piece after Pay / Reject, for the developer. */
function ReviewResult({ review, payments, dispute }: { review: Rev; payments: Pay[]; dispute: Disp }) {
  const main = payments.find((p) => p.kind !== "dispute");
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
    </div>
  );
}
