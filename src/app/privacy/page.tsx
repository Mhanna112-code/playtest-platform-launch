import Link from "next/link";
import { Lock } from "lucide-react";
import { PublicShell } from "@/components/PublicShell";

export const metadata = { title: "Privacy Policy · Playtest" };

// Copied from the full app's Privacy Policy and adapted to the lean app (no phone numbers, texts, transcripts, AI, device
// fingerprints or waitlist tracking). DRAFT: the owner reviews the wording (and a lawyer should) before launch.
const SECTIONS: { title: string; points: string[] }[] = [
  {
    title: "What we collect",
    points: [
      "Your account: name, email, password (stored only as a one-way hash), the sides you use (developer, tester or both).",
      "Your profile: bio, interests, devices and languages.",
      "What you do on the site: tests posted and joined, the work you send (written answers, recordings), chat messages, call requests and calls (who joined and when), ratings and reviews, offers, invitations and messages to the team.",
      "The waitlist (before the site opens): your email. We use it only to email you when the site opens.",
      "Payments: amounts, charges and payouts. Card and bank details are handled by Stripe and never stored on our servers.",
      "Technical basics: a sign-in cookie, and your IP address for limiting repeated login attempts. No advertising or tracking cookies.",
    ],
  },
  {
    title: "How we use it",
    points: [
      "To run the service: matching testers to tests, delivering work to developers, charging developers and paying testers, and sending the notifications and emails you chose.",
      "To keep it safe and fair: preventing abuse, handling reports about people, and deciding disputes. For a dispute or a report about someone, the team can read the related chat.",
    ],
  },
  {
    title: "Who sees what",
    points: [
      "Developers see the work and chats of testers on their own tests, and the public parts of tester profiles (never your email).",
      "Testers see the tests they can join and the developer's name and review record.",
      "Service providers who act for us: Stripe (payments), our email provider (Resend), and our hosting and database providers. They only use the data to provide their service to us.",
      "We don't sell your data, and we don't share it with advertisers.",
    ],
  },
  {
    title: "How long we keep it",
    points: [
      "While your account is open. Payment records are kept as long as tax and accounting law requires (usually several years), even after you leave.",
      "Login links and password reset links expire within 48 hours and 1 hour.",
    ],
  },
  {
    title: "Your choices and rights",
    points: [
      "Change your profile and email settings at any time.",
      "Ask for a copy of your data, a correction, or for your account to be deleted, through Contact us. We answer within 30 days. Deleting an account removes your profile and content; payment records we must keep are kept separately.",
      "Block people you don't want to work with; report problems with a call.",
    ],
  },
  {
    title: "Age",
    points: ["You must be at least 18 to use the site, because it involves contracts and payments."],
  },
  {
    title: "Changes",
    points: ["If this policy changes in a way that matters, we'll tell you on the site before it applies, like with the Terms of Use."],
  },
];

/** The privacy policy, in plain language. A draft until the owner has reviewed it. */
export default function PrivacyPage() {
  return (
    <PublicShell>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-white"><Lock className="h-7 w-7 text-volt-300" /> Privacy Policy</h1>
          <p className="text-slate-400">What we collect, why, who can see it, and what you can do about it. Written plainly, to match how the site actually works.</p>
          <p className="font-mono text-xs text-slate-500">Draft, wording to be reviewed before launch</p>
        </div>
        {SECTIONS.map((s) => (
          <section key={s.title} className="card space-y-2">
            <h2 className="font-semibold text-white">{s.title}</h2>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-300">{s.points.map((p) => <li key={p}>{p}</li>)}</ul>
          </section>
        ))}
        <p className="text-sm text-slate-400">Questions? <Link href="/app/help" className="text-indigo-300 underline">Contact us</Link>. See also the <Link href="/terms" className="text-indigo-300 underline">Terms of Use</Link>.</p>
      </div>
    </PublicShell>
  );
}
