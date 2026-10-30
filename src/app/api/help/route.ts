import { handle, ok, HttpError, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { sendEmail } from "@/lib/server/email";
import { TOPICS } from "@/lib/helpTopics";
import { db } from "@/lib/db";
import { CONTACT_LIMIT_PER_DAY, LIMITS, contactLimitLine } from "@/lib/limits";
import { readText } from "@/lib/server/http";
import { appUrl } from "@/lib/server/auth";

// "Contact us": the message goes to the team (every ADMIN_EMAILS address, or the outbox when none is set) with the sender's name and email.
// (Owner, Oct 27) It is the appeal path, so a suspended or held account of either role can always send: requireUser, never requireActive.
// At most 5 messages per account per day; the 6th press is a blue notice under Send.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const body = await readJson(req, 250_000);
    const topic = typeof body.topic === "string" && TOPICS.includes(body.topic) ? body.topic : "";
    // (Owner, Oct 30, batch 15 section 21) Up to 50,000 characters, refused (never cut) beyond.
    const message = readText(body.message, LIMITS.contact.max, "bad_message");
    if (!topic) throw new HttpError(400, "bad_topic", "Choose what it's about.");
    if (message.length < 10) throw new HttpError(400, "bad_message", "Write a few words about what happened (at least 10 characters).");
    const today = await db.contactMessage.count({ where: { userId: u.id, createdAt: { gt: new Date(Date.now() - 86_400_000) } } });
    if (today >= CONTACT_LIMIT_PER_DAY) throw new HttpError(409, "limit", contactLimitLine());
    await db.contactMessage.create({ data: { userId: u.id, topic, message } });
    const team = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const text = `From ${u.name || "(no name)"} <${u.email}>\nAbout: ${topic}\n\n${message}`;
    for (const to of team.length ? team : ["team@playtest.local"]) await sendEmail({ to, subject: `Contact us: ${topic}`, text, button: { label: "Open the admin console", url: `${appUrl()}/admin#contact` } });
    return ok({ sent: true });
  });
}
