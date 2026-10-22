import { appUrl } from "./auth";
import { sendEmail } from "./email";

// Emails for key events: joined, sent, reviewed, paid, call booked/cancelled, test stopped, ended early, dispute decided.
// A failed email never undoes the action: it is logged and the action stands.

export async function notify(to: string, subject: string, lines: string[], path: string) {
  const link = `${appUrl()}${path}`;
  try {
    await sendEmail({ to, subject, text: [...lines, "", link, "", "Playtest"].join("\n") });
  } catch (e) {
    console.error("[email] failed:", subject, (e as Error).message);
  }
}
