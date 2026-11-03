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
const SAME_MESSAGE_MS = 10 * 60_000;
const CONTACT_ALREADY_SENT = "You already sent this message.";

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const body = await readJson(req, 250_000);
    const topic = typeof body.topic === "string" && TOPICS.includes(body.topic) ? body.topic : "";
    // (Owner, Oct 30, batch 15 section 21) Up to 50,000 characters, refused (never cut) beyond.
    const message = readText(body.message, LIMITS.contact.max, "bad_message");
    if (!topic) throw new HttpError(400, "bad_topic", "Choose what it's about.");
    if (message.length < 10) throw new HttpError(400, "bad_message", "Write a few words about what happened (at least 10 characters).");
    // (Owner, Nov 3, §157) Under the account's row lock: the same message sent from two tabs (or twice) within 10 minutes goes to the team once; the other press
    // reads "You already sent this message." (The day's limit is counted under the same lock.)
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${u.id} FOR UPDATE`;
      if (await tx.contactMessage.count({ where: { userId: u.id, topic, message, createdAt: { gt: new Date(Date.now() - SAME_MESSAGE_MS) } } })) throw new HttpError(409, "already", CONTACT_ALREADY_SENT);
      const today = await tx.contactMessage.count({ where: { userId: u.id, createdAt: { gt: new Date(Date.now() - 86_400_000) } } });
      if (today >= CONTACT_LIMIT_PER_DAY) throw new HttpError(409, "limit", contactLimitLine());
      await tx.contactMessage.create({ data: { userId: u.id, topic, message } });
    });
    const team = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const text = `From ${u.name || "(no name)"} <${u.email}>\nAbout: ${topic}\n\n${message}`;
    for (const to of team.length ? team : ["team@playtest.local"]) await sendEmail({ to, subject: `Contact us: ${topic}`, text, button: { label: "Open the admin console", url: `${appUrl()}/admin#contact` } });
    return ok({ sent: true });
  });
}
