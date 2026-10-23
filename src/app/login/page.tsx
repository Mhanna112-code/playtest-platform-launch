import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { GOOGLE_MESSAGES, googleConfigured } from "@/lib/server/google";
import { getPageUser } from "@/lib/server/page-auth";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Log in · Playtest" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; reset?: string }> }) {
  if (await getPageUser()) redirect("/app");
  const { error, reset } = await searchParams;
  return (
    <AuthShell title="Log in">
      {error && GOOGLE_MESSAGES[error] && <p className="err">{GOOGLE_MESSAGES[error]}</p>}
      <LoginForm reset={!!reset} google={googleConfigured()} />
    </AuthShell>
  );
}
