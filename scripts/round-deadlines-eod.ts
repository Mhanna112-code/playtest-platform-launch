// (Owner, Nov 3, batch 35 §154) One-off: a working tester's deadline that an earlier pause, outage or rejoin left at an odd time ("Fri, Nov 6, 7:22 AM") is
// rounded UP to the end of that day (11:59 PM in the developer's zone, where deadlines are counted), as every move now does. Never earlier; a deadline already at a
// day's end is left alone; passed deadlines are left alone. Dry run by default (prints what would change); --apply writes. Local databases only.
// Run: npx tsx --env-file=.env scripts/round-deadlines-eod.ts [--apply]
import { db } from "@/lib/db";
import { dayEndAtOrAfter } from "@/lib/rules";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) throw new Error("round-deadlines-eod: local databases only (DATABASE_URL must be localhost).");

(async () => {
  const now = new Date();
  const cs = await db.contract.findMany({ where: { status: "working", dueAt: { gt: now } }, select: { id: true, dueAt: true, test: { select: { title: true, developer: { select: { timeZone: true } } } } } });
  const moves = cs.flatMap((c) => {
    const to = dayEndAtOrAfter(c.dueAt, c.test.developer.timeZone);
    return to.getTime() === c.dueAt.getTime() ? [] : [{ id: c.id, test: c.test.title, from: c.dueAt.toISOString(), to: to.toISOString() }];
  });
  if (apply) for (const m of moves) await db.contract.update({ where: { id: m.id }, data: { dueAt: new Date(m.to) } });
  console.log(JSON.stringify({ apply, checked: cs.length, rounded: moves.length, moves }, null, 1));
  process.exit(0);
})();
