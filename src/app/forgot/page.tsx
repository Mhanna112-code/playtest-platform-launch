import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/components/AuthShell";

export const metadata = { title: "Reset your password · Playtest" };

/** "Forgot your password?": always the same answer, so it can't reveal who has an account. */
export default function ForgotPage() {
  return (
    <AuthShell title="Reset your password" intro="Enter your account's email and we'll send a link to choose a new password. (Signed in with an email link before? Choose your password here.)">
      <AuthForm
        path="/api/auth/forgot"
        submit="Send the reset link"
        busy="Sending…"
        done={
          <>
            <p className="ok">Check your email.</p>
            <p className="note">If there&apos;s an account for that address, a reset link is on its way. It works once, for 60 minutes. Nothing arriving? Check spam, or try again in a few minutes.</p>
            <Link href="/login" className="text-sm">Back to log in</Link>
          </>
        }
        footer={<p className="note"><Link href="/login">Back to log in</Link></p>}
      >
        <div>
          <label className="label req" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" required autoComplete="email" />
        </div>
      </AuthForm>
    </AuthShell>
  );
}
