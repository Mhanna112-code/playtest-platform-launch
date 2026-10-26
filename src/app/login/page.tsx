import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { GOOGLE_MESSAGES, googleConfigured } from "@/lib/server/google";
import { getPageUser } from "@/lib/server/page-auth";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Log in · Playtest" };

/** Only addresses inside the app can be returned to after logging in. */
const safe = (n?: string) => (n && /^\/(app|admin)([/?#]|$)/.test(n) ? n : undefined);

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; reset?: string; gone?: string; next?: string }> }) {
  const { error, reset, gone, next } = await searchParams;
  if (await getPageUser()) redirect(safe(next) ?? "/app");
  return (
    <AuthShell title="Log in">
      {/* (Design doc 2) A deleted account (by the team, or by you on another device) lands here from every open tab, with a red notice. */}
      {gone && <p className="err-field mb-3" role="alert" data-account-gone="">This account no longer exists.</p>}
      {error && GOOGLE_MESSAGES[error] && <p className="err">{GOOGLE_MESSAGES[error]}</p>}
      <LoginForm reset={!!reset} google={googleConfigured()} next={safe(next)} />
    </AuthShell>
  );
}
