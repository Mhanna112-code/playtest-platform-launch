import Link from "next/link";
import { Brand } from "@/components/Brand";
import { WaitlistForm } from "@/components/WaitlistForm";
import { getPageUser } from "@/lib/server/page-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const u = await getPageUser();
  return (
    <main className="mx-auto max-w-4xl space-y-10 px-4 py-6">
      <nav className="flex items-center gap-4">
        <Brand />
        <span className="ml-auto" />
        {u ? <Link className="btn" href="/app">Open the app</Link> : (
          <>
            <Link className="nav-link" href="/login">Log in</Link>
            <Link className="btn" href="/signup">Sign up</Link>
          </>
        )}
      </nav>

      <section className="space-y-4 pt-6">
        <p className="kicker">Playtesting, paid fairly</p>
        <h1 className="text-4xl font-extrabold leading-tight sm:text-5xl">
          Real players test your game.
          <br />
          You choose what to pay.
        </h1>
        <p className="max-w-2xl text-lg text-ink-200">
          Post a test with your build, your questions and your prices. Testers join on a contract, send written answers or a screen
          recording, or jump on a live call. You review what they sent and pay what it was worth.
        </p>
        <WaitlistForm />
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="panel">
          <h3>One contract, no haggling</h3>
          <p className="note">Prices, questions, call terms and the deadline are set when a tester joins. If you update the listing, working testers get an offer they can Switch to or Keep; work already sent keeps its price.</p>
        </div>
        <div className="panel">
          <h3>Pay what it was worth</h3>
          <p className="note">One Pay box per piece of work: the listing price is filled in; pay less with a reason, or more for great work.</p>
        </div>
        <div className="panel">
          <h3>Testers get 80%</h3>
          <p className="note">Payouts go straight to the tester&apos;s Stripe account. Paid less than the listing? They can dispute it once: our team decides, and a decision can only raise the pay, up to the listing amount.</p>
        </div>
      </section>
    </main>
  );
}
