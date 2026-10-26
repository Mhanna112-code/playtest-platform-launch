"use client";
import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { PasswordInput } from "@/components/PasswordInput";
import { useSignedInElsewhere } from "@/components/SessionWatch";

export function LoginForm({ reset, google, next = "/app" }: { reset: boolean; google: boolean; next?: string }) {
  // (Design doc 2) Signing in in another tab brings this login page along, back to where it was.
  useSignedInElsewhere(next);
  return (
    <AuthForm path="/api/auth/login" next={next} announce="in" submit="Log in" busy="Logging in…" footer={<p className="text-sm text-slate-400">New here? <Link href="/signup" className="text-indigo-300 hover:underline">Create an account</Link></p>}>
      {reset && <p className="text-emerald-300">Password changed. Log in with the new one.</p>}
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
        <Link href="/forgot" className="mt-1 inline-block text-xs text-indigo-300 hover:underline">Forgot your password?</Link>
      </div>
    </AuthForm>
  );
}
