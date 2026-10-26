import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { keyNeedLine, keyRefusal, KEY_MAX_LENGTH, parseKeys, repeatedKeys } from "@/lib/keys";
import { HttpError } from "./http";
import { notify } from "./notify";
import { logEvent } from "./live";
import { devGate } from "./tests";

type Tx = Prisma.TransactionClient | typeof db;

// (Design doc 5) Access keys. Free keys go to NEW testers first; a current tester whose key doesn't work gets a free key
// only from the extras (enough must remain for the open spots). A key given to a tester who left is held for them: it
// isn't free and can never be added again. A key reported as not working shows greyed and crossed out in "In use" until it is replaced.

/** How many spots are open on a test right now (spots minus working testers). */
export async function openSpotsOf(tx: Tx, testId: string, spots?: number) {
  const n = spots ?? (await tx.test.findUniqueOrThrow({ where: { id: testId }, select: { spots: true } })).spots;
  const working = await tx.contract.count({ where: { testId, status: "working" } });
  return Math.max(0, n - working);
}

/** Does this test use access keys at all? (Any key ever added.) */
export const usesKeys = async (tx: Tx, testId: string) => (await tx.accessKey.count({ where: { testId } })) > 0;

/** The keys of a test grouped for the Edit page's boxes. */
export async function keyBoxes(testId: string) {
  const keys = await db.accessKey.findMany({ where: { testId }, orderBy: { createdAt: "asc" }, include: { contract: { include: { tester: true } } } });
  const free = keys.filter((k) => k.status === "free").map((k) => ({ id: k.id, value: k.value }));
  const inUse = keys
    .filter((k) => (k.status === "inuse" || k.status === "broken") && k.contract?.status === "working")
    .map((k) => ({ id: k.id, value: k.value, broken: k.status === "broken", tester: displayName(k.contract!.tester), contractId: k.contractId! }));
  const spots = (await db.test.findUniqueOrThrow({ where: { id: testId }, select: { spots: true } })).spots;
  const open = await openSpotsOf(db, testId, spots);
  return { free, inUse, open, uses: keys.length > 0, now: new Date().toISOString() };
}

/** Testers whose key was reported as not working and not yet replaced. */
export async function brokenKeyTesters(testId: string) {
  const keys = await db.accessKey.findMany({ where: { testId, status: "broken", contract: { status: "working" } }, include: { contract: { include: { tester: true } } }, orderBy: { brokenAt: "asc" } });
  return keys.map((k) => ({ keyId: k.id, contractId: k.contractId!, name: displayName(k.contract!.tester), at: k.brokenAt ?? k.createdAt }));
}

/**
 * (Owner, Oct 26) A key reported as not working is NOT replaced automatically: the developer is told quietly (the yellow box on
 * the test page) and presses "Assign a free key" on that tester's row. It gives them the next free key, only from the extras
 * (enough must remain for the open spots), and their broken key leaves "In use".
 */
export async function assignFreeKey(dev: { id: string }, testId: string, contractId: string, body: Record<string, unknown> = {}) {
  const t = await db.test.findUnique({ where: { id: testId } });
  if (!t || t.developerId !== dev.id) throw new HttpError(404, "not_found", "That test doesn't exist or isn't yours.");
  // Stop-once like every developer button (what changed since the page loaded).
  await db.$transaction((tx) => devGate(tx, testId, body));
  const out = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${testId} FOR UPDATE`;
    const broken = await tx.accessKey.findFirst({ where: { testId, contractId, status: "broken", contract: { status: "working" } }, include: { contract: { include: { tester: true } } } });
    if (!broken) throw new HttpError(409, "gone", "That tester doesn't have a key reported as not working any more.");
    const free = await tx.accessKey.findMany({ where: { testId, status: "free" }, orderBy: { createdAt: "asc" } });
    const open = await openSpotsOf(tx, testId);
    if (!free.length) throw new HttpError(409, "no_free_key", "You have no free keys. Add some in Edit first.");
    if (free.length <= open) throw new HttpError(409, "no_extra_key", `Every free key is kept for the ${open} open spot${open === 1 ? "" : "s"}. Add more keys in Edit first.`);
    await tx.accessKey.update({ where: { id: free[0].id }, data: { status: "inuse", contractId, assignedAt: new Date() } });
    await tx.accessKey.update({ where: { id: broken.id }, data: { status: "retired" } });
    return { email: broken.contract!.tester.email, title: broken.contract!.title, name: displayName(broken.contract!.tester) };
  });
  await notify(out.email, `You have a new access key for “${out.title}”`, [`The developer gave you a new access key for “${out.title}”. It shows on your session page.`], `/app/sessions/${contractId}`, { about: dev.id });
  return { assigned: true, name: out.name };
}

/**
 * A tester joins: they get the key held for them (a key stays attached to the tester who left or was ended; if it still
 * works), else the oldest free key. `stillWorks` is their answer when that key had been reported as not working.
 * Throws when the test has keys but none is free.
 */
export async function assignKeyAtJoin(tx: Tx, testId: string, contractId: string, stillWorks = false) {
  if (!(await usesKeys(tx, testId))) return null;
  const held = await tx.accessKey.findFirst({ where: { testId, contractId, status: { in: ["inuse", "broken", "held"] } } });
  if (held && (held.status !== "broken" || stillWorks)) {
    await tx.accessKey.update({ where: { id: held.id }, data: { status: "inuse", brokenAt: null, assignedAt: new Date() } });
    return held.value;
  }
  if (held) await tx.accessKey.update({ where: { id: held.id }, data: { status: "retired" } });
  const free = await tx.accessKey.findFirst({ where: { testId, status: "free" }, orderBy: { createdAt: "asc" } });
  if (!free) throw new HttpError(409, "no_key", "No access key is free right now, so this test can't take another tester until the developer adds one.");
  await tx.accessKey.update({ where: { id: free.id }, data: { status: "inuse", contractId, assignedAt: new Date() } });
  return free.value;
}

/** The tester's current key (while they work on the test), for their session page. */
export async function keyOf(contractId: string) {
  return db.accessKey.findFirst({ where: { contractId, status: { in: ["inuse", "broken"] }, contract: { status: "working" } } });
}

/** Does a tester coming back have a key that had been reported as not working? (The join page asks if it works now.) */
export async function heldBrokenKey(testId: string, testerId: string) {
  const c = await db.contract.findUnique({ where: { testId_testerId: { testId, testerId } }, select: { id: true, status: true } });
  if (!c || c.status === "working") return null;
  return db.accessKey.findFirst({ where: { testId, contractId: c.id, status: "broken" } });
}

/** "This key doesn't work": the key is marked, the developer is told, and a free extra replaces it at once when there is one. */
export async function reportKeyBroken(tester: { id: string; name: string; email: string; pronoun?: string }, contractId: string) {
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { test: { include: { developer: true } } } });
  if (!c || c.testerId !== tester.id) throw new HttpError(404, "not_found", "That session doesn't exist or isn't yours.");
  if (c.status !== "working") throw new HttpError(409, "gone", "You're not working on this test any more.");
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${c.testId} FOR UPDATE`;
    const key = await tx.accessKey.findFirst({ where: { testId: c.testId, contractId, status: { in: ["inuse", "broken"] } } });
    if (!key) throw new HttpError(409, "no_key", "You don't have an access key on this test.");
    if (key.status === "broken") return { already: true, replaced: [] as { contractId: string }[] };
    await tx.accessKey.update({ where: { id: key.id }, data: { status: "broken", brokenAt: new Date() } });
    return { already: false, replaced: [] as { contractId: string }[] };
  });
  if (result.already) return { reported: true, replaced: false, note: "The developer was already told. You'll see a new key here as soon as they add one." };
  const name = displayName(tester);
  await logEvent(c.testId, "key", `${name} says their access key doesn't work`, c.id);
  await notify(c.test.developer.email, `${name} reports an access key not working on “${c.title}”`, [`${name} says the access key they were given for “${c.title}” doesn't work.`, "Press Assign a free key on their row in the yellow box on your test page."], `/app/tests/${c.testId}#keys`, { about: tester.id });
  return { reported: true, replaced: false, note: "Thanks. The developer was told; a new key shows here once they give you one." };
}

/** Parse + check the keys typed on Post (a list; each once; length). Returns the keys or throws the first mistake. */
export function checkTypedKeys(v: unknown) {
  const keys = parseKeys(v);
  const dup = repeatedKeys(v);
  if (dup.length) throw new HttpError(400, "bad_keys", `${dup.join(", ")} ${dup.length === 1 ? "is" : "are"} typed more than once. Each key goes in once.`);
  const long = keys.find((k) => k.length > KEY_MAX_LENGTH);
  if (long) throw new HttpError(400, "bad_keys", `A key can be at most ${KEY_MAX_LENGTH} characters.`);
  return keys;
}

/** The mistakes with the keys that would be added and removed, against what the test has now. Does not write. */
export async function planKeyChange(tx: Tx, testId: string, add: string[], remove: string[], spots: number) {
  const existing = await tx.accessKey.findMany({ where: { testId } });
  const errors: string[] = [];
  const toAdd: string[] = [];
  for (const v of add) {
    const e = existing.find((k) => k.value === v);
    if (e) {
      const why = keyRefusal(v, e.status);
      if (why) errors.push(why);
    } else toAdd.push(v);
  }
  const removable = existing.filter((k) => k.status === "free" && remove.includes(k.value));
  const alreadyGone = remove.filter((v) => !existing.some((k) => k.value === v && k.status === "free"));
  const free = existing.filter((k) => k.status === "free").length - removable.length + toAdd.length;
  const open = await openSpotsOf(tx, testId, spots);
  const used = existing.length > 0 || toAdd.length > 0;
  // Every open spot needs a free key (only when the test uses keys at all).
  const need = used && (toAdd.length > 0 || removable.length > 0 || existing.length > 0) ? keyNeedLine(open, free) : "";
  return { errors, toAdd, removable: removable.map((k) => k.id), alreadyGone, need, free, open };
}

export async function applyKeyChange(tx: Tx, testId: string, toAdd: string[], removeIds: string[]) {
  if (removeIds.length) await tx.accessKey.deleteMany({ where: { id: { in: removeIds }, status: "free" } });
  if (toAdd.length) await tx.accessKey.createMany({ data: toAdd.map((value) => ({ testId, value })) });
}
