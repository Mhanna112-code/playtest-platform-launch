import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { keyNeedLine, keyRefusal, KEY_MAX_LENGTH, KEY_TOO_LONG, NO_FREE_KEY, parseKeys, repeatedKeys, reusedKeyLine } from "@/lib/keys";
import { HttpError } from "./http";

type Tx = Prisma.TransactionClient | typeof db;

// (Design doc 5) Access keys. Free keys go to NEW testers (the oldest free key at join). (Owner, Oct 29, batch 14 section 6) Nothing ever replaces a key on its own
// and there is no "Assign a free key": a tester whose key doesn't work is sent one by the developer in a message (a free key deleted in Edit).
// (Owner, Nov 7) Leaving or ending work unassigns keys without returning them to Free; manual reuse retains the previous recipient.
// (Owner, Nov 6, §304) There is no "This key doesn't work" any more: a tester whose key fails says so in chat. A key still stored as "broken" (reported before
// §304) is simply a key in use: shown normally everywhere, given back to its tester on rejoining like any held key. The status and its columns stay, unused.

/** How many spots are open on a test right now (spots minus working testers). */
export async function openSpotsOf(tx: Tx, testId: string, spots?: number) {
  const n = spots ?? (await tx.test.findUniqueOrThrow({ where: { id: testId }, select: { spots: true } })).spots;
  const working = await tx.contract.count({ where: { testId, status: "working" } });
  return Math.max(0, n - working);
}

/** Does this test use access keys at all? (Any key ever added.) */
export const usesKeys = async (tx: Tx, testId: string) => (await tx.accessKey.count({ where: { testId } })) > 0;

/**
 * (Owner, Nov 9, §341) The tests (of `testIds`) that use access keys and have NO free key: with a spot open they count as FULL to testers (Find, the join page,
 * Join / Apply / Accept invite / Ask to rejoin), but unlike a real full nothing closes (applications, rejoin asks and invites stay), and the developer's own
 * Accept or Invite is refused with the key line (NO_FREE_KEY). Whether a spot is open is the caller's (testers in < spots).
 */
export async function noFreeKeyTests(tx: Tx, testIds: string[]): Promise<Set<string>> {
  if (!testIds.length) return new Set();
  const rows = await tx.accessKey.groupBy({ by: ["testId", "status"], where: { testId: { in: testIds } }, _count: { _all: true } });
  const uses = new Set(rows.map((r) => r.testId)), free = new Set(rows.filter((r) => r.status === "free" && r._count._all > 0).map((r) => r.testId));
  return new Set([...uses].filter((id) => !free.has(id)));
}
/** (§341) This test is "full for want of a key" now: it uses keys, no key is free, and a spot is open. */
export async function keysFullNow(tx: Tx, testId: string) {
  if (!(await noFreeKeyTests(tx, [testId])).has(testId)) return false;
  return (await openSpotsOf(tx, testId)) > 0;
}

/** Called under the test lock, in the same transaction that ends the tester's work. */
export async function releaseTesterKeys(tx: Tx, contractId: string) {
  const keys = await tx.accessKey.findMany({ where: { contractId, status: { in: ["inuse", "held", "broken"] } }, select: { id: true, value: true, assignedAt: true, createdAt: true, contract: { select: { tester: { select: { name: true, email: true, deletedAt: true } } } } } });
  for (const key of keys) {
    if (!(await tx.contractNote.findFirst({ where: { contractId, kind: "key_assigned", text: key.value } }))) await tx.contractNote.create({ data: { contractId, kind: "key_assigned", text: key.value, createdAt: key.assignedAt ?? key.createdAt } });
    await tx.accessKey.updateMany({ where: { id: key.id, contractId }, data: { status: "unassigned", contractId: null, assignedAt: null, brokenAt: null, fixedAt: null, brokenDismissedAt: null, reusedFrom: key.contract ? displayName(key.contract.tester) : "", reusedBroken: false } });
  }
}

/** Also releases assignments made before automatic unassignment was introduced. Caller holds the test lock. */
export async function releaseInactiveKeys(tx: Tx, testId: string) {
  const rows = await tx.accessKey.findMany({ where: { testId, status: { in: ["inuse", "held", "broken"] }, contract: { OR: [{ status: { not: "working" } }, { tester: { deletedAt: { not: null } } }] } }, select: { contractId: true }, distinct: ["contractId"] });
  for (const row of rows) if (row.contractId) await releaseTesterKeys(tx, row.contractId);
}

/**
 * The keys of a test grouped for the Edit page. Departed testers' assignments leave both boxes; their key history stays in ContractNote.
 * Every key a refusal calls "in use" belongs to a working tester.
 * (Owner, Nov 6, §304) No "broken" flag or rows: a key once reported shows as a normal key.
 */
export async function keyBoxes(testId: string) {
  await db.$transaction(async (tx) => {
    await (await import("./tests")).lockTest(tx, testId);
    await releaseInactiveKeys(tx, testId);
  });
  const keys = await db.accessKey.findMany({ where: { testId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { contract: { include: { tester: true } } } });
  const free = keys.filter((k) => k.status === "free").map((k) => ({ id: k.id, value: k.value, ...(k.reusedFrom ? { reused: { from: k.reusedFrom } } : {}) }));
  const inUse = keys
    .filter((k) => (k.status === "inuse" || k.status === "broken" || k.status === "held") && k.contract)
    .map((k) => {
      const working = k.contract!.status === "working";
      return { id: k.id, value: k.value, tester: displayName(k.contract!.tester), testerHref: k.contract!.tester.deletedAt ? null : `/app/testers/${k.contract!.tester.id}`, contractId: k.contractId!, ...(working ? {} : { gone: k.contract!.status === "left" ? ("left" as const) : ("finished" as const) }) };
    })
    .sort((a, b) => Number(!!a.gone) - Number(!!b.gone));
  const spots = (await db.test.findUniqueOrThrow({ where: { id: testId }, select: { spots: true } })).spots;
  const open = await openSpotsOf(db, testId, spots);
  // testersIn: the working testers now, so Edit counts the open spots live as testers join.
  const testersIn = await db.contract.count({ where: { testId, status: "working" } });
  // (Batch 30 §17) Working testers without a key (the test had none when they joined): each gets one of the free keys at the next Save.
  const keyless = await keylessWorking(db, testId).then((x) => x.length);
  const previous = [...(await previousKeyUsers(db, testId))].map(([value, tester]) => ({ value, tester }));
  return { free, inUse, previous, open, testersIn, keyless, uses: keys.length > 0, now: new Date().toISOString() };
}

/**
 * A tester joins: they get the oldest free key. Rejoining releases any legacy held assignment first.
 * (Owner, Nov 6, §304) A held key once reported as not working comes back like any other (no "does it work again?" question).
 * Throws when the test has keys but none is free.
 */
export async function assignKeyAtJoin(tx: Tx, testId: string, contractId: string) {
  await releaseInactiveKeys(tx, testId);
  if (!(await usesKeys(tx, testId))) return null;
  const held = await tx.accessKey.findFirst({ where: { testId, contractId, status: { in: ["inuse", "broken", "held"] } } });
  if (held) {
    await tx.accessKey.update({ where: { id: held.id }, data: { status: "inuse", brokenAt: null, assignedAt: new Date() } });
    await tx.contractNote.create({ data: { contractId, kind: "key_assigned", text: held.value } });
    return held.value;
  }
  const free = await tx.accessKey.findFirst({ where: { testId, status: "free" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  if (!free) throw new HttpError(409, "no_key", NO_FREE_KEY);
  await tx.accessKey.update({ where: { id: free.id }, data: { status: "inuse", contractId, assignedAt: new Date() } });
  await tx.contractNote.create({ data: { contractId, kind: "key_assigned", text: free.value } });
  return free.value;
}

/** (Batch 30 §17) The TestEvent a Save's key leaves for each tester given one (contractId: theirs). */
export const KEY_GIVEN = "key_given";

/** (Batch 30 §17) The working testers who have no key (in order of joining). */
export async function keylessWorking(tx: Tx, testId: string) {
  return tx.contract.findMany({ where: { testId, status: "working", accessKeys: { none: { status: { in: ["inuse", "broken"] } } } }, orderBy: { joinedAt: "asc" }, include: { tester: true } });
}

/**
 * (Owner, Oct 29, batch 30 §17) After a Save: each working tester without a key gets one of the free keys (the oldest first), in order of joining. No accept step;
 * testers whose work ended get none. Returns who got one (for their top-box line and bell).
 */
export async function giveKeysToWorking(tx: Tx, testId: string) {
  const waiting = await keylessWorking(tx, testId);
  if (!waiting.length) return [];
  const free = await tx.accessKey.findMany({ where: { testId, status: "free" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: waiting.length }); // in the order typed (one Save adds them at the same moment)
  const now = new Date();
  const given: { contractId: string; testerId: string; email: string; name: string }[] = [];
  for (let i = 0; i < Math.min(free.length, waiting.length); i++) {
    await tx.accessKey.update({ where: { id: free[i].id }, data: { status: "inuse", contractId: waiting[i].id, assignedAt: now } });
    await tx.contractNote.create({ data: { contractId: waiting[i].id, kind: "key_assigned", text: free[i].value, createdAt: now } });
    given.push({ contractId: waiting[i].id, testerId: waiting[i].testerId, email: waiting[i].tester.email, name: displayName(waiting[i].tester) });
  }
  return given;
}

/** The tester's current key (while they work on the test), for their session page. */
export async function keyOf(contractId: string) {
  return db.accessKey.findFirst({ where: { contractId, status: { in: ["inuse", "broken"] }, contract: { status: "working" } } });
}

/** Parse + check the keys typed on Post (a list; each once; length). Returns the keys or throws the first mistake. */
export function checkTypedKeys(v: unknown) {
  const keys = parseKeys(v);
  const dup = repeatedKeys(v);
  if (dup.length) throw new HttpError(400, "bad_keys", `${dup.join(", ")} ${dup.length === 1 ? "is" : "are"} typed more than once. Each key goes in once.`);
  const long = keys.find((k) => k.length > KEY_MAX_LENGTH);
  if (long) throw new HttpError(400, "bad_keys", KEY_TOO_LONG);
  return keys;
}

/**
 * The mistakes with the keys that would be added and removed, against what the test has now. Does not write. (Owner, Oct 30, batch 15 sections 19 and 44) A key of a tester
 * who left or finished can be typed back: it goes back to Free with a WARNING (`warnings`, never a mistake): "HR-3333: reused, previously given to Ben Okafor."
 * ((Owner, Nov 6, §304) never "reported as broken" any more). Refused: a key in use by a current working tester, and a duplicate.
 */
export async function planKeyChange(tx: Tx, testId: string, add: string[], remove: string[], spots: number) {
  const existing = await tx.accessKey.findMany({ where: { testId }, include: { contract: { include: { tester: true } } } });
  const errors: string[] = [];
  const warnings: string[] = [];
  const history = await previousKeyUsers(tx, testId);
  const toAdd: string[] = [];
  const toReuse: { id: string; from: string }[] = [];
  for (const v of add) {
    const e = existing.find((k) => k.value === v);
    if (!e) { toAdd.push(v); if (history.has(v)) warnings.push(reusedKeyLine(v, history.get(v)!)); }
    // (Batch 16 section 17) Already free (another tab added the same key meanwhile): what this tab wanted is there, so it's neither a mistake nor added twice.
    else if (e.status === "free") continue;
    else {
      const name = e.contract ? displayName(e.contract.tester) : e.reusedFrom || history.get(v) || "";
      const why = keyRefusal(v, e.status, { working: e.contract?.status === "working", name });
      if (why) errors.push(why);
      else {
        warnings.push(reusedKeyLine(v, name));
        toReuse.push({ id: e.id, from: name });
      }
    }
  }
  // (Owner, Oct 28, batch 16 section 20) A key deleted here that a joining tester was given meanwhile is no mistake: Save stops once with the warning
  // (givenDeletedLine, in the edit route) and the key simply stays in use.
  const removable = existing.filter((k) => k.status === "free" && remove.includes(k.value));
  const alreadyGone = remove.filter((v) => !existing.some((k) => k.value === v && k.status === "free"));
  const free = existing.filter((k) => k.status === "free").length - removable.length + toAdd.length + toReuse.length;
  const open = await openSpotsOf(tx, testId, spots);
  const used = existing.length > 0 || toAdd.length > 0;
  // (Batch 30 §17) Working testers without a key get one of the free keys at this Save: they need one each too.
  const keyless = used ? (await keylessWorking(tx, testId)).length : 0;
  // Every open spot needs a free key (only when the test uses keys at all).
  const need = used && (toAdd.length > 0 || removable.length > 0 || existing.length > 0) ? keyNeedLine(open, free, keyless) : "";
  return { errors, warnings, toAdd, toReuse, removable: removable.map((k) => k.id), alreadyGone, need, free, open, keyless };
}

export async function applyKeyChange(tx: Tx, testId: string, toAdd: string[], removeIds: string[], toReuse: { id: string; from: string }[] = []) {
  if (removeIds.length) await tx.accessKey.deleteMany({ where: { id: { in: removeIds }, status: "free" } });
  if (toAdd.length) {
    const history = await previousKeyUsers(tx, testId);
    await tx.accessKey.createMany({ data: toAdd.map((value) => ({ testId, value, reusedFrom: history.get(value) ?? "" })) });
  }
  // (Batch 15 sections 19 and 44) A key typed back from a tester who left or finished: free again, its notice chip says where it came from.
  for (const r of toReuse) await tx.accessKey.update({ where: { id: r.id }, data: { status: "free", contractId: null, assignedAt: null, brokenAt: null, fixedAt: null, brokenDismissedAt: null, reusedFrom: r.from, reusedBroken: false } });
}

/** Assignment history survives unassignment and deletion from the free pool. Latest recipient wins. */
async function previousKeyUsers(tx: Tx, testId: string) {
 const contracts=await tx.contract.findMany({where:{testId},select:{id:true,tester:true}});
 const names=new Map(contracts.map(c=>[c.id,displayName(c.tester)]));
 const notes=await tx.contractNote.findMany({where:{kind:"key_assigned",contractId:{in:contracts.map(c=>c.id)}},orderBy:[{createdAt:"desc"},{id:"desc"}],select:{text:true,contractId:true}});
 const result=new Map<string,string>();
 for(const note of notes)if(!result.has(note.text))result.set(note.text,names.get(note.contractId) ?? "Previous tester");
 return result;
}
