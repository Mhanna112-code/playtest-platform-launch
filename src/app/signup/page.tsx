import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/components/AuthShell";
import { PasswordInput } from "@/components/PasswordInput";
import { googleConfigured } from "@/lib/server/google";
import { getPageUser } from "@/lib/server/page-auth";

export const metadata = { title: "Create an account · Playtest" };

export default async function SignupPage() {
  if (await getPageUser()) redirect("/app");
  return (
    <AuthShell title="Create an account" intro="Then tell us your name and whether you make games, test them, or both.">
      <AuthForm path="/api/auth/signup" next="/app" submit="Sign up" busy="Creating…" footer={<p className="note">Already have an account? <Link href="/login">Log in</Link></p>}>
        {googleConfigured() && (
          <>
            <a className="btn-ghost w-full" href="/api/auth/google/start">Continue with Google</a>
            <p className="note text-center">or</p>
          </>
        )}
        <div>
          <label className="label req" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className="label req" htmlFor="password">Password</label>
          <PasswordInput id="password" name="password" autoComplete="new-password" minLength={8} required />
          <p className="mt-1 text-xs text-ink-500">At least 8 characters.</p>
        </div>
      </AuthForm>
    </AuthShell>
  );
}
