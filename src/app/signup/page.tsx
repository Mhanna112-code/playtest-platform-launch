import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/components/AuthShell";
import { PasswordInput } from "@/components/PasswordInput";
import { googleConfigured } from "@/lib/server/google";
import { getPageUser } from "@/lib/server/page-auth";

export const metadata = { title: "Create an account · Playtest" };

const ROLE = "flex cursor-pointer items-center gap-2 rounded-lg border border-slate-600 p-3 has-[:checked]:border-indigo-400";

/** Sign up, as the full app's: I am a... (developer, tester or both), name, email, password and the Terms of Use. */
export default async function SignupPage() {
  if (await getPageUser()) redirect("/app");
  return (
    <AuthShell title="Create an account">
      <AuthForm path="/api/auth/signup" next="/app" submit="Sign up" busy="Creating…" footer={<p className="text-sm text-slate-400">Already have an account? <Link href="/login" className="text-indigo-300 hover:underline">Log in</Link></p>}>
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
          <input className="input" id="name" name="name" autoComplete="name" required />
        </div>
        <div>
          <label className="label req" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className="label req" htmlFor="password">Password</label>
          <PasswordInput id="password" name="password" autoComplete="new-password" minLength={8} required />
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-300">
          <input type="checkbox" name="acceptTerms" value="yes" required className="mt-1" />
          <span>I agree to the <a href="/terms" target="_blank" className="text-indigo-300 underline">Terms of Use</a> and the <a href="/privacy" target="_blank" className="text-indigo-300 underline">Privacy policy</a>.</span>
        </label>
      </AuthForm>
    </AuthShell>
  );
}
