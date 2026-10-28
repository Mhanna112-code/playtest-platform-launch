import Link from "next/link";
import { AppWindow, ArrowRight, BadgeDollarSign, Bot, Check, Code2, FileText, Gamepad2, Glasses, Monitor, Radio, ShieldCheck, Smartphone, Video, Wand2, X } from "lucide-react";
import { Brand } from "@/components/Brand";
import { getPageUser } from "@/lib/server/page-auth";
import { REVIEW_DAYS } from "@/lib/rules";

export const dynamic = "force-dynamic";

// The full app's home page (marketing), adapted to lean: no transcripts, themes, search or subscription (lean has none).
// (Owner, Oct 28, batch 16 section 7) No waitlist: the site launches with open sign-up.
export default async function Home() {
  const u = await getPageUser();
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-ink-950/75 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3">
          <Brand />
          <div className="ml-auto flex items-center gap-2">
            {u ? <Link className="btn px-3 py-1.5 text-sm no-underline hover:no-underline" href="/app">Open the app</Link> : (
              <>
                <Link className="nav-link" href="/login">Log in</Link>
                <Link className="btn px-3 py-1.5 text-sm no-underline hover:no-underline" href="/signup">Sign up</Link>
              </>
            )}
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl space-y-24 px-4 py-8 pb-8">
        {/* Hero */}
        <section className="mx-auto max-w-3xl space-y-7 pt-6 text-center">
          <p className="kicker">Playtesting · user testing · honest feedback</p>
          <h1 className="text-5xl font-extrabold leading-[1.02] text-white sm:text-6xl">
            Find out where real people get{" "}
            <span className="relative inline-block text-volt-300">
              stuck
              <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true">
                <path d="M2 8 C 40 2, 70 12, 100 6 S 160 2, 198 7" stroke="#ff3f72" strokeWidth="4" fill="none" strokeLinecap="round" />
              </svg>
            </span>
            .
          </h1>
          <p className="mx-auto max-w-xl text-lg leading-relaxed text-slate-300">
            Real people try your game, app or website, then send written answers, a screen recording, or hop on a live call. You review what they sent and pay what it was worth.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {u ? (
              <Link href="/app" className="btn px-6 py-3 text-base no-underline hover:no-underline">Go to your dashboard <ArrowRight className="h-4 w-4" /></Link>
            ) : (
              <>
                <Link href="/signup" className="btn px-6 py-3 text-base no-underline hover:no-underline">Get feedback on my build <ArrowRight className="h-4 w-4" /></Link>
                <Link href="/signup" className="btn-secondary px-6 py-3 text-base no-underline hover:no-underline">Earn as a tester</Link>
              </>
            )}
          </div>
          <ul className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-slate-400">
            {["Free to post", "Pay only for the work you accept", "Testers keep 80%"].map((t) => (
              <li key={t} className="flex items-center gap-1.5"><Check className="h-4 w-4 text-volt-300" /> {t}</li>
            ))}
          </ul>
        </section>

        {/* Product types */}
        <section className="space-y-5">
          <p className="text-center font-mono text-xs uppercase tracking-[0.2em] text-slate-500">For anything people can try</p>
          <div className="flex flex-wrap justify-center gap-2">
            {PRODUCTS.map(({ icon: Icon, label, color }) => (
              <span key={label} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-200">
                <Icon className={`h-4 w-4 ${color}`} /> {label}
              </span>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="space-y-10">
          <Heading kicker="How it works" title="From build to “aha” in three steps" />
          <ol className="grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="card card-hover relative overflow-hidden">
                <span className="absolute -right-2 -top-6 font-display text-[7rem] font-extrabold leading-none text-white/[0.04]">{i + 1}</span>
                <s.icon className="mb-4 h-8 w-8 text-volt-300" />
                <h3 className="mb-2 text-xl font-bold text-white">{s.title}</h3>
                <p className="text-slate-400">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Formats */}
        <section className="space-y-10">
          <Heading kicker="Feedback your way" title="You choose the parts and prices." sub="Offer any mix and mark each one Required or Not required." />
          <div className="grid gap-4 md:grid-cols-3">
            {FORMATS.map((f) => (
              <div key={f.title} className="card card-hover space-y-4 border-t-4" style={{ borderTopColor: f.color }}>
                <div className="flex items-center justify-between">
                  <f.icon className="h-7 w-7" style={{ color: f.color }} />
                  <span className="font-mono text-xs text-slate-500">{f.price}</span>
                </div>
                <h3 className="text-xl font-bold text-white">{f.title}</h3>
                <ul className="space-y-2 text-sm text-slate-300">
                  {f.points.map((p) => <li key={p} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" /> {p}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Fair for both sides */}
        <section className="space-y-10">
          <Heading kicker="Fair by design" title="Clear rules both sides agree to before anyone starts" sub="Most testing platforms leave “was it good enough?” to a gut feeling. Here it's written down." />
          <div className="grid gap-4 md:grid-cols-2">
            <FairCard title="For makers" icon={BadgeDollarSign} tone="text-volt-300" points={[
              "Write your questions and prices up front, then pay what each piece of work was worth",
              "Pay the listed amount, or any amount with a reason ($0 included)",
              "Chat with testers, invite the best back for your next round",
            ]} />
            <FairCard title="For testers" icon={ShieldCheck} tone="text-punch-300" points={[
              "Your deal is yours once you join: later edits come as an offer you switch to or keep",
              `Not reviewed within ${REVIEW_DAYS} days? You choose: charge the developer the listed amount, or let it go`,
              "Paid less than the listing? Dispute it once: our team decides, and a decision can only raise the pay",
              "Keep 80% of every price",
            ]} />
          </div>
        </section>

        {/* Comparison */}
        <section className="space-y-10">
          <Heading kicker="Why it's different" title="Playtest vs. the usual panel" />
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.08] text-slate-400">
                  <th className="px-5 py-4 font-medium" />
                  <th className="px-5 py-4 font-display text-base font-bold text-volt-300">Playtest</th>
                  <th className="px-5 py-4 font-medium">Typical research panels</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {COMPARE.map(([what, us, them]) => (
                  <tr key={what}>
                    <td className="px-5 py-3.5 text-slate-200">{what}</td>
                    <td className="px-5 py-3.5"><span className="inline-flex items-center gap-2 text-white"><Check className="h-4 w-4 text-volt-300" /> {us}</span></td>
                    <td className="px-5 py-3.5 text-slate-400"><span className="inline-flex items-center gap-2"><X className="h-4 w-4 text-slate-600" /> {them}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-center text-xs text-slate-500">“Typical” describes common setups in the market, not any one company.</p>
        </section>

        {/* Final CTA */}
        <section className="relative overflow-hidden rounded-3xl bg-volt-300 px-6 py-12 text-center text-ink-950 shadow-[0_6px_0_0_#62820b] md:px-12">
          <div className="relative space-y-5">
            <h2 className="text-4xl font-extrabold sm:text-5xl">Ready when your build is.</h2>
            <p className="mx-auto max-w-xl text-lg text-ink-800">Post a test in five minutes. Your first feedback can arrive the same day.</p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href={u ? "/app" : "/signup"} className="inline-flex items-center gap-2 rounded-xl bg-ink-950 px-6 py-3 font-semibold text-white no-underline shadow-[0_3px_0_0_#000] transition hover:-translate-y-px hover:no-underline active:translate-y-[2px] active:shadow-none">
                {u ? "Go to your dashboard" : "Post your first test"} <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

function Heading({ kicker, title, sub }: { kicker: string; title: string; sub?: string }) {
  return (
    <div className="mx-auto max-w-2xl space-y-3 text-center">
      <p className="kicker">{kicker}</p>
      <h2 className="text-3xl font-extrabold text-white sm:text-4xl">{title}</h2>
      {sub && <p className="text-slate-400">{sub}</p>}
    </div>
  );
}

function FairCard({ title, icon: Icon, tone, points }: { title: string; icon: typeof Check; tone: string; points: string[] }) {
  return (
    <div className="card space-y-4">
      <h3 className="flex items-center gap-2 text-2xl font-bold text-white"><Icon className={`h-6 w-6 ${tone}`} /> {title}</h3>
      <ul className="space-y-3">
        {points.map((p) => <li key={p} className="flex gap-3 text-slate-300"><Check className={`mt-0.5 h-5 w-5 shrink-0 ${tone}`} /> {p}</li>)}
      </ul>
    </div>
  );
}

const PRODUCTS = [
  { icon: Gamepad2, label: "Games", color: "text-punch-300" },
  { icon: Smartphone, label: "Mobile apps", color: "text-sky-300" },
  { icon: AppWindow, label: "Web apps & SaaS", color: "text-volt-300" },
  { icon: Monitor, label: "Websites", color: "text-cyan-300" },
  { icon: Code2, label: "Developer tools", color: "text-emerald-300" },
  { icon: Bot, label: "AI products", color: "text-violet-300" },
  { icon: Glasses, label: "VR & AR", color: "text-amber-300" },
];

const STEPS = [
  { icon: Wand2, title: "Post your build", text: "Pick the parts and prices, write your questions, set the devices and languages it needs. Five minutes." },
  { icon: Video, title: "Matched testers try it", text: "People who fit your audience (devices, languages) join, then write, send a screen recording, or join a live call." },
  { icon: Check, title: "Review, then decide", text: "One Pay box per piece of work: pay the listed amount, or any amount from $0 up with a reason the tester reads." },
];

const FORMATS = [
  { icon: FileText, title: "Written answers", color: "#7dd3fc", price: "fixed price", points: ["Your own questions, answered with specifics", "Where they got stuck, bugs, what worked", "Some questions can be Not required"] },
  { icon: Video, title: "Screen recording", color: "#ff6c93", price: "fixed price", points: ["Recorded by the tester and uploaded", "Think-aloud audio", "Sent for your review like any other part"] },
  { icon: Radio, title: "Live call", color: "#d8fc52", price: "hourly rate", points: ["Request a time, join a private video room", "Paid by real call length, up to 150% of the booked time", "Repeat daily or weekly if you like"] },
];

const COMPARE: [string, string, string][] = [
  ["How you pay", "Free to post; only the work you accept", "Annual plans or credit packs"],
  ["Smallest test", "One tester", "Often a minimum study size"],
  ["What you can test", "Games, apps, websites, tools", "Often one kind of product"],
  ["Feedback format", "You offer written, recorded and/or live, each Required or Not required", "Mostly recorded sessions"],
  ["Talk to your testers", "Built-in chat, invite them back", "Usually anonymous"],
  ["What counts as “done”", "Terms agreed up front, disputes judged on them", "Decided case by case"],
  ["Tester pay", "Testers keep 80%; live calls paid by real length", "Fixed incentives"],
];
