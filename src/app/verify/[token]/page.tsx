import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { confirmEmail } from "@/lib/server/passwords";

export const metadata = { title: "Confirm your email · Playtest" };
export const dynamic = "force-dynamic";

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await confirmEmail(token);
  return (
    <AuthShell title={r.ok ? "Email confirmed" : "This link didn't work"}>
      <div className="card space-y-3">
        {r.ok ? <p className="ok">Thanks: {r.email} is confirmed.</p> : <p className="err">This link has expired or isn&apos;t right. Log in and press Resend to get a new one.</p>}
        <Link className="btn" href="/app">Open the app</Link>
      </div>
    </AuthShell>
  );
}
