import { redirect } from "next/navigation";
import { Brand } from "@/components/Brand";
import { GOOGLE_MESSAGES, googleConfigured } from "@/lib/server/google";
import { getPageUser } from "@/lib/server/page-auth";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · Playtest" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getPageUser()) redirect("/app");
  const { error } = await searchParams;
  return (
    <main className="wrap max-w-xl space-y-4">
      <Brand />
      <div className="panel">
        <h1>Sign in</h1>
        <p className="note">No password: we email you a link. New here? The same link creates your account.</p>
        {error && GOOGLE_MESSAGES[error] && <p className="err">{GOOGLE_MESSAGES[error]}</p>}
        {googleConfigured() && (
          <>
            <a className="btn-ghost" href="/api/auth/google/start">
              Continue with Google
            </a>
            <p className="note">Or get a sign-in link by email:</p>
          </>
        )}
        <LoginForm />
      </div>
    </main>
  );
}
