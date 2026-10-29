import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/components/AuthShell";
import { PasswordInput } from "@/components/PasswordInput";
import { googleConfigured } from "@/lib/server/google";
import { getPageUser } from "@/lib/server/page-auth";
import { AGE_TICK } from "@/lib/termsOfUse";

export const metadata = { title: "Create an account · Playtest" };

const ROLE = "flex cursor-pointer items-center gap-2 rounded-lg border border-slate-600 p-3 has-[:checked]:border-indigo-400";

/** Sign up, as the full app's: I am a... (developer, tester or both), name, email, password and the Terms of Use. */
export default async function SignupPage() {
  if (await getPageUser()) redirect("/app");
  return (
    <AuthShell title="Create an account">
      <AuthForm path="/api/auth/signup" next="/app" announce="in" submit="Sign up" busy="Creating…" footer={<p className="text-sm text-slate-400">Already have an account? <Link href="/login" className="text-indigo-300 hover:underline">Log in</Link></p>}>
        {googleConfigured() && (
          <>
            <a className="btn-ghost w-full" href="/api/auth/google/start">Continue with Google</a>
            <p className="note text-center">or</p>
          </>
        )}
        <fieldset>
          <legend className="label req">I am a…</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={ROLE}><input type="radio" name="role" value="developer" required /> Developer or maker</label>
            <label className={ROLE}><input type="radio" name="role" value="tester" required /> Tester</label>
            <label className={ROLE}><input type="radio" name="role" value="both" required /> Both</label>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">One account either way: with both, switch sides from the button next to your name.</p>
        </fieldset>
        <div>
          <label className="label req" htmlFor="name">Name</label>
          <input className="input" id="name" name="name" autoComplete="name" required data-required="" data-required-msg="Enter your name" data-match="your name" />
        </div>
        <div>
          <label className="label req" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required data-required="" data-required-msg="Enter a valid email" data-match="email" />
        </div>
        <div>
          <label className="label req" htmlFor="password">Password</label>
          <PasswordInput id="password" name="password" autoComplete="new-password" minLength={8} required data-required="" data-required-msg="Password must be at least 8 characters" data-min-chars="8" data-msg="Password must be at least 8 characters" data-match="password|200 characters" />
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-300">
          <input type="checkbox" id="acceptTerms" name="acceptTerms" value="yes" required className="mt-1" data-match="terms of use" />
          <span>I agree to the <a href="/terms" target="_blank" className="text-indigo-300 underline">Terms of Use</a> and the <a href="/privacy" target="_blank" className="text-indigo-300 underline">Privacy policy</a>.</span>
        </label>
        {/* (Owner, Oct 28, batch 20 section 5) Required, next to the Terms agreement: Sign up is refused (red here) until it's ticked. */}
        <label className="flex items-start gap-2 text-sm text-slate-300">
          <input type="checkbox" id="over18" name="over18" value="yes" required className="mt-1" data-match="18 or older" />
          <span>{AGE_TICK}</span>
        </label>
      </AuthForm>
    </AuthShell>
  );
}
