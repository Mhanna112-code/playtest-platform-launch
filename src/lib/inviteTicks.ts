import type { StoreLike } from "./keepTyped";

/**
 * (Owner, Nov 4, §173) The invite panel's ticks survive a reload in the same tab: kept in the tab's sessionStorage per account and test
 * ("pt-invite-ticks:<user>:<test>"), written as the ticks change and gone when they empty (Invite went through, or every tick was taken off). On a reload only the
 * people the panel can still invite come back ticked; everyone else is dropped and named in one line under the panel (`notTickedLine`). The search box is never kept.
 * (Batch 35 §8) Like the tab's typed fields, every kept tick in the tab goes at each sign-in and sign-out (SessionWatch's forgetTyped): after one, the ticks start over.
 * Every storage access is guarded: without storage the panel works as before (nothing kept).
 */
export const INVITE_TICKS_PREFIX = "pt-invite-ticks:";

export const inviteTicksKey = (userId: string, testId: string) => `${INVITE_TICKS_PREFIX}${userId}:${testId}`;

/** The ticked ids kept for `key` (none: an empty list; anything unreadable counts as none). */
export function readInviteTicks(store: StoreLike | null, key: string): string[] {
  try {
    const v = JSON.parse(store?.getItem(key) ?? "null") as unknown;
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x !== ""))] : [];
  } catch {
    return [];
  }
}

/** Keeps the ticks for `key`; no ticks: the kept copy goes. */
export function writeInviteTicks(store: StoreLike | null, key: string, ids: string[]) {
  try {
    if (ids.length) store?.setItem(key, JSON.stringify(ids));
    else store?.removeItem(key);
  } catch {
    // storage blocked or full: nothing kept
  }
}

/** (Batch 35 §8) Every kept tick in this tab (any account, any test) goes: signed out, or someone signed in. */
export function dropAllInviteTicks(store: StoreLike | null) {
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(INVITE_TICKS_PREFIX)) keys.push(k);
    }
    for (const k of keys) store.removeItem(k);
  } catch {
    // storage blocked
  }
}

export type DroppedTick = { id: string; name: string; why: string };

/**
 * The ticks after a restore: what the developer ticked meanwhile, plus the kept ones the server says are still invitable (`keep`); the kept ones it dropped are
 * named. A kept id the server neither keeps nor names (never a tester) just goes.
 */
export function restoredTicks(kept: string[], current: string[], answer: { keep: { id: string }[]; drop: DroppedTick[] }) {
  const ok = new Set(answer.keep.map((r) => r.id));
  const wanted = new Set(kept);
  const ticked = [...current, ...kept.filter((id) => ok.has(id) && !current.includes(id))];
  const dropped = answer.drop.filter((d) => wanted.has(d.id) && !ok.has(d.id) && !current.includes(d.id));
  return { ticked, dropped };
}

/** "Not ticked any more: Ana Silva (already in this test), Dee Moss (can't join this test)." (nobody dropped: ""). */
export const notTickedLine = (dropped: { name: string; why: string }[]) => (dropped.length ? `Not ticked any more: ${dropped.map((d) => `${d.name} (${d.why})`).join(", ")}.` : "");
