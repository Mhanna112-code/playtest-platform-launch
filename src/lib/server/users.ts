import { db } from "@/lib/db";
import { CATEGORIES, DEVICES, LANGUAGES } from "@/lib/options";
import { HttpError } from "./http";
import { requireUser } from "./session";

export const SUSPENDED = "Your account is paused. Contact support if you think this is a mistake.";

/** Signed in and not suspended: every action that changes something goes through this. */
// (Design doc 2, 11.4; owner, Oct 27) A developer under an admin suspension, a payment hold or a chargeback hold: ONE state. Every press on
// their pages is refused (blue, final) and names the press that failed so the dashboard top can say so; only Cancel call (from the dashboard's
// Calls box) and "Pay what you owe" / the card on Payments, and Contact us, work. A suspended tester: every press is refused. Testers never read
// "suspended", "hold" or "chargeback" about a developer.
export const DEV_SUSPENDED = "Your account is suspended: your tests are paused. Contact us in Settings to appeal.";
export const DEV_HELD = "Your tests are paused until you pay what you owe. Open Payments to pay.";
export const DEV_CHARGEBACK = "Your tests are paused after a chargeback. Open Payments to see the steps.";

const VERBS: Record<string, string> = {
  edit: "Save", stop: "Stop", "end-early": "End early", "next-round": "Next round", invite: "Invite", "cancel-invite": "Cancel invite", "request-time": "Call request", "answer-request": "Answer",
  application: "Answer", join: "Join", apply: "Apply", "rejoin-ask": "Ask to rejoin", message: "Message", written: "Send", "recording-start": "Send", "recording-send": "Send", "recording-done": "Send",
  leave: "Leave", rate: "Rating", terms: "Switch or Keep", choose: "Charge", dispute: "Dispute", "dispute-side": "Dispute reply", "call-length": "Call length", "no-show": "Report", "cancel-call": "Cancel call",
  "cancel-set": "Cancel calls", "pay-extra": "Pay", "key-broken": "Report", open: "Open", review: "Pay",
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

/**
 * `devSide`: the press belongs to the developer side (a test page, Post, Pay, Reject ...), so a payment or chargeback hold refuses it too.
 * `devOk`: a developer's press that still works while restricted (Cancel call).
 */
export async function requireActive(req: Request, opts: { devOk?: boolean; devSide?: boolean | "auto"; what?: string; piece?: { kind: string; id: string } } = {}) {
  const u = await requireUser(req);
  const exempt = opts.devOk && u.isDeveloper;
  if (exempt) return u;
  // The side the press belongs to decides the words (a mixed account reads the side it was pressed on).
  const asDev = opts.devSide === true || (u.isDeveloper && (!u.isTester || u.side === "developer"));
  if (u.suspendedAt) {
    throw new HttpError(403, "suspended", asDev && u.isDeveloper ? DEV_SUSPENDED : SUSPENDED, { failed: await failedLine(req, opts.what, opts.piece), suspended: true });
  }
  if (u.holdStartedAt && u.isDeveloper && (opts.devSide === true || (opts.devSide === "auto" && asDev))) {
    throw new HttpError(403, "held", u.holdReason === "chargeback" ? DEV_CHARGEBACK : DEV_HELD, { failed: await failedLine(req, opts.what, opts.piece), held: true });
  }
  return u;
}

/** Testing switch: SKIP_EMAIL_CONFIRM=1 turns the requirement off, never in production. */
export const confirmSkipped = () => process.env.SKIP_EMAIL_CONFIRM === "1" && process.env.NODE_ENV !== "production";

/** (NEWEST+8) The refusal for an unconfirmed email (blue, under the button, with a Resend link). */
export const CONFIRM_FIRST = "Confirm your email first.";
export const confirmFirstLine = (email: string) => `${CONFIRM_FIRST} We sent a link to ${email}.`;
/**
 * (Owner, Oct 27) Email confirmation is required only before posting a test, joining, applying and accepting an invite; everything else works unconfirmed.
 */
export function requireConfirmed(u: { emailVerifiedAt: Date | null; email?: string }) {
  if (confirmSkipped()) return;
  if (!u.emailVerifiedAt) throw new HttpError(409, "confirm_email", u.email ? confirmFirstLine(u.email) : CONFIRM_FIRST);
}

const pick = (v: unknown, allowed: string[]) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && allowed.includes(x)))] : []);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Save name, pronoun, roles and (for testers) the tester profile. */
export async function saveProfile(userId: string, body: Record<string, unknown>) {
  const name = str(body.name, 80);
  // (Owner, Oct 27) A name is at least 1 character, with no other rules.
  if (name.length < 1) throw new HttpError(400, "bad_name", "Enter your name (others see it).");
  const pronoun = ["she", "he", "they"].includes(body.pronoun as string) ? (body.pronoun as string) : "";
  const isDeveloper = body.isDeveloper === true;
  const isTester = body.isTester === true;
  if (!isDeveloper && !isTester) throw new HttpError(400, "bad_role", "Choose developer, tester, or both.");
  const devices = pick(body.devices, DEVICES), categories = pick(body.categories, CATEGORIES), languages = pick(body.languages, LANGUAGES);
  if (isTester && devices.length === 0) throw new HttpError(400, "bad_devices", "Pick at least one device you play on.");
  if (isTester && languages.length === 0) throw new HttpError(400, "bad_languages", "Pick at least one language you can test in.");
  const bio = str(body.bio, 1000);
  const emailPref = ["daily", "weekly", "monthly", "off"].includes(body.emailPref as string) ? (body.emailPref as string) : undefined;
  return db.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: userId }, data: { name, pronoun, isDeveloper, isTester, ...(emailPref ? { emailPref } : {}) } });
    if (isTester) await tx.testerProfile.upsert({ where: { userId }, update: { devices, categories, languages, bio }, create: { userId, devices, categories, languages, bio } });
    return user;
  });
}
