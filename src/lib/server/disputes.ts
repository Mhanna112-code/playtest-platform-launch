import { db } from "@/lib/db";
import { displayName, fmtDateTime } from "@/lib/format";

/** (Owner, Oct 30, batch 15 section 27) A developer's open disputes still waiting for their (optional) side, newest first: the dashboard box while restricted. */
export async function disputesForSide(devId: string) {
  const contracts = await db.contract.findMany({ where: { test: { developerId: devId } }, select: { id: true, testId: true, title: true, tester: true } });
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const ds = await db.dispute.findMany({ where: { status: "open", devSideAt: null, contractId: { in: contracts.map((c) => c.id) } }, orderBy: { createdAt: "desc" }, take: 200 });
  const subs = new Map((await db.submission.findMany({ where: { id: { in: ds.map((d) => d.submissionId).filter((x): x is string => !!x) } }, select: { id: true, kind: true } })).map((s) => [s.id, s.kind]));
  const calls = new Map((await db.call.findMany({ where: { id: { in: ds.map((d) => d.callId).filter((x): x is string => !!x) } }, select: { id: true, startsAt: true } })).map((c) => [c.id, c.startsAt]));
  return ds.flatMap((d) => {
    const c = byId.get(d.contractId);
    if (!c) return [];
    const at = d.callId ? calls.get(d.callId) : null;
    return [{ id: d.id, testId: c.testId, testTitle: c.title, name: displayName(c.tester), reason: d.reason, what: at ? `the call on ${fmtDateTime(at)}` : subs.get(d.submissionId ?? "") === "recording" ? "their recording" : "their written answers" }];
  });
}
