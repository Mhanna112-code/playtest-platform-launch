import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import { requirePageUser } from "@/lib/server/page-auth";
import { TOPICS } from "@/lib/helpTopics";
import { ContactForm } from "./ContactForm";

export const metadata = { title: "Contact us · Playtest" };

/** Contact the team (the full app's Help page, adapted: the team answers by email). */
export default async function HelpPage() {
  await requirePageUser();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-white"><LifeBuoy className="h-7 w-7 text-sky-300" /> Contact us</h1>
        <p className="text-slate-400">A question, a problem with a payment, or something that isn&apos;t working: write to the team. To challenge a payment, use <strong className="text-slate-200">Dispute the pay</strong> on the work; to report a problem with a call, use <strong className="text-slate-200">Report a problem</strong> on it.</p>
      </div>
      <ContactForm topics={TOPICS} />
      <p className="text-xs text-slate-500">Read the <Link href="/terms" className="underline">Terms of Use</Link> for how reviews, payments and disputes work, and the <Link href="/privacy" className="underline">Privacy policy</Link>.</p>
    </div>
  );
}
