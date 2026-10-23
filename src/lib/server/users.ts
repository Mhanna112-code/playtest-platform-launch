import { db } from "@/lib/db";
import { CATEGORIES, DEVICES, LANGUAGES } from "@/lib/options";
import { HttpError } from "./http";
import { requireUser } from "./session";

export const SUSPENDED = "Your account is paused. Contact support if you think this is a mistake.";

/** Signed in and not suspended: every action that changes something goes through this. */
export async function requireActive(req: Request) {
  const u = await requireUser(req);
  if (u.suspendedAt) throw new HttpError(403, "suspended", SUSPENDED);
  return u;
}

/** (NEWEST+8) The refusal for an unconfirmed email (blue, under the button, with a Resend link). */
export const CONFIRM_FIRST = "Confirm your email first.";
/**
 * (NEWEST+8) Email confirmation is required before posting a test, Edit Save, joining / applying / accepting an invite,
 * sending work, requesting / accepting calls, paying, charging, inviting and rating. Browsing, profile, chat and
 * sign-out still work.
 */
export function requireConfirmed(u: { emailVerifiedAt: Date | null }) {
  if (!u.emailVerifiedAt) throw new HttpError(409, "confirm_email", CONFIRM_FIRST);
}

const pick = (v: unknown, allowed: string[]) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && allowed.includes(x)))] : []);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Save name, pronoun, roles and (for testers) the tester profile. */
export async function saveProfile(userId: string, body: Record<string, unknown>) {
  const name = str(body.name, 80);
  if (name.length < 2) throw new HttpError(400, "bad_name", "Enter your name (others see it).");
  const pronoun = ["she", "he", "they"].includes(body.pronoun as string) ? (body.pronoun as string) : "";
  const isDeveloper = body.isDeveloper === true;
  const isTester = body.isTester === true;
  if (!isDeveloper && !isTester) throw new HttpError(400, "bad_role", "Choose developer, tester, or both.");
  const devices = pick(body.devices, DEVICES), categories = pick(body.categories, CATEGORIES), languages = pick(body.languages, LANGUAGES);
  if (isTester && devices.length === 0) throw new HttpError(400, "bad_devices", "Pick at least one device you play on.");
  if (isTester && languages.length === 0) throw new HttpError(400, "bad_languages", "Pick at least one language you can test in.");
  const bio = str(body.bio, 1000);
  const emailPref = ["each", "daily", "weekly", "monthly", "off"].includes(body.emailPref as string) ? (body.emailPref as string) : undefined;
  return db.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: userId }, data: { name, pronoun, isDeveloper, isTester, ...(emailPref ? { emailPref } : {}) } });
    if (isTester) await tx.testerProfile.upsert({ where: { userId }, update: { devices, categories, languages, bio }, create: { userId, devices, categories, languages, bio } });
    return user;
  });
}
