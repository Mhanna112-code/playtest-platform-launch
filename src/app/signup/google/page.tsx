import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/components/AuthShell";
import { GOOGLE_SIGNUP_COOKIE, GOOGLE_STEP_EXPIRED, pendingGoogleSignup } from "@/lib/server/google";
import { getPageUser } from "@/lib/server/page-auth";
import { AGE_TICK } from "@/lib/termsOfUse";

export const metadata = { title: "Finish signing up · Playtest" };

/**
 * (Owner, Oct 28, batch 20 section 5) After Google answers for a NEW account: one short step before the account exists, the Terms agreement and "I'm 18 or
 * older.", then Continue. Nothing is created until both are ticked (each is red at its box when missing).
 */
export default async function GoogleSignupStep() {
  if (await getPageUser()) redirect("/app");
  const step = await pendingGoogleSignup((await cookies()).get(GOOGLE_SIGNUP_COOKIE)?.value);
  if (!step)
    return (
      <AuthShell title="Finish signing up">
        <div className="card space-y-3">
          <p className="info" data-google-step-expired="">{GOOGLE_STEP_EXPIRED}</p>
          <Link href="/signup" className="btn w-full no-underline hover:no-underline">Back to sign up</Link>
        </div>
      </AuthShell>
    );
  return (
    <AuthShell title="Finish signing up">
      <AuthForm path="/api/auth/google/finish" next="/app" announce="in" submit="Continue" busy="Creating…">
        <p className="text-sm text-slate-300" data-google-step="">Signing up with Google as <b className="text-white">{step.email}</b>.</p>
        {/* (Batch 26 section 11) The red line under the whole tick row; every missing tick is red. */}
        <label className="flex items-start gap-2 text-sm text-slate-300" data-note-after="">
          <input type="checkbox" id="acceptTerms" name="acceptTerms" value="yes" required className="mt-1" data-match="terms of use" />
          <span>I agree to the <a href="/terms" target="_blank" className="text-indigo-300 underline">Terms of Use</a> and the <a href="/privacy" target="_blank" className="text-indigo-300 underline">Privacy policy</a>.</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-300" data-note-after="">
          <input type="checkbox" id="over18" name="over18" value="yes" required className="mt-1" data-match="18 or older" />
          <span>{AGE_TICK}</span>
        </label>
      </AuthForm>
    </AuthShell>
  );
}
