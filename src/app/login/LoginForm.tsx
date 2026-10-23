"use client";
import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { PasswordInput } from "@/components/PasswordInput";

export function LoginForm({ reset, google }: { reset: boolean; google: boolean }) {
  return (
    <AuthForm path="/api/auth/login" next="/app" submit="Log in" busy="Logging in…" footer={<p className="note">New here? <Link href="/signup">Create an account</Link></p>}>
      {reset && <p className="ok">Password changed. Log in with the new one.</p>}
      {google && (
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
        <PasswordInput id="password" name="password" autoComplete="current-password" required />
        <Link href="/forgot" className="mt-1 inline-block text-xs">Forgot your password?</Link>
      </div>
    </AuthForm>
  );
}
