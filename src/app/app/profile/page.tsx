import { withDateZone } from "@/lib/server/dateZone";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireOpenPage } from "@/lib/server/page-auth";
import { ProfileForm } from "./ProfileForm";
import { ratingSummary } from "@/lib/server/ratings";
import { sideFor } from "@/lib/sides";
import { ReasonQuote } from "@/components/ScrollText";
import { ScrollList } from "@/components/ScrollList";
import { AccountRefresh } from "@/components/AccountRefresh";

export const metadata = { title: "Profile · Playtest" };
export const dynamic = "force-dynamic";

/**
 * Your profile, for the side in use (the full app's /profile for testers and /dev/profile for developers): the form,
 * then your ratings. (Owner, Oct 27: "Change your password" moved to Account, which stays open to a suspended or held account.)
 * (Owner, Nov 3, batch 35 §134) The name and pronoun are the account's (shown on both sides); the bio is the side's own: the developer's (User.devBio) or the
 * tester's (TesterProfile.bio).
 */
export default async function ProfilePage() {
  const u = await requireOpenPage("/app/profile");
  return withDateZone(u.timeZone, async () => {
 // (Owner, Oct 28) closed to a restricted account: it moves to the dashboard top before anything renders
  const side = sideFor(u, "/app/profile");
  const p = await db.testerProfile.findUnique({ where: { userId: u.id } });
  // (Batch 35 §134) An account with no side yet (sign-up asks for one, so only an older account): choosing developer, tester or both is required here, before
  // anything else (the dashboard sends it here); Continue then opens the dashboard. An admin never comes here (it has its own setup on /app).
  if (!side)
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-2xl font-semibold">Your profile</h1>
        <p className="mb-6 text-slate-400">Tell us who you are.</p>
        <ProfileForm first init={{ name: u.name, pronoun: u.pronoun, isDeveloper: false, isTester: false, devices: p?.devices ?? [], categories: p?.categories ?? [], languages: p?.languages ?? [], bio: p?.bio ?? "" }} />
      </div>
    );
  const rating = await ratingSummary(u.id, side); // (Owner, Nov 5, §276) "Your ratings" on this side's profile: the ones they got on this side only
  return (
    <div className="mx-auto max-w-2xl">
      {side === "developer" ? (
        <>
          <h1 className="mb-2 text-2xl font-semibold">Your developer profile</h1>
          <p className="mb-6 text-slate-400">
            Testers see your name when they hover or open it on your tests, with how you review and your ratings. <Link href={`/app/developers/${u.id}`} className="text-sky-300 hover:underline">See it as testers do</Link>
          </p>
        </>
      ) : (
        <>
          <h1 className="mb-2 text-2xl font-semibold">Your tester profile</h1>
          <p className="mb-2 text-slate-400">Developers see your bio, languages and ratings when they hover your name. Your devices and languages decide which tests fit you.</p>
          <p className="mb-6 text-sm"><Link href={`/app/testers/${u.id}`} className="text-sky-300 hover:underline">How developers see you</Link> <span className="text-slate-500">(your profile and figures as they see them)</span></p>
        </>
      )}
      {/* (Batch 16 section 27) Saved in another tab or device: this page updates silently; the first Save afterwards stops once. */}
      <AccountRefresh />
      <ProfileForm side={side} seenAt={new Date().toISOString()} init={{ name: u.name, pronoun: u.pronoun, isDeveloper: u.isDeveloper, isTester: u.isTester, devices: p?.devices ?? [], categories: p?.categories ?? [], languages: p?.languages ?? [], bio: side === "developer" ? u.devBio : p?.bio ?? "" }} />
      <div className="mt-6 space-y-6">
        <section className="card space-y-2" aria-label="Your ratings">
          <h2 className="font-semibold text-white">Your ratings</h2>
          {rating.line ? <p className="text-slate-200">{rating.line}</p> : <p className="text-sm text-slate-400">No ratings yet.</p>}
          {/* (Owner, Nov 5, §237) Each comment in its reason box (drags taller; no Show more), all of them in the draggable list panel (no "Show N more" box
              around the boxes: one scroll for the list, one for each comment). */}
          {rating.comments.length > 0 && <ScrollList size="lines" id="rating-comments" label="Rating comments" className="space-y-2 text-sm" as="ul">{rating.comments.map((c, i) => <li key={i} data-rating-comment=""><ReasonQuote id={`rating-comment-${i}`} label="Comment" text={c} /></li>)}</ScrollList>}
        </section>
      </div>
    </div>
  );

  });
}
