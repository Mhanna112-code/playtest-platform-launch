import { db } from "@/lib/db";
import { isEmail, normEmail } from "@/lib/format";
import { HttpError } from "./http";

/** Join the waitlist. The same email again updates its one row. */
export async function joinWaitlist(rawEmail: unknown, rawRole: unknown) {
  const email = typeof rawEmail === "string" ? normEmail(rawEmail) : "";
  if (!isEmail(email)) throw new HttpError(400, "bad_email", "Enter an email address like you@email.com.");
  const role = ["developer", "tester", "both"].includes(rawRole as string) ? (rawRole as string) : "both";
  return db.waitlistEntry.upsert({ where: { email }, update: { role }, create: { email, role } });
}
