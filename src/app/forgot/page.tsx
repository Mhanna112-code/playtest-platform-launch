import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/components/AuthShell";

export const metadata = { title: "Reset your password · Playtest" };

/** "Forgot your password?": always the same answer, so it can't reveal who has an account. */
export default function ForgotPage() {
  return (
    <AuthShell title="Reset your password" intro="Enter your account's email and we'll send a link to choose a new password.">
      <AuthForm
        path="/api/auth/forgot"
        submit="Send the reset link"
        busy="Sending…"
        done={
          <>
            <p className="text-emerald-300">Check your email.</p>
            <p className="text-sm text-slate-300">If there&apos;s an account for that address, a reset link is on its way. It works once, for 60 minutes. Nothing arriving? Check spam, or try again in a few minutes.</p>
            <Link href="/login" className="text-sm text-indigo-300 hover:underline">Back to log in</Link>
          </>
        }
        footer={<p className="text-sm text-slate-400"><Link href="/login" className="text-indigo-300 hover:underline">Back to log in</Link></p>}
      >
        <div>
          <label className="label req" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" required autoComplete="email" data-required="" data-required-msg="Enter a valid email" data-match="email" />
        </div>
      </AuthForm>
    </AuthShell>
  );
}
