import { PublicShell } from "@/components/PublicShell";
import { MAX_ACTIVE_TESTS, MAX_SPOTS, PAYMENTS_TERMS_ID } from "@/lib/rules";
import { PAYMENT_RULES, TERMS_VERSION, WHAT_CHANGED, WHAT_CHANGED_ID } from "@/lib/termsOfUse";

export const metadata = { title: "Terms of Use · Playtest" };

// Copied from the full app's Terms of Use and adapted to the lean rules. DRAFT: the owner reviews the wording (and a lawyer
// should) before launch. It is a plain-language description of the rules the site enforces, not legal advice.
/** A point is its text, or its text with an anchor to link to (`id`). (Batch 19 section 6) `payments` marks the section drawn from PAYMENT_RULES. */
const SECTIONS: { title: string; points: (string | { id: string; text: string })[]; payments?: boolean }[] = [
  {
    title: "1. What this platform is",
    points: [
      "Playtest connects people who make apps, websites and games (\"developers\") with people who try them and give feedback (\"testers\").",
      // (Batch 20 section 5) The age rule in the sign-up's own words.
      "You must be 18 or older to use Playtest. Everyone must give accurate account details. One account per person; an account can be a developer, a tester, or both.",
    ],
  },
  {
    title: "2. Posting a test (developers)",
    points: [
      "A test states its terms up front: the parts you ask for (written answers, a screen recording, a live call), the price of each, your questions, the devices and languages it needs, Open until (the last day to join; every tester gets the same number of days from when they join), how many testers (spots), and who can join (anyone who matches, people you approve, or invite only).",
      "A live call's hourly rate is at least $10 an hour (or free); each call request picks its own length (10 to 180 minutes). Each part can be marked Required or Not required: it is a label, it blocks nothing.",
      `Posting a test is free; what developers pay is in section 4. Every test takes at most ${MAX_SPOTS} testers. A tester can be in up to ${MAX_ACTIVE_TESTS} tests at once.`,
      "Once a tester joins, the terms they agreed to are saved and are what their work is judged against, even if the test is edited later. If you change prices, parts, questions, devices or languages, or the description, each working tester is offered the new terms and chooses Switch or Keep; work already sent keeps the price it was sent under. Moving Open until later moves every working tester's deadline with it.",
      "Tests can be stopped for good by the developer; the work already sent still waits to be paid, and calls ahead are cancelled.",
    ],
  },
  {
    title: "3. Joining and sending work (testers)",
    points: [
      "Joining means you agree to the test's terms as listed. If your profile doesn't list a device or language the test needs, you're warned first and can join anyway.",
      "Send the parts you choose. Honest, critical feedback counts, and so does saying where and why you stopped early.",
      "Don't share builds, keys or confidential details.",
      "You can leave a test at any time: what you sent is still reviewed and paid. You can ask to rejoin, or be invited back; a tester a developer ended early needs a new invitation.",
      "Requests, applications and offers can be withdrawn until the other side answers.",
    ],
  },
  {
    // (Owner, Oct 28, batch 19 sections 3 and 6) Every money rule in one place: PAYMENT_RULES (lib/termsOfUse.ts). Payment is for the work, not for praise.
    title: "4. How payments work",
    points: ["Payment is for the work the tester sent, judged against the listing, not for whether the feedback is positive."],
    payments: true,
  },
  {
    title: "5. Conduct",
    points: [
      "Be respectful. No harassment, spam, fake or copied work, or leaking builds.",
      // (Owner, Oct 28 evening, batch 18 section 2) The same rule as Post / Edit's Mature line.
      "Never allowed: sexual content involving minors, illegal content, real-world gore. Other graphic or mature content must be marked Mature (18+), with a reason.",
      "Keep payments on the platform: deals arranged outside it aren't covered by reviews, disputes or payouts.",
      "Either side of a test can block the other, or report a problem with a call (no-show or late) to the team. We may remove content and suspend accounts that break these rules.",
    ],
  },
  {
    title: "6. Feedback, ratings and confidentiality",
    points: [
      "Ratings (1 to 5 stars, and an optional note) go both ways. The tester rates first; the developer rates once the tester has rated and everything they sent is settled. The tester's rating shows once the developer rates or their 14 days to rate end.",
      "Developers may use the feedback they receive to improve their products. Testers keep no rights over how it's used, but their name isn't published without consent.",
      "Any confidentiality agreement a developer sets applies between the developer and the tester.",
    ],
  },
  {
    title: "7. Calls and recordings",
    points: [
      "Calls run in the app's own call room, on the call page: video and sound go directly between the two browsers, and the app only passes along the messages that connect them. Only the developer and tester of that call can be in it, from 10 minutes before the start until the call ends. When the two browsers were connected is recorded (it measures the length); the team can read it when handling a report. Nothing in the call is recorded.",
      "Screen recordings are only seen by the developer and tester of that session, and by the team when handling a dispute or report.",
    ],
  },
  {
    title: "8. The service and changes to these terms",
    points: [
      "The platform is provided as is. We aren't responsible for the products being tested, for builds, or for agreements between users beyond what these terms describe.",
      "If we have an outage, every deadline and payment date that was running moves later by the length of it.",
      // (Owner, Oct 31, batch 35 §90)
      "Pages update on their own about every 20 seconds. When a blue \"new update\" pill appears, check the update (tap the pill) before you press anything: once the page has shown an update, a press counts as made with it in view.",
      "When these terms change, we'll tell you on the site before the change applies. You're asked to agree to the new version the next time you post a test, or join, apply, accept an invite or ask to rejoin. Tests you're already in carry on under the terms you agreed to.",
    ],
  },
];

export default function TermsPage() {
  return (
    <PublicShell>
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-3xl font-bold tracking-tight text-white">Terms of Use</h1>
        <p className="text-slate-400">The rules both sides agree to. They&apos;re written plainly, and the site enforces them.</p>
        <p className="font-mono text-xs text-slate-500">Version {TERMS_VERSION} · DRAFT, wording to be reviewed before launch</p>
        {/* (Batch 18 section 1) "Read what changed" in the box under Post / Join / Apply / Ask to rejoin opens here. */}
        <section id={WHAT_CHANGED_ID} className="info scroll-mt-24 space-y-1 text-sm" data-what-changed="">
          <h2 className="font-semibold text-white">What changed</h2>
          {WHAT_CHANGED.map((w) => (
            <div key={w.version}>
              <p>Version {w.version}, {w.date}:</p>
              <ul className="list-disc space-y-0.5 pl-5">{w.points.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          ))}
        </section>
        {SECTIONS.map((s) => (
          <section key={s.title} className={`card space-y-2${s.payments ? " scroll-mt-24" : ""}`} {...(s.payments ? { id: PAYMENTS_TERMS_ID } : {})}>
            <h2 className="font-semibold text-white">{s.title}</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">{s.points.map((p) => (typeof p === "string" ? <li key={p}>{p}</li> : <li key={p.id} id={p.id} className="scroll-mt-24">{p.text}</li>))}</ul>
            {s.payments && (
              <div className="space-y-3 text-sm" data-payment-rules="">
                {PAYMENT_RULES.map((r) => (
                  <div key={r.heading} className="space-y-1">
                    <h3 className="font-semibold text-slate-100">{r.heading}</h3>
                    <p className="text-slate-300">{r.text}</p>
                    <p className="text-xs text-slate-400">Example: {r.example}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </PublicShell>
  );
}
