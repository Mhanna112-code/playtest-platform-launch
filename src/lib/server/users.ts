import { db } from "@/lib/db";
import { LIMITS, NAME_TOO_LONG } from "@/lib/limits";
import * as RF from "@/lib/refusal";
import { CATEGORIES, DEVICES, DEVICES_MISSING, LANGUAGES, LANGUAGES_MISSING, pickFrom as pick } from "@/lib/options";
import { sideFor, type Side } from "@/lib/sides";
import { HttpError } from "./http";
import { isAdmin, requireUser } from "./session";
import { accountGate, listLabel, logAccountChange, sidesLabel } from "./accountChanges";
import { pressLabelOf } from "@/lib/pressLabels";
import { testTitleOf } from "@/lib/rules";
import { TERMS_CHANGED_HREF, TERMS_TICK_MISSING, TERMS_UPDATED_CODE, TERMS_VERSION, needsTermsAgain } from "@/lib/termsOfUse";

export const SUSPENDED = "Your account is paused. Contact support if you think this is a mistake.";

/** Signed in and not suspended: every action that changes something goes through this. */
// (Design doc 2, 11.4; owner, Oct 27) A developer under an admin suspension, a payment hold or a chargeback hold: ONE state. Every press on
// their pages is refused (blue, final) and names the press that failed so the dashboard top can say so; only Cancel call (from the dashboard's
// Calls box) and "Pay what you owe" / the card on Payments, and Contact us, work. A suspended tester: every press is refused. Testers never read
// "suspended", "hold" or "chargeback" about a developer.
export const DEV_SUSPENDED = "Your account is suspended: your tests are paused. Contact us in Settings to appeal.";
export const DEV_HELD = "Your tests are paused until you pay what you owe. Open Payments to pay.";
export const DEV_CHARGEBACK = "Your tests are paused after a chargeback. Open Payments to see the steps.";

/**
 * "Your Pay on Harbor Run didn't go through": what the red box on the dashboard names.
 * (Owner, Nov 3, §156) The press is named with its button's own label, from the same table as the page's refusals (pressLabelOf, with the body where one route
 * serves several buttons: Block / Unblock, Allow / Deny, Accept / Decline …). It used to fall back to "Save" for every press it had no word for (Block, Send to
 * the team, Save profile, No thanks, Dismiss selected, Remove …) and to say "Stop", "Message", "Rating", "Call request", "Dispute reply" and "Open" for buttons
 * that read otherwise.
 */
/** (§363) The press's button label, as failedLine names it ("" when it can't tell). */
export async function pressVerbOf(req: Request, what?: string) {
  if (what) return what;
  try {
    const body = Number(req.headers.get("content-length") || 0) > 100_000 ? null : await req.clone().json().catch(() => null);
    return pressLabelOf(new URL(req.url).pathname, body);
  } catch {
    return "";
  }
}

export async function failedLine(req: Request, what?: string, piece?: { kind: string; id: string }) {
  const url = new URL(req.url);
  const path = url.pathname.split("/").filter(Boolean); // api, tests, <id>, <action>
  let verb = what ?? "", title = "";
  try {
    // A copy of the body is peeked (small bodies only) for the presses it names; a route that read its body first passes `what` instead (Block / Unblock).
    const peek = async () => { try { return await req.clone().json(); } catch { return null; } };
    const body = verb || Number(req.headers.get("content-length") || 0) > 100_000 ? null : await peek();
    verb = verb || pressLabelOf(url.pathname, body);
    // (Owner, Nov 3, races) Dismiss all is sent from one card but covers every removed-from card: it names no one test.
    if (verb === "Dismiss all") return "Your Dismiss all didn't go through";
    if (path[1] === "tests" && path[2]) {
      // (Owner, Nov 3, batch 35 §168) A Next round's draft with no name yet: "Your Post the test on Untitled draft (round 2) didn't go through".
      const t = await db.test.findUnique({ where: { id: path[2] }, select: { title: true, round: true } });
      title = t ? testTitleOf(t) : "";
    } else if (path[1] === "sessions" && path[2]) {
      title = (await db.contract.findUnique({ where: { id: path[2] }, select: { test: { select: { title: true } } } }))?.test.title ?? ""; // (§342) the current title
    } else if (path[1] === "review" && piece) {
      const contractId = piece.kind === "call" ? (await db.call.findUnique({ where: { id: piece.id }, select: { contractId: true } }))?.contractId : (await db.submission.findUnique({ where: { id: piece.id }, select: { contractId: true } }))?.contractId;
      title = contractId ? (await db.contract.findUnique({ where: { id: contractId }, select: { test: { select: { title: true } } } }))?.test.title ?? "" : "";
    }
  } catch {
    // the name is a nicety
  }
  return `Your ${verb || "press"}${title ? ` on ${title}` : ""} didn't go through`;
}

/** (Batch 15 section 16) The side a press belongs to: `devSide: true` the developer side, `"auto"` the side in use, otherwise the tester side. An account without that side uses its other one. */
export function pressSideOf(u: { isDeveloper: boolean; isTester: boolean; side?: string }, devSide?: boolean | "auto"): "developer" | "tester" {
  const want = devSide === true ? "developer" : devSide === "auto" ? (u.isDeveloper && (!u.isTester || u.side !== "tester") ? "developer" : "tester") : "tester";
  if (want === "tester" && !u.isTester && u.isDeveloper) return "developer";
  if (want === "developer" && !u.isDeveloper && u.isTester) return "tester";
  return want;
}

/**
 * `devSide`: the press belongs to the developer side (a test page, Post, Pay, Reject ...), so a payment or chargeback hold refuses it too; `"auto"`: the side in use.
 * `devOk`: a developer's press that still works while restricted (Cancel call; batch 15: Stop and End early from the restricted test page).
 * (Owner, Oct 30, batch 15 section 16) A suspension refuses only the presses of its own side: a mixed account with the developer side suspended still tests normally.
 */
export async function requireActive(req: Request, opts: { devOk?: boolean; devSide?: boolean | "auto"; what?: string; piece?: { kind: string; id: string } } = {}) {
  const u = await requireUser(req);
  const exempt = opts.devOk && u.isDeveloper;
  if (exempt) return u;
  const side = pressSideOf(u, opts.devSide);
  const asDev = side === "developer";
  // (Owner, Nov 11, §386 A; replaces §368) A payment press (Pay, Pay more, a call's Pay) is refused during a developer suspension like every other press.
  if (asDev ? u.devSuspendedAt : u.testerSuspendedAt) {
    // (Owner, Nov 9, §364 item 8) "Your account is suspended, so your Pay didn't go through." / a tester: "Your account is paused, so your Send didn't go through."
    throw new HttpError(403, "suspended", RF.pressRefused(asDev ? RF.ACCOUNT_SUSPENDED_CAUSE : RF.ACCOUNT_PAUSED_CAUSE, await pressVerbOf(req, opts.what)), { failed: await failedLine(req, opts.what, opts.piece), suspended: true });
  }
  if (u.holdStartedAt && u.isDeveloper && asDev && (opts.devSide === true || opts.devSide === "auto")) {
    throw new HttpError(403, "held", RF.pressRefused(RF.HELD_CAUSE, await pressVerbOf(req, opts.what)), { failed: await failedLine(req, opts.what, opts.piece), held: true }); // (§364 item 7)
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

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** (Batch 35 §134) The side a side-only profile field belongs to: its change stops only that side's profile Save. Name, pronoun and sides are the account's. */
const PROFILE_FIELD_SIDE: Record<string, Side> = { devices: "tester", languages: "tester", bio: "tester", devBio: "developer" };

/**
 * Save name, pronoun, roles and the profile of one side. (Owner, Nov 3, batch 35 §134) The name and pronoun are the account's: saved on either side's profile,
 * both sides show them. Everything else belongs to one side, and a Save changes only the side its form is for (`side`, which the form sends; without it, the side
 * in use): the developer's bio (User.devBio), or the tester's devices, languages, interests and bio (TesterProfile). Each bio is optional, up to 2,000
 * characters; the other side's is never read or changed. The first setup (an account with no side yet) picks the sides, with the tester's fields when tester is
 * picked.
 */
export async function saveProfile(userId: string, body: Record<string, unknown>) {
  // (Owner, Nov 5, batch 35 §245; was cut at 80) At most 20 characters: over it is refused at Name ("Keep your name to 20 characters."), never cut silently.
  const name = typeof body.name === "string" ? body.name.trim() : "";
  // (Owner, Oct 27) A name is at least 1 character. (Owner, Nov 11, §380 D2b) Checked after the stop-once box (below; an admin's setup has no box).
  const nameMistake = () => {
    if (name.length < 1) throw new HttpError(400, "bad_name", "Enter your name (others see it).");
    if (name.length > LIMITS.personName) throw new HttpError(400, "bad_name", NAME_TOO_LONG);
  };
  const pronoun = ["she", "he", "they"].includes(body.pronoun as string) ? (body.pronoun as string) : "";
  const isDeveloper = body.isDeveloper === true;
  const isTester = body.isTester === true;
  // (Owner, Oct 28, batch 20 section 16) An admin account has no side (its setup asks only Name and Pronoun; sides sent are ignored, one it has is kept and ignored);
  // everyone else picks at least one.
  const me = await db.user.findUnique({ where: { id: userId } });
  const admin = !!me && isAdmin(me);
  if (admin) {
    nameMistake();
    const user = await db.user.update({ where: { id: userId }, data: { name, pronoun } });
    return user;
  }
  // (Batch 35 §134) Which side's profile this Save is for. The developer's bio is saved only by the developer form, which names its side (an older page never
  // showed it). A developer-side Save of an account with both sides no longer asks for the tester's devices and languages.
  const first = !me?.isDeveloper && !me?.isTester;
  const asked: Side | null = body.side === "developer" && isDeveloper ? "developer" : body.side === "tester" && isTester ? "tester" : null;
  const side = asked ?? sideFor({ isDeveloper, isTester, side: me?.side });
  const testerPart = isTester && (first || side === "tester");
  const devPart = isDeveloper && !first && asked === "developer";
  const devices = pick(body.devices, DEVICES), categories = pick(body.categories, CATEGORIES), languages = pick(body.languages, LANGUAGES);
  const bio = str(body.bio, LIMITS.bio);
  const emailPref = ["daily", "weekly", "monthly", "off"].includes(body.emailPref as string) ? (body.emailPref as string) : undefined;
  // (Owner, Oct 28, batch 16 section 27) What this press sends, in the short form the stop box and the change log use (lists in the options' order).
  const inOrder = (xs: string[], all: string[]) => listLabel(all.filter((x) => xs.includes(x)));
  const sent: Record<string, string> = {
    name, pronoun: pronoun || "not set", sides: sidesLabel(isDeveloper, isTester),
    ...(testerPart ? { devices: inOrder(devices, DEVICES), languages: inOrder(languages, LANGUAGES), bio } : {}),
    ...(devPart ? { devBio: bio } : {}),
  };
  // A change made in another tab or device since this page opened stops the first Save once (a field changed to exactly this value isn't listed). (Batch 35 §134)
  // The other side's own fields aren't on this page, so their changes don't stop it.
  await accountGate(userId, body, "profile", sent, first ? null : side);
  // (Owner, Nov 11, §380 D2b; were before the box) The form's own mistakes after the stop-once box (refusals → box → field mistakes): Save profile is pressable
  // with them, the page marks them red, and nothing is saved while one remains.
  nameMistake();
  if (!isDeveloper && !isTester) throw new HttpError(400, "bad_role", "Choose developer, tester, or both.");
  if (testerPart && devices.length === 0) throw new HttpError(400, "bad_devices", DEVICES_MISSING);
  if (testerPart && languages.length === 0) throw new HttpError(400, "bad_languages", LANGUAGES_MISSING);
  const before = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } });
  const tab = typeof body.tab === "string" ? body.tab : "";
  const saved = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const previous = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
    const user = await tx.user.update({ where: { id: userId }, data: { name, pronoun, isDeveloper, isTester, ...(emailPref ? { emailPref } : {}), ...(devPart ? { devBio: bio } : {}) } });
    if (previous.name !== name) await logAccountChange(userId, tab, { scopes: ["profile", "settings"], field: "name", label: "Name", before: previous.name, after: name }, tx);
    if (testerPart) await tx.testerProfile.upsert({ where: { userId }, update: { devices, categories, languages, bio }, create: { userId, devices, categories, languages, bio } });
    return user;
  });
  const was: Record<string, string> = {
    name: before.name, pronoun: before.pronoun || "not set", sides: sidesLabel(before.isDeveloper, before.isTester),
    devices: inOrder(before.profile?.devices ?? [], DEVICES), languages: inOrder(before.profile?.languages ?? [], LANGUAGES), bio: before.profile?.bio ?? "", devBio: before.devBio,
  };
  // Each side's page reads its own bio's change as "Bio".
  const LABELS: Record<string, string> = { name: "Name", pronoun: "Pronoun", sides: "Sides", devices: "Devices", languages: "Languages", bio: "Bio", devBio: "Bio" };
  for (const [field, after] of Object.entries(sent)) {
    if (field === "name") continue; // Recorded atomically with the rename above.
    if (was[field] === after) continue;
    // A long value (the bio) reads "Bio changed"; the values are kept for the same-value rule.
    const long = was[field].length > 60 || after.length > 60;
    const own = PROFILE_FIELD_SIDE[field];
    await logAccountChange(userId, tab, { scopes: field === "sides" || field === "name" ? ["profile", "settings"] : ["profile"], field, label: LABELS[field], before: was[field], after, ...(long ? { line: `${LABELS[field]} changed` } : {}), ...(own ? { side: own } : {}) });
  }
  return saved;
}

/**
 * (Owner, Oct 28 evening, batch 18 section 1) An account that accepted an older Terms of Use version: its Post a test / post a draft (developer) and Join, Apply,
 * Accept an invite, Ask to rejoin (tester) need the box's tick ("I agree to the updated Terms", sent as `agreeTerms: true`); the tick records the current version. An
 * unticked press is refused with the box's line. Nothing else checks this: running tests, pay, charges, disputes and chat carry on under the terms they started with.
 */
export async function requireCurrentTerms(u: { id: string; termsVersion: number }, body: Record<string, unknown>) {
  if (!needsTermsAgain(u)) return;
  // (Owner, Oct 28, batch 20 section 21) The tick sits above the button with the other ticks: unticked, a red mistake at it ("Tick to agree to the updated Terms of Use.").
  if (body.agreeTerms !== true) throw new HttpError(400, TERMS_UPDATED_CODE, TERMS_TICK_MISSING, { termsHref: TERMS_CHANGED_HREF, termsVersion: TERMS_VERSION, errors: [TERMS_TICK_MISSING] });
  await db.user.updateMany({ where: { id: u.id, termsVersion: { lt: TERMS_VERSION } }, data: { termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() } });
  u.termsVersion = TERMS_VERSION;
}
