import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/components/AuthShell";
import { PasswordInput } from "@/components/PasswordInput";

export const metadata = { title: "Choose a new password · Playtest" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <AuthShell title="Choose a new password">
      <AuthForm path="/api/auth/reset" extra={{ token }} next="/login?reset=1" submit="Save the new password" busy="Saving…">
        <div>
          <label className="label req" htmlFor="password">New password</label>
          <PasswordInput id="password" name="password" autoComplete="new-password" minLength={8} required data-required="" data-required-msg="Use at least 8 characters" data-min-chars="8" data-msg="Use at least 8 characters" data-match="at least 8|200 characters" />
        </div>
        <div>
          <label className="label req" htmlFor="confirm">Type it again</label>
          <PasswordInput id="confirm" name="confirm" autoComplete="new-password" minLength={8} required data-match="don't match" />
        </div>
        <p className="text-xs text-slate-500">At least 8 characters. Saving signs you out on every device.</p>
      </AuthForm>
    </AuthShell>
  );
}
