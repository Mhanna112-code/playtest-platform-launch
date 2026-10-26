import { db } from "@/lib/db";
import { CATEGORIES, DEVICES, LANGUAGES } from "@/lib/options";
import { HttpError } from "./http";
import { requireUser } from "./session";

export const SUSPENDED = "Your account is paused. Contact support if you think this is a mistake.";

/** Signed in and not suspended: every action that changes something goes through this. */
// (Design doc 2, 11.4) A suspended developer: Pay (Payments), "Pay what you owe" and Cancel call are the only presses that go through;
// everything else is refused (blue, final) and names the press that failed so the dashboard top can say so. A suspended tester:
// every press is refused. Testers never read "suspended" about a developer.
export const DEV_SUSPENDED = "Your account is paused: you can still pay for work testers sent and cancel booked calls.";

const VERBS: Record<string, string> = {
  edit: "Save", stop: "Stop", "end-early": "End early", "next-round": "Next round", invite: "Invite", "cancel-invite": "Cancel invite", "request-time": "Call request", "answer-request": "Answer",
  application: "Answer", join: "Join", apply: "Apply", "rejoin-ask": "Ask to rejoin", message: "Message", written: "Send", "recording-start": "Send", "recording-send": "Send", "recording-done": "Send",
  leave: "Leave", rate: "Rating", terms: "Switch or Keep", choose: "Charge", dispute: "Dispute", "dispute-side": "Dispute reply", "call-length": "Call length", "no-show": "Report", "cancel-call": "Cancel call",
  "cancel-set": "Cancel calls", "assign-key": "Assign a key", "key-broken": "Report", open: "Open", review: "Pay",
};

/** "Your Pay on Harbor Run didn't go through": what the red box on the dashboard names. */
export async function failedLine(req: Request, what?: string, piece?: { kind: string; id: string }) {
  const path = new URL(req.url).pathname.split("/").filter(Boolean); // api, tests, <id>, <action>
  let verb = what ?? "", title = "";
  try {
    if (path[1] === "tests" && path[2]) {
      verb = verb || VERBS[path[3]] || "Save";
      title = (await db.test.findUnique({ where: { id: path[2] }, select: { title: true } }))?.title ?? "";
    } else if (path[1] === "tests") verb = verb || "Post";
    else if (path[1] === "sessions" && path[2]) {
      verb = verb || VERBS[path[3]] || "Save";
      title = (await db.contract.findUnique({ where: { id: path[2] }, select: { title: true } }))?.title ?? "";
    } else if (path[1] === "review") {
      verb = verb || "Pay";
      if (piece) {
        const contractId = piece.kind === "call" ? (await db.call.findUnique({ where: { id: piece.id }, select: { contractId: true } }))?.contractId : (await db.submission.findUnique({ where: { id: piece.id }, select: { contractId: true } }))?.contractId;
        title = contractId ? (await db.contract.findUnique({ where: { id: contractId }, select: { title: true } }))?.title ?? "" : "";
      }
    }
    else verb = verb || "Save";
  } catch {
    // the name is a nicety
  }
  return `Your ${verb}${title ? ` on ${title}` : ""} didn't go through`;
}

export async function requireActive(req: Request, opts: { allowPay?: boolean; devOk?: boolean; what?: string; piece?: { kind: string; id: string } } = {}) {
  const u = await requireUser(req);
  const exempt = (opts.allowPay || opts.devOk) && u.isDeveloper;
  if (u.suspendedAt && !exempt) {
    throw new HttpError(403, "suspended", u.isDeveloper ? DEV_SUSPENDED : SUSPENDED, { failed: await failedLine(req, opts.what, opts.piece), suspended: true });
  }
  return u;
}

/** Testing switch: SKIP_EMAIL_CONFIRM=1 turns the requirement off, never in production. */
export const confirmSkipped = () => process.env.SKIP_EMAIL_CONFIRM === "1" && process.env.NODE_ENV !== "production";

/** (NEWEST+8) The refusal for an unconfirmed email (blue, under the button, with a Resend link). */
export const CONFIRM_FIRST = "Confirm your email first.";
/**
 * (NEWEST+8) Email confirmation is required before posting a test, Edit Save, joining / applying / accepting an invite,
 * sending work, requesting / accepting calls, paying, charging, inviting and rating. Browsing, profile, chat and
 * sign-out still work.
 */
export function requireConfirmed(u: { emailVerifiedAt: Date | null }) {
  if (confirmSkipped()) return;
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
