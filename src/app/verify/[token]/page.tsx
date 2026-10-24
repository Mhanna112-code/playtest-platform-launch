import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { AuthShell } from "@/components/AuthShell";
import { confirmEmail } from "@/lib/server/passwords";

export const metadata = { title: "Confirm your email · Playtest" };
export const dynamic = "force-dynamic";

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await confirmEmail(token);
  return (
    <AuthShell title={r.ok ? "Email confirmed" : "That link didn't work"}>
      <div className="card space-y-3">
        {r.ok ? (
          <>
            <p className="flex items-center gap-2 text-lg font-semibold text-emerald-300"><CheckCircle2 className="h-5 w-5" /> Email confirmed</p>
            <p className="text-slate-300">Thanks: {r.email} is confirmed. You can post and join tests now.</p>
            <Link href="/app" className="btn w-fit no-underline hover:no-underline">Go to your dashboard</Link>
          </>
        ) : (
          <>
            <p className="flex items-center gap-2 text-lg font-semibold text-rose-300"><XCircle className="h-5 w-5" /> That link didn&apos;t work</p>
            <p className="text-slate-300">This link has expired or isn&apos;t right. Log in and press Resend to get a new one.</p>
            <Link href="/app" className="btn-secondary w-fit no-underline hover:no-underline">Go to your dashboard</Link>
          </>
        )}
      </div>
    </AuthShell>
  );
}
