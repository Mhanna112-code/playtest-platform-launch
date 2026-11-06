import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import type { Rich, Seg } from "@/lib/rich";
import { REPORTED_LABEL } from "./reports";
import { testTitleOf } from "@/lib/rules";
import { linksIn, splitLinks, type LineLink } from "@/lib/lineLinks";

// (Owner, Oct 30, batch 33 §1) The links of the admin console and the admin boxes: every developer or tester named opens their profile (with its admin box), shown as
// "Nora Lane (nora@…)" with the name as the link; every test named opens its page (with its admin box); every Stripe id opens that object in the Stripe Dashboard.

export type Who = { id: string; email: string; name: string; isDeveloper: boolean; deletedAt: Date | null; /** (batch 35 §162) for the lines about them */ pronoun?: string };

/** The profile page an admin opens for an account (the one the Accounts list links to): the developer's, or else the tester's. Both carry the admin box. */
export const profileHref = (u: { id: string; isDeveloper: boolean }) => (u.isDeveloper ? `/app/developers/${u.id}` : `/app/testers/${u.id}`);

/** A test's page (the team's Find view, with the test's admin box). */
export const testHref = (testId: string) => `/app/find/${testId}`;

/** "Nora Lane (nora@…)": the name opens the profile; a person reported more than 3 times keeps that label after it. */
export function person(u: Who | null | undefined, flagged = false): Seg[] {
  if (!u) return ["a deleted account"];
  return [{ t: displayName(u), href: profileHref(u) }, ` (${u.email})${flagged ? ` (${REPORTED_LABEL})` : ""}`];
}
/** Just the name, as a link (where the email was already given on the row). */
export const personName = (u: Who | null | undefined): Seg => (u ? { t: displayName(u), href: profileHref(u) } : "a deleted account");

/** “Harbor Run”, opening the test's page. */
/** (Owner, Nov 3, batch 35 §168) A Next round's draft with no name yet reads “Untitled draft (round 2)”. */
export const testLink = (t: { id: string; title: string; round?: number | null } | null | undefined): Seg => (t ? { t: `“${testTitleOf(t)}”`, href: testHref(t.id) } : "“?”");

/** The accounts by id, for the links (deleted ones too: they still open their profile's admin box). */
export async function whoById(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, Who>();
  const rows = await db.user.findMany({ where: { id: { in: list } }, select: { id: true, email: true, name: true, pronoun: true, isDeveloper: true, deletedAt: true } });
  return new Map(rows.map((u) => [u.id, u]));
}

/**
 * (Batch 33 §1) A Stripe object's page in the Stripe Dashboard: test mode for a test key (https://dashboard.stripe.com/test/payments/<id>), live otherwise. Built here on
 * the server from the key's prefix only; the key itself never leaves the server. "" for an id that isn't a Stripe object's.
 */
export function stripeDashboardUrl(id: string | null | undefined) {
  if (!id) return "";
  const test = /^[sr]k_test_/.test(process.env.STRIPE_SECRET_KEY?.trim() ?? "");
  const base = `https://dashboard.stripe.com/${test ? "test/" : ""}`;
  if (/^(pi|ch|py)_/.test(id)) return `${base}payments/${id}`;
  if (/^tr_/.test(id)) return `${base}connect/transfers/${id}`;
  if (/^(dp|du)_/.test(id)) return `${base}disputes/${id}`;
  if (/^re_/.test(id)) return `${base}refunds/${id}`;
  return "";
}
/** A Stripe id as a link to its Dashboard page (new tab), or the id alone when it isn't a Stripe object's. */
export const stripeLink = (id: string): Seg => {
  const href = stripeDashboardUrl(id);
  return href ? { t: id, href, ext: true } : id;
};
/** " · pi_… · tr_…": a payment's Stripe ids (its PaymentIntent, else its charge; and its transfer), each a Dashboard link. Nothing when it has none. */
export function stripeIds(p: { stripePaymentIntentId?: string | null; stripeChargeId?: string | null; stripeTransferId?: string | null }): Rich {
  const ids = [p.stripePaymentIntentId || p.stripeChargeId, p.stripeTransferId].filter((x): x is string => !!x);
  return ids.flatMap((id) => [" · ", stripeLink(id)]);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * (Batch 33 §1) A line already written in words ("Nora Lane paid Ana Silva $10.00 …"): each of these people's names becomes their profile link with the email after it.
 * Whole words only (never inside an email), longest name first.
 */
export function linkNames(text: string, people: (Who | null | undefined)[]): Rich {
  const known = new Map<string, Who>();
  for (const u of people) if (u && !known.has(displayName(u))) known.set(displayName(u), u);
  const names = [...known.keys()].filter((n) => n.length > 1).sort((a, b) => b.length - a.length);
  if (!names.length) return [text];
  // Never inside an email address ("ana@…", "dev+ana@…").
  const re = new RegExp(`(?<![\\p{L}\\p{N}@.+_-])(${names.map(esc).join("|")})(?![\\p{L}\\p{N}@]|\\.[\\p{L}\\p{N}])`, "gu");
  const out: Rich = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push(text.slice(at, m.index));
    out.push(...person(known.get(m[1])));
    at = m.index! + m[1].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

// ---------- (Owner, Nov 5, §277) Green links on every person and test in the team's bells and console lines ----------

/** (§270) "You" / "your" is never a link. */
const YOU = /^(you|your|yours|you're)$/i;
/**
 * (Owner, Nov 5, §277) A person named in a team line, as the console already links them: their profile with its admin box (`profileHref`: the developer's page,
 * else the tester's). Null for a deleted account ("Deleted account" stays plain) or a name too short to find safely.
 */
export function adminPersonLink(u: { id: string; name: string; email: string; isDeveloper: boolean; deletedAt: Date | null } | null | undefined): LineLink | null {
  if (!u || u.deletedAt) return null;
  const text = displayName(u);
  if (text.length < 2 || YOU.test(text)) return null;
  return { text, href: profileHref(u), kind: "person" };
}
/** (§277) A test named in a team line: its page with the test's admin box (`testHref`, the team's Find view), under each name it was written with. */
export function adminTestLinks(t: { id: string; title: string; round?: number | null }, more: string[] = []): LineLink[] {
  return [...new Set([testTitleOf(t), ...more.map((x) => x.trim())])].filter(Boolean).map((text) => ({ text, href: testHref(t.id), kind: "test" as const }));
}

const pwho = { id: true, name: true, email: true, isDeveloper: true, deletedAt: true } as const;
/** (§277) The team's link pool, from a line's own data (never the reader's tests): `all`; each test's own names and people (`byTest`); each person (`byUser`). */
export type AdminPool = { all: LineLink[]; byTest: Map<string, LineLink[]>; byUser: Map<string, LineLink> };
const addTo = (list: LineLink[], l: LineLink | null | undefined) => {
  if (l && !list.some((x) => x.text === l.text)) list.push(l);
};
const idsOf = (xs?: (string | null | undefined)[]) => [...new Set((xs ?? []).filter((x): x is string => !!x))];

/**
 * (Owner, Nov 5, §277) Everyone and every test a team line can name, from the line's own data: these tests (`testIds`), the tests of these developers (`devIds`) and
 * of these testers (`testerIds`), each with its names (its title now and its contracts' titles), its developer and its testers; and these people (`userIds`).
 */
export async function adminPool(o: { testIds?: (string | null | undefined)[]; devIds?: (string | null | undefined)[]; testerIds?: (string | null | undefined)[]; userIds?: (string | null | undefined)[] }): Promise<AdminPool> {
  const [testIds, devIds, testerIds, userIds] = [idsOf(o.testIds), idsOf(o.devIds), idsOf(o.testerIds), idsOf(o.userIds)];
  const or = [...(testIds.length ? [{ id: { in: testIds } }] : []), ...(devIds.length ? [{ developerId: { in: devIds } }] : []), ...(testerIds.length ? [{ contracts: { some: { testerId: { in: testerIds } } } }] : [])];
  const [tests, users] = await Promise.all([
    or.length ? db.test.findMany({ where: { OR: or }, take: 2000, select: { id: true, title: true, round: true, developer: { select: pwho }, contracts: { select: { title: true, tester: { select: pwho } } } } }) : Promise.resolve([]),
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: pwho }) : Promise.resolve([]),
  ]);
  const byTest = new Map<string, LineLink[]>();
  const byUser = new Map<string, LineLink>();
  const all: LineLink[] = [];
  for (const u of users) {
    const l = adminPersonLink(u);
    if (l) byUser.set(u.id, l);
    addTo(all, l);
  }
  for (const t of tests) {
    const list: LineLink[] = [];
    for (const l of adminTestLinks(t, t.contracts.map((c) => c.title))) addTo(list, l);
    addTo(list, adminPersonLink(t.developer));
    for (const c of t.contracts) addTo(list, adminPersonLink(c.tester));
    byTest.set(t.id, list);
    for (const l of list) addTo(all, l);
  }
  return { all, byTest, byUser };
}

/**
 * (Owner, Nov 5, §277) A team line with every person and test its words name as a link too (the same green as the names it already links): each plain piece is
 * matched against the pool as §270 matches a bell line (whole names, standing alone, never inside an email; a name an older cut ended with "…" by its visible
 * start; `prefer` wins a name two share). Links already in the line, Stripe ids and typed reasons (the quoted box) are kept as they are.
 */
export function linkRich(r: Rich, pool: (LineLink | null | undefined)[], prefer: (LineLink | null | undefined)[] = []): Rich {
  if (!pool.some(Boolean) && !prefer.some(Boolean)) return r;
  const out: Rich = [];
  for (const s of r) {
    if (typeof s !== "string" || !s) {
      out.push(s);
      continue;
    }
    for (const p of splitLinks(s, linksIn(s, pool, prefer))) out.push(p.link ? { t: p.t, href: p.link.href } : p.t);
  }
  return out;
}
/** (§277) A plain team line as its pieces, every person and test it names a link. */
export const richOf = (text: string, pool: (LineLink | null | undefined)[], prefer: (LineLink | null | undefined)[] = []): Rich => linkRich([text], pool, prefer);

/** (§277) The place on the console a team bell opens: a dispute's, a hold lift's or a report's row, Chargeback holds. */
function bellPlace(link: string): { kind: "dispute" | "lift" | "report" | "chargebacks"; id: string } | null {
  const dispute = /[?&]dispute=([^&#]+)/.exec(link)?.[1] ?? /#dispute-([^&#?]+)$/.exec(link)?.[1];
  if (dispute) return { kind: "dispute", id: dispute };
  const m = /#(lift|report)-([^&#?]+)$/.exec(link);
  if (m) return { kind: m[1] as "lift" | "report", id: m[2] };
  if (/#chargebacks$/.test(link)) return { kind: "chargebacks", id: "" };
  return null;
}

/**
 * (Owner, Nov 5, §277) The links of the team's bell lines (the lines that open the admin console: "Hold lift waiting: …", "Dispute on “…”: …", "New report: …"),
 * for an admin reading their bell. The reader's own tests have nothing to do with them, so each line's pool comes from the line's own data: the bell's test and
 * the row it opens (a dispute's test with its developer and testers, the disputing tester first; the developer waiting for a lift; the reporter and the reported
 * person; the developers on a chargeback hold and their tests). Worked out when the bell is read, never stored, so lines written before §277 get their links
 * too. A line that doesn't open the console isn't in the map (§270's pool draws it); a line naming no one (the suspended reminder) gets none.
 */
export async function adminBellLinks(items: { id: string; text: string; link: string; testId: string | null }[]): Promise<Map<string, LineLink[]>> {
  const team = items.filter((n) => n.link.startsWith("/admin"));
  const out = new Map<string, LineLink[]>();
  if (!team.length) return out;
  const places = new Map(team.map((n) => [n.id, bellPlace(n.link)]));
  const of = (k: string) => idsOf([...places.values()].filter((p) => p?.kind === k).map((p) => p!.id));
  const [disputes, reports] = await Promise.all([
    of("dispute").length ? db.dispute.findMany({ where: { id: { in: of("dispute") } }, select: { id: true, testerId: true, contractId: true } }) : Promise.resolve([]),
    of("report").length ? db.report.findMany({ where: { id: { in: of("report") } }, select: { id: true, reporterId: true, reportedId: true } }) : Promise.resolve([]),
  ]);
  const testOf = new Map((disputes.length ? await db.contract.findMany({ where: { id: { in: disputes.map((d) => d.contractId) } }, select: { id: true, testId: true } }) : []).map((c) => [c.id, c.testId]));
  const disputeOf = new Map(disputes.map((d) => [d.id, d]));
  const reportOf = new Map(reports.map((r) => [r.id, r]));
  const onChargeback = [...places.values()].some((p) => p?.kind === "chargebacks") ? await db.user.findMany({ where: { holdStartedAt: { not: null }, holdReason: "chargeback" }, select: { id: true }, take: 500 }) : [];
  const [pool, cbPool] = await Promise.all([
    adminPool({
      testIds: [...team.map((n) => n.testId), ...disputes.map((d) => testOf.get(d.contractId))],
      userIds: [...of("lift"), ...disputes.map((d) => d.testerId), ...reports.flatMap((r) => [r.reporterId, r.reportedId])],
    }),
    onChargeback.length ? adminPool({ devIds: onChargeback.map((u) => u.id), userIds: onChargeback.map((u) => u.id) }) : Promise.resolve(null),
  ]);
  for (const n of team) {
    const p = places.get(n.id);
    const d = p?.kind === "dispute" ? disputeOf.get(p.id) : undefined;
    const r = p?.kind === "report" ? reportOf.get(p.id) : undefined;
    const testId = n.testId ?? (d ? testOf.get(d.contractId) : undefined);
    // The line's own people first (a name two people share goes to the one this line is about), then its test's names and people.
    const own: (LineLink | null | undefined)[] = [
      ...(d ? [pool.byUser.get(d.testerId)] : []),
      ...(r ? [pool.byUser.get(r.reporterId), pool.byUser.get(r.reportedId)] : []),
      ...(p?.kind === "lift" ? [pool.byUser.get(p.id)] : []),
      ...(testId ? pool.byTest.get(testId) ?? [] : []),
    ];
    const rest: (LineLink | null | undefined)[] = p?.kind === "chargebacks" ? cbPool?.all ?? [] : [];
    out.set(n.id, linksIn(n.text, [...own, ...rest]));
  }
  return out;
}
