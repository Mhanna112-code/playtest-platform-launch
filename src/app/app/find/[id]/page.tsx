import { withDateZone } from "@/lib/server/dateZone";
import { NameLink, TestName } from "@/components/Cut";
import { NameLine } from "@/components/WholeLine";
import { cutNamesIn } from "@/lib/cutNames";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, BarChart3, CheckCircle2, Clock, FileSignature, FileText, HelpCircle, Languages, Monitor, Radio, Users, Video } from "lucide-react";
import { CategoryBadges } from "@/components/Category";
import { CategoryTile, mainCategory, PartBadges } from "@/components/Ui";
import { db } from "@/lib/db";
import { NO_FREE_KEY } from "@/lib/keys";
import { displayName, fmtDateIn, fmtDateTimeIn, money } from "@/lib/format";
import { closedToNewLine, dueFromJoin, joinerDays, perTesterLine, testerDaysOf, testerShare, testPaused, yourDeadlineLine } from "@/lib/rules";
import { QuestionTexts } from "@/components/QA";
import { requireOpenPage } from "@/lib/server/page-auth";
import { asListing, needsLines } from "@/lib/server/tests";
import { JoinBox } from "./JoinBox";
import { AdminPersonBoxes, AdminTestBoxes } from "@/app/admin/AdminBoxes";
import { isAdmin } from "@/lib/server/session";
import { LiveTop } from "@/components/LiveTop";
import { PageLoaded } from "@/components/PageLoaded";
import { AutoRefresh } from "@/components/AutoRefresh";
import { OnePage } from "@/components/OnePage";
import { joinScope } from "@/lib/pageClaim";
import { applyDeclinedLine, invitesV, joinPageV, rejoinDeclinedLine } from "@/lib/server/pulseV";
import { JoinWatch } from "./JoinWatch";
import { ANSWER_MIN_LINE, qRequired, qText } from "@/lib/questions";
import { ratingSummary } from "@/lib/server/ratings";
import { NoThanksButton } from "./NoThanksButton";
import { LongList } from "@/components/LongList";
import { gapsOf } from "@/lib/gaps";
import { developerStats } from "@/lib/server/profileStats";
import { sideLink } from "@/lib/sides";
import { canAskToRejoin, leftText, testTitleOf } from "@/lib/rules";
import { profileTestRefusal } from "@/lib/server/profileOpenTests";
import { needsTermsAgain } from "@/lib/termsOfUse";
import { inviteOnlyHidden, noteJoinPageVisit } from "@/lib/server/testVisits";
import { otherSideNotice } from "@/components/OtherSideNotice";
import { ListingPanel } from "@/app/app/tests/[id]/ListingPanel";
import { ListingSeeIt, SeeItTarget } from "@/components/ListingInfo";
import { testerListingPanel } from "@/lib/server/listingPanel";

export const metadata = { title: "Test · Playtest" };
export const dynamic = "force-dynamic";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
// What each part adds to the session (the full app's "How it works").
const STEPS = {
  written: "Answer the questions in a short written report",
  recording: "Record your screen and talk out loud while you try it, then send the recording",
  live: "Request a call time, try it live while the developer watches",
};

export default async function ListingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ from?: string }> }) {
  const { id } = await params;
  const from = (await searchParams)?.from;
  const u = await requireOpenPage("/app/find");
  return withDateZone(u.timeZone, async () => {
 // (Owner, Oct 28) closed to a restricted account: it moves to the dashboard top before anything renders
  const otherSide = await otherSideNotice(u); // (batch 34 §5) a page of the other side: only the switch notice
  if (otherSide) return otherSide;
  // (Batch 30 §8) The invitations fingerprint as of BEFORE the page reads the test and the invite: AutoRefresh starts from it.
  const invitesFp = await invitesV(u.id);
  // (Owner's repro, Oct 29, batch 30 §8) The same for their application or ask to rejoin (JoinWatch).
  const joinFp = await joinPageV(u.id, id);
  const t = await db.test.findUnique({ where: { id }, include: { developer: true } });
  // (Batch 17 section 8) The team opens any test from their Find tests, drafts too.
  if (!t || (t.status === "draft" && !isAdmin(u))) notFound();
  const mine = await db.contract.findUnique({ where: { testId_testerId: { testId: id, testerId: u.id } } });
  if (mine && mine.status === "working") redirect(`/app/sessions/${mine.id}`);
  // (Owner, Oct 28, batch 17 §18) A tester opening the join page of a test they're not in (never joined): "Tests visited" on their dashboard, last visit first.
  await noteJoinPageVisit(u, t, isAdmin(u));
  // (Owner, Oct 28, batch 17 section 9) A press on a developer profile's "Open tests" from a page opened before the test left that list: the usual refusal,
  // nothing of the listing (the profile drops it when shown again).
  const gone = from === "profile" && !isAdmin(u) ? await profileTestRefusal(id, u.id) : "";
  if (gone) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <p><a href={`/app/developers/${t.developerId}`}>← Back to the profile</a></p>
        <p className="card note" data-unavailable="" data-profile-gone="">{gone}</p>
      </div>
    );
  }
  const testersIn = await db.contract.count({ where: { testId: id, status: "working" } });
  const profile = await db.testerProfile.findUnique({ where: { userId: u.id } });
  const gaps = needsLines(t, profile);
  const blocked = (await db.block.count({ where: { OR: [{ blockerId: u.id, blockedId: t.developerId }, { blockerId: t.developerId, blockedId: u.id }] } })) > 0;
  const l = { ...asListing(t), testerDays: t.testerDays }; // (batch 15 section 18) the terms line says "14 days"
  const devRating = await ratingSummary(t.developerId, "developer"); // (Owner, Nov 5, §276) "by <dev> · 1.0 ★": ratings they got as a developer only
  const devStats = await developerStats(t.developerId);
  const ratedHere = mine ? (await db.rating.count({ where: { contractId: mine.id } })) > 0 : false;
  const invite = await db.invite.findFirst({ where: { testId: t.id, testerId: u.id, status: "sent" } });
  const canRejoin = !!mine && canAskToRejoin(mine, ratedHere);
  const myApp = await db.application.findUnique({ where: { testId_testerId: { testId: t.id, testerId: u.id } } });
  const seenAt = new Date().toISOString();
  // (Owner, Oct 27) A paused test (a hold, a suspension or the team's pause) is not listed and not joinable. Someone who joined, was invited or applied still sees it (with a Paused tag);
  // anyone else opening the link reads "This test isn't available right now."
  const paused = testPaused(t.developer, t);
  const involved = !!mine || !!invite || t.developerId === u.id || (await db.application.count({ where: { testId: id, testerId: u.id } })) > 0 || (await db.invite.count({ where: { testId: id, testerId: u.id } })) > 0;
  // (Owner, Oct 28, batch 16 section 11) A block either way hides that developer's tests this tester was never part of (no contract, invite or application): the
  // same line, nothing of the listing, never the reason.
  // (Owner, Oct 28, batch 17 §18) An open invite-only test for a tester who isn't invited, applying or in it (as from a profile, batch 17 §9): the same line,
  // nothing of the listing. A tester who was in it before keeps the page as it is (Ask to rejoin).
  const inviteOnly = !isAdmin(u) && (await inviteOnlyHidden(t, u.id));
  if (((paused && !involved) || inviteOnly || (blocked && !involved && t.developerId !== u.id)) && !isAdmin(u)) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <p><a href="/app/find">← All tests</a></p>
        <p className="card note" data-unavailable="">This test isn&apos;t available right now.</p>
      </div>
    );
  }
  const full = testersIn >= t.spots;
  // (Owner, Nov 9, §341, §348) No free access key with a spot open: closed to new testers, with the key line (one reason, after "full": joinRefusal's order).
  const keyless = !full && t.status === "open" && !(t.openUntil && t.openUntil < new Date()) && (await (await import("@/lib/server/accessKeys")).noFreeKeyTests(db, [t.id])).has(t.id);
  const closed = paused || t.status !== "open" || full || keyless || (t.openUntil && t.openUntil < new Date());
  const dev = displayName(t.developer);
  // (Owner, Nov 5, §238) A line naming the developer: the name cut at 20 with "…" opening it in place, the arrow the whole line; whole, it links to their profile.
  // `linked`: the badge keeps its plain words (no link inside the pill).
  const devLine = (text: string, linked = true) => { const x = cutNamesIn(text, [dev]); return <NameLine shown={x.shown} full={x.full} {...(linked ? { name: dev, href: `/app/developers/${t.developerId}` } : {})} />; };
  // (Owner, Oct 30, batch 15 section 18) Every tester gets the same days from when they join: "Your deadline: Dec 3 (14 days from joining)".
  const localDay = (d: Date) => fmtDateIn(d, u.timeZone).replace(/, \d{4}$/, "");
  const days = joinerDays(t, t.developer.timeZone); // (batch 35 §32) the same helper as the developer's Listing panel
  const dueAt = t.testerDays ? dueFromJoin(new Date(), t.testerDays, t.developer.timeZone) : t.openUntil ?? new Date(Date.now() + t.deadlineDays * 86_400_000);
  const dueIfNow = yourDeadlineLine(dueAt, days, localDay).replace(/^Your deadline: /, "");
  const joinClosed = t.openUntil && t.openUntil < new Date() ? closedToNewLine(t.openUntil, localDay) : "";
  const parts = [
    { key: "written" as const, on: t.writtenCents != null, cents: t.writtenCents, required: t.writtenRequired, title: "Written answers", icon: <FileText className="h-4 w-4" /> },
    { key: "recording" as const, on: t.recordingCents != null, cents: t.recordingCents, required: t.recordingRequired, title: "Screen recording", icon: <Video className="h-4 w-4" /> },
    { key: "live" as const, on: t.liveRateCents != null, cents: t.liveRateCents, required: t.liveRequired, title: "Live call", icon: <Radio className="h-4 w-4" /> },
  ].filter((p) => p.on);
  const fixed = [t.writtenCents, t.recordingCents].filter((c): c is number => c != null);
  const big = fixed.length ? money(testerShare(Math.min(...fixed))) : t.liveRateCents != null && t.liveRateCents > 0 ? `${money(testerShare(t.liveRateCents))}/h` : "Free";
  // The full app's test page: the header card (tile, title, by, price, badges, description), the invitation, how it works and
  // what the developer wants to know, "Your deal", how the developer reviews, then the Join box.
  // (Batch 35 §14) The Listing panel's rows: the current listing in the tester's words (their deadline from joining), the most recent Save's fields tagged.
  const panel = await testerListingPanel(t.id, { ...asListing(t), deadlineDays: days }, u.timeZone);
  return (
    <SeeItTarget target="#listing">
    <div className="mx-auto max-w-3xl space-y-6">
      <p><a href="/app/find">← All tests</a></p>
      {isAdmin(u) && <AdminTestBoxes testId={t.id} adminId={u.id} />}
      {t.developerId !== u.id && <LiveTop scope={`listing:${t.id}`} seenAt={seenAt} seeIt="#listing" />}
      {/* (Batch 30 §12) The seen marker starts at this page's first load in the tab: a redraw (the needs covered, an invite re-sent) never skips a change. */}
      <PageLoaded at={seenAt} />
      {/* (Batch 16 section 32) An invite to this test: the page follows it live (closed, re-sent, the test filling). */}
      {invite && <AutoRefresh query="invites=1" v={invitesFp} />}
      {/* (Owner, Oct 30, batch 34 §14 "The join page too"; batch 35 §14) The listing information is the Listing panel, as on the developer's test page (the tester's
          words: their share of each price, no build link before joining); its header card sits inside it (owner, Nov 2: no "What testers said"). Every listing line on this page
          (the top box, the stop boxes, the "… anyway?" pop-up; batch 35 §55: no live list by the button) has See it, which comes here and marks that Save's fields. */}
      <ListingSeeIt box="listing" />
      <ListingPanel side="tester" rows={panel.rows} listing={l} savedAt={panel.savedAt} when={(d) => fmtDateTimeIn(d, u.timeZone)}
        intro={`The listing as it is now. A field ${dev}'s last save changed shows when: tap it for before and now.`}
        after={{ spots: <> · {plural(Math.max(0, t.spots - testersIn), "spot")} left</> }}
        head={<>
        <div className="flex flex-wrap items-start gap-4">
          <CategoryTile category={mainCategory(t.categories)} size="h-14 w-14" />
          <div className="min-w-[min(100%,12rem)] flex-1">
            {t.productName && <p className="kicker">{t.productName}</p>}
            {/* (Owner, Nov 3, batch 35 §168) The team opening a Next round's draft with no name yet: "Untitled draft (round 2)". */}
            <h1 className="text-2xl font-bold tracking-tight text-white">{testTitleOf(t)}</h1>
            <div className="text-sm text-slate-400">
              by <NameLink text={dev} href={`/app/developers/${t.developerId}`} />{devRating.line && ` · ${devRating.line}`}
              {/* (Owner, Nov 5, §238) The developer's name cut at 20: its "…" opens the name in place, the arrow the whole line (NameLine, §220). */}
              {invite ? <span className="badge ml-2 border-emerald-400/40 text-emerald-200">Invited</span> : t.joinMode === "apply" && <span className="badge ml-2 max-w-full border-sky-300/40 text-sky-200 [overflow-wrap:anywhere]" data-approves-badge=""><span className="min-w-0">{devLine(`${dev} approves each tester`, false)}</span></span>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-emerald-300">{(fixed.length > 1 || (fixed.length && t.liveRateCents != null)) && <span className="text-sm font-medium">from </span>}{big}</p>
            <p className="text-xs text-slate-500">paid when accepted</p>
            <p className="text-xs text-slate-500">You get 80% of each price</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <CategoryBadges categories={t.categories} />
          <PartBadges written={t.writtenCents != null} recording={t.recordingCents != null} live={t.liveRateCents != null} />
          {t.mature && <span className="badge border-rose-300/40 text-rose-200" title={t.matureWhy}>Mature (18+)</span>}
          {t.ndaText && <span className="badge"><FileSignature className="h-3.5 w-3.5" /> NDA</span>}
          {t.devices.length > 0 && <span className="badge"><Monitor className="h-3.5 w-3.5" /> {t.devices.join(" · ")}</span>}
          {t.languages.length > 0 && <span className="badge"><Languages className="h-3.5 w-3.5" /> {t.languages.join(", ")}</span>}
          <span className="badge"><Users className="h-3.5 w-3.5" /> {plural(testersIn, "tester")} on this test</span>
        </div>
        </>}
      />

      <div className="flex flex-wrap gap-2 text-xs text-slate-300" data-listing-facts="">
          {t.status === "open" && !joinClosed && <span className="chip" title="Every tester gets the same number of days from when they join"><Clock className="h-3.5 w-3.5" /> {t.openUntil ? perTesterLine(days, t.openUntil, localDay) : `Your deadline: ${dueIfNow}`}</span>}
          {joinClosed && <span className="chip" data-join-closed=""><Clock className="h-3.5 w-3.5" /> {joinClosed}</span>}
          <span className="chip"><CheckCircle2 className="h-3.5 w-3.5" /> {t.spots - testersIn} spot{t.spots - testersIn === 1 ? "" : "s"} left</span>
      </div>

      {/* (An invitation shows here, as in the full app: who invited you, how long you'd have, No thanks.) */}
      {invite && !blocked && (
        <section className="card flex flex-wrap items-start gap-3 border-emerald-400/30" id="invitation">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="font-semibold text-white [overflow-wrap:anywhere]" data-invited-by="">{devLine(`${dev} invited you`)}</div>
            <p className="text-sm text-slate-300" data-join-deadline="">Your deadline: {dueIfNow}</p>
            <p className="text-xs text-slate-400">Join below straight away{t.joinMode === "apply" ? ", no need to apply" : ""}.</p>
          </div>
          <NoThanksButton inviteId={invite.id} seenAt={seenAt} />
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-3">
          <h2 className="font-semibold text-white">How it works</h2>
          <ol className="space-y-2 text-sm text-slate-300">
            {["Join the test and open the product with the link", ...parts.map((p) => STEPS[p.key])].map((s, i) => (
              <li key={s} className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-xs text-indigo-200">{i + 1}</span> {s}
              </li>
            ))}
          </ol>
        </div>
        <div className="card space-y-3">
          <h2 className="flex items-center gap-2 font-semibold text-white"><HelpCircle className="h-5 w-5 text-indigo-300" /> {dev} wants to know</h2>
          {l.questions.length ? (
            // (Batch 20 section 1) More than 3 questions sit in a panel. (Owner, Nov 5, §237) Each question in its question box ("Question N", "Required" a tag:
            // QA's QuestionTexts, drags taller, no Show more); more than 3 in the draggable panel (PanelWhen), each box keeping its own scroll.
            // (Owner, Nov 5, §249) The shared questions drop-down (its own scroll panel, each question a drop-down), open here: it's what the page is for.
            <QuestionTexts open id={`join-q-${t.id}`} items={l.questions.map((q) => ({ text: qText(q), required: qRequired(q) }))} />
          ) : (
            <p className="text-sm text-slate-400">Where you got stuck, any bugs, and what you liked.</p>
          )}
          {/* (Batch 30 §14) The answers' minimum, as on Post and Edit. */}
          {l.questions.length > 0 && <p className="text-xs text-slate-400" data-questions-rule="">{ANSWER_MIN_LINE}</p>}
        </div>
      </section>

      <section className="card space-y-4 border-indigo-400/30">
        <h2 className="flex items-center gap-2 font-semibold text-white"><FileSignature className="h-5 w-5 text-indigo-300" /> Your deal</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {parts.map((p) => (
            <div key={p.key} className="rounded-xl border border-white/10 bg-white/[0.03] p-3" data-deal-part={p.key}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium text-white">{p.icon} {p.title}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${p.required ? "bg-amber-400/15 text-amber-200" : "bg-white/5 text-slate-400"}`}>{p.required ? "Required" : "Not required"}</span>
              </div>
              {p.cents === 0 ? (
                <p className="mt-2 text-lg font-bold text-sky-200">Free (unpaid)</p>
              ) : (
                <>
                  <p className="mt-2 text-lg font-bold text-emerald-300">{money(testerShare(p.cents!))}{p.key === "live" && <span className="text-sm font-normal text-slate-400">/h</span>}</p>
                  {p.key === "live" && <p className="text-xs text-slate-400">For the call&apos;s real length.</p>}
                </>
              )}
            </div>
          ))}
        </div>
        <p className="note">Prices and parts are agreed when you join. Later changes to those are offered as Switch or Keep; questions and other listing edits still apply.</p>
      </section>

      <section className="card space-y-2">
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 font-semibold text-white"><BarChart3 className="h-5 w-5 text-sky-300" /> <span>How <NameLink text={dev} href={`/app/developers/${t.developerId}`} newTab /> reviews</span></h2>
          <ul className="space-y-1 text-sm text-slate-300">
            {/* (Owner, Oct 30, batch 35 §14) The average-pay line is gone from here: only the developer's own dashboard shows it. */}
            <li>Typical review: {devStats.review.value}</li>
            <li>Rating: {devRating.line || "no ratings yet"}</li>
          </ul>
          {/* (Owner, Nov 3, §166) No "See his profile and other tests": the developer's name (above and in this heading) is the green link to the profile. */}
        </div>
      </section>

      {ratedHere && <p className="info">{mine?.status === "left" && mine.endKind === "rated" ? "You rated this test, so you can't join it again." : "You can't join this test again."}</p>}
      {mine && mine.status !== "working" && !ratedHere && canRejoin && !invite && !blocked && <p className="info">{mine.endKind === "suspended" ? "You were removed from this test." : mine.status === "left" ? "You left this test." : "Your work on this test ended."}{/* (Owner, Nov 2) the time a rejoin gives back, on the page itself */}{mine.endedAt && mine.dueAt > mine.endedAt ? ` You had ${leftText(mine.dueAt.getTime() - mine.endedAt.getTime())} left, and that's what you get back.` : ""} Ask to rejoin: if {dev} accepts, your session comes back with everything in it (work you sent, payments and chat), on the current listing.</p>}
      {mine && mine.status !== "working" && !ratedHere && !canRejoin && !invite && !blocked && <p className="info">You can&apos;t ask to rejoin this test.</p>}
      {/* (Owner's repro, Oct 29, batch 30 §8) Their application or ask, followed live: accepted (the line and Go to your session →), declined (the line below). */}
      {t.developerId !== u.id && !isAdmin(u) && <JoinWatch testId={t.id} v={joinFp} />}
      {/* (Owner, Nov 11, §380 K) The tester's join page: one page per test at a time, across devices. */}
      {t.developerId !== u.id && !isAdmin(u) && <OnePage scope={joinScope(t.id)} />}
      {t.developerId !== u.id && !isAdmin(u) && myApp?.status === "declined" && <p className="info" data-app-declined="">{myApp.kind === "rejoin" ? rejoinDeclinedLine : applyDeclinedLine(t.title)}</p>}
      {/* (Batch 17 section 8) The team never gets Join / Apply. */}
      {isAdmin(u) && t.developerId !== u.id ? null : t.developerId === u.id ? (
        <div className="card flex flex-wrap items-center gap-3">
          <p className="flex-1 text-slate-200">This is your own test: this is how testers see it. You can&apos;t test it yourself.</p>
          <a href={sideLink(u, `/app/tests/${t.id}`)} className="btn-secondary no-underline hover:no-underline">Manage it as the developer <ArrowRight className="h-4 w-4" /></a>
        </div>
      ) : !u.isTester ? (
        <p className="card note">Turn on “test apps, games and more” in your <a href="/app/profile">profile</a> to join.</p>
      ) : blocked ? (
        <p className="card note">This test isn&apos;t taking new testers right now.</p>
      ) : closed && invite && t.status === "open" && full ? (
        <p className="info"><TestName text={t.title} /> is full right now. Your invite stays open; we&apos;ll tell you when a spot opens.</p>
      ) : paused ? (
        <p className="info" data-paused="">This test is paused right now.</p>
      ) : closed ? (
        <p className="err">{t.status === "stopped" ? "This test was stopped." : full ? "This test is full." : keyless ? NO_FREE_KEY : "This test isn't taking new testers any more."}</p>
      ) : (
        <>{gaps.map((g) => <p key={g} className="info">{g}</p>)}</>
      )}
      {t.developerId === u.id || isAdmin(u) || !u.isTester || closed || blocked || ratedHere || (!!mine && !canRejoin && !invite) ? null : (
        <div>
          <JoinBox
            termsAgain={needsTermsAgain(u)}
            rejoin={canRejoin}
            timeBack={mine && mine.endedAt ? leftText(mine.dueAt.getTime() - mine.endedAt.getTime()) : undefined}
            nda={t.ndaText}
            testId={t.id}
            seenAt={seenAt}
            mode={t.joinMode}
            invited={!!invite}
            inviteId={invite?.id ?? null}
            missing={gapsOf(t, profile)}
            needs={{ devices: t.devices, languages: t.languages }}
            devName={dev}
            spotsLeft={t.spots - testersIn}
            dueIfNow={dueIfNow}
            payoutHint={!(u.stripeAccountId && u.payoutsReady)}
            application={myApp ? { status: myApp.status, changed: !!myApp.changedAt, kind: myApp.kind } : null}
          />
        </div>
      )}
    </div>
    </SeeItTarget>
  );

  });
}
