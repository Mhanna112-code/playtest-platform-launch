import { PublicShell } from "@/components/PublicShell";
import { MAX_ACTIVE_TESTS, REVIEW_DAYS } from "@/lib/rules";

export const metadata = { title: "Terms of Use · Playtest" };

// Copied from the full app's Terms of Use and adapted to the lean rules. DRAFT: the owner reviews the wording (and a lawyer
// should) before launch. It is a plain-language description of the rules the site enforces, not legal advice.
/** A point is its text, or its text with an anchor to link to (`id`). */
const SECTIONS: { title: string; points: (string | { id: string; text: string })[] }[] = [
  {
    title: "1. What this platform is",
    points: [
      "Playtest connects people who make apps, websites and games (\"developers\") with people who try them and give feedback (\"testers\").",
      "Everyone must be at least 18 and give accurate account details. One account per person; an account can be a developer, a tester, or both.",
    ],
  },
  {
    title: "2. Posting a test (developers)",
    points: [
      "A test states its terms up front: the parts you ask for (written answers, a screen recording, a live call), the price of each, your questions, the devices and languages it needs, Open until (every tester's deadline), how many testers (spots), and who can join (anyone who matches, people you approve, or invite only).",
      "A live call's hourly rate is at least $10 an hour (or free); each call request picks its own length (10 to 180 minutes). Each part can be marked Required or Not required: it is a label, it blocks nothing.",
      `Developers post tests for free and pay only for the work they accept. A developer can take up to a number of testers per test that starts at 10 and grows with good ratings and reviews (never more than 50). A tester can be in up to ${MAX_ACTIVE_TESTS} tests at once.`,
      "Developers pay by card when they press Pay on a piece of work. A card is needed before paying. A failed payment is owed and retried daily; an unpaid amount past its date pauses your tests until it is paid.",
      "Once a tester joins, the terms they agreed to are saved and are what their work is judged against, even if the test is edited later. If you change prices, parts, questions, devices or languages, or the description, each working tester is offered the new terms and chooses Switch or Keep; work already sent keeps the price it was sent under. Moving Open until later moves every working tester's deadline with it.",
      "Tests can be stopped for good by the developer; the work already sent still waits to be paid or rejected, and calls ahead are cancelled.",
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
    title: "4. Reviews and payment",
    points: [
      "Payment is for the work you sent, judged against the listing, not for whether the feedback is positive.",
      "A developer pays the listed amount (or another amount), or rejects with a reason. Paying less than the listing needs a reason.",
      `Work not paid or rejected within ${REVIEW_DAYS} days is the tester's to decide: they can charge the developer the listed amount, or let it go.`,
      "Live calls are paid for their real length at the contract's hourly rate. After the call the developer enters how long it was (up to 150% of the booked length); a shorter length needs a reason, which the tester reads. If it isn't entered within 24 hours of the call's start, the booked length is used.",
      "Testers receive 80% of each price and of live call time; the platform keeps 20%.",
      "Ratings (1 to 5, and a note) are given both ways and shown once both sides have rated or after 14 days.",
    ],
  },
  {
    title: "5. Disputes",
    points: [
      "A tester can dispute the developer's decision on any part they sent, once: a rejection or a payment of any amount, including $0 and parts that weren't listed. Our team decides and can read the work, the reason and the chat. A decision can only raise the pay: up to the listing amount, or for a part that wasn't listed up to $1,000 a piece ($200 an hour for a call), minus what was already paid.",
      "A bank reversing a card payment (a chargeback) pauses the developer's tests until it is resolved and what is owed is paid.",
    ],
  },
  {
    title: "6. Conduct",
    points: [
      "Be respectful. No harassment, spam, fake or copied work, or leaking builds.",
      "No graphic content: no sexual content involving minors, no illegal content and no real-world gore. Other graphic content must be marked Mature (18+) on the test, with a note saying why.",
      "Keep payments on the platform: deals arranged outside it aren't covered by reviews, disputes or payouts.",
      "Either side of a test can block the other, or report a problem with a call (no-show or late) to the team. We may remove content and suspend accounts that break these rules.",
    ],
  },
  {
    title: "7. Feedback and confidentiality",
    points: [
      "Developers may use the feedback they receive to improve their products. Testers keep no rights over how it's used, but their name isn't published without consent.",
      "Any confidentiality agreement a developer sets applies between the developer and the tester.",
    ],
  },
  {
    title: "8. Calls and recordings",
    points: [
      "Calls run in a room on the site. Only the developer and tester of that call can join. Who joined and when is recorded; the team can read it when handling a report.",
      "Screen recordings are only seen by the developer and tester of that session, and by the team when handling a dispute or report.",
    ],
  },
  {
    title: "9. The service and changes to these terms",
    points: [
      "The platform is provided as is. We aren't responsible for the products being tested, for builds, or for agreements between users beyond what these terms describe.",
      "If we have an outage, every deadline and payment date that was running moves later by the length of it.",
      "When these terms change, we'll tell you on the site before the change applies. Tests you're already in carry on under the terms you agreed to.",
    ],
  },
];

export default function TermsPage() {
  return (
    <PublicShell>
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-3xl font-bold tracking-tight text-white">Terms of Use</h1>
        <p className="text-slate-400">The rules both sides agree to. They&apos;re written plainly, and the site enforces them.</p>
        <p className="font-mono text-xs text-slate-500">Version 1 · draft, wording to be reviewed before launch</p>
        {SECTIONS.map((s) => (
          <section key={s.title} className="card space-y-2">
            <h2 className="font-semibold text-white">{s.title}</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">{s.points.map((p) => (typeof p === "string" ? <li key={p}>{p}</li> : <li key={p.id} id={p.id} className="scroll-mt-24">{p.text}</li>))}</ul>
          </section>
        ))}
      </div>
    </PublicShell>
  );
}
