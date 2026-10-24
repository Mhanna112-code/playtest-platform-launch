import { handle, ok, HttpError, readJson } from "@/lib/server/http";
import { requireActive } from "@/lib/server/users";
import { sendEmail } from "@/lib/server/email";
import { TOPICS } from "@/lib/helpTopics";

// "Contact us": the message goes to the team (every ADMIN_EMAILS address, or the outbox when none is set) with the sender's name and email.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireActive(req);
    const body = await readJson(req);
    const topic = typeof body.topic === "string" && TOPICS.includes(body.topic) ? body.topic : "";
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 3000) : "";
    if (!topic) throw new HttpError(400, "bad_topic", "Choose what it's about.");
    if (message.length < 10) throw new HttpError(400, "bad_message", "Write a few words about what happened (at least 10 characters).");
    const team = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const text = `From ${u.name || "(no name)"} <${u.email}>\nAbout: ${topic}\n\n${message}`;
    for (const to of team.length ? team : ["team@playtest.local"]) await sendEmail({ to, subject: `Contact us: ${topic}`, text });
    return ok({ sent: true });
  });
}
