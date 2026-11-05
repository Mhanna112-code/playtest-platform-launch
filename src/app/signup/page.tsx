import { CountedInput } from "@/components/CountedInput";
import { LIMITS } from "@/lib/limits";
import { EMAIL_MAX } from "@/lib/format";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/components/AuthShell";
import { PasswordInput } from "@/components/PasswordInput";
import { RoleChoice } from "@/components/RoleChoice";
import { googleConfigured } from "@/lib/server/google";
import { getPageUser } from "@/lib/server/page-auth";
import { AGE_TICK } from "@/lib/termsOfUse";

export const metadata = { title: "Create an account · Playtest" };

/**
 * Sign up, as the full app's: I am a... (developer or tester), name, email, password and the Terms of Use. (Batch 35 §134) Every one is required: the account is
 * made with its side. (Batch 35 §162) No "Both" any more (the other side is added later in Settings); the pronoun and the chosen side's bio are optional.
 */
export default async function SignupPage() {
  if (await getPageUser()) redirect("/app");
  return (
    <AuthShell title="Create an account">
      <AuthForm allAtOnce path="/api/auth/signup" next="/app" announce="in" submit="Sign up" busy="Creating…" footer={<p className="text-sm text-slate-400">Already have an account? <Link href="/login" className="text-indigo-300 hover:underline">Log in</Link></p>}>
        {googleConfigured() && (
          <>
            <a className="btn-ghost w-full" href="/api/auth/google/start">Continue with Google</a>
            <p className="note text-center">or</p>
          </>
        )}
        {/* (Batch 35 §162) The Name box sits inside the choice's fields: after it the optional Pronoun and the chosen side's bio. */}
        <RoleChoice>
          <div>
            <label className="label req" htmlFor="name">Name</label>
            <CountedInput minLength={1} maxLength={LIMITS.personName} className="input" id="name" name="name" autoComplete="name" required data-required="" data-required-msg="Enter your name" data-match="your name" />
          </div>
        </RoleChoice>
        {/* (Owner, Nov 1, §114) "This account was closed." (a deleted account's email that can't sign up again) is red here too, with Contact us after it. */}
        <div>
          <label className="label req" htmlFor="email">Email</label>
          <CountedInput maxLength={EMAIL_MAX} className="input" id="email" name="email" type="email" autoComplete="email" required data-required="" data-required-msg="Enter a valid email" data-match="email|account was closed" />
        </div>
        <div>
          <label className="label req" htmlFor="password">Password</label>
          <PasswordInput id="password" name="password" autoComplete="new-password" minLength={8} required data-required="" data-required-msg="Password must be at least 8 characters" data-min-chars="8" data-msg="Password must be at least 8 characters" data-match="password|200 characters" />
        </div>
        {/* (Batch 26 section 11) data-note-after: a red line goes under the whole tick row, never between the tick and its words. */}
        <label className="flex items-start gap-2 text-sm text-slate-300" data-note-after="">
          <input type="checkbox" id="acceptTerms" name="acceptTerms" value="yes" required className="mt-1" data-match="terms of use" />
          <span>I agree to the <a href="/terms" target="_blank" className="text-indigo-300 underline">Terms of Use</a> and the <a href="/privacy" target="_blank" className="text-indigo-300 underline">Privacy policy</a>.</span>
        </label>
        {/* (Owner, Oct 28, batch 20 section 5) Required, next to the Terms agreement: Sign up is refused (red here) until it's ticked. */}
        <label className="flex items-start gap-2 text-sm text-slate-300" data-note-after="">
          <input type="checkbox" id="over18" name="over18" value="yes" required className="mt-1" data-match="18 or older" />
          <span>{AGE_TICK}</span>
        </label>
      </AuthForm>
    </AuthShell>
  );
}
