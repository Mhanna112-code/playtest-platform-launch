import { db } from "@/lib/db";
import { displayName, fmtDateTime, money } from "@/lib/format";
import { andList } from "@/lib/rules";
import { rowsOf } from "@/lib/callRows";
import { logAction, type OwnAbout } from "./live";

// What a person did, in their own words, for reason E ("You sent your written answers in another tab"). Logged after the
// action succeeded. Chat messages and the live-call Join are not logged (not stop-once buttons).

type B = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "");

const contractName = async (contractId: string) => {
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { tester: true } });
  return c ? displayName(c.tester) : "a tester";
};

async function callLine(callId: string, withName: boolean) {
  const call = await db.call.findUnique({ where: { id: callId }, include: { contract: { include: { tester: true } } } });
  if (!call) return "a call";
  return `the call ${withName ? `with ${displayName(call.contract.tester)} ` : ""}on ${fmtDateTime(call.startsAt)}`;
}

async function requestLine(requestId: string) {
  const r = await db.callRequest.findUnique({ where: { id: requestId } });
  return r ? { when: fmtDateTime(r.startsAt), name: await contractName(r.contractId) } : { when: "", name: "" };
}


/** Was this part sent before (the send just made replaced it)? */
async function resent(contractId: string, kind: string) {
  const sub = await db.submission.findUnique({ where: { contractId_kind: { contractId, kind } }, select: { sentAt: true, updatedAt: true } });
  return !!sub && sub.updatedAt.getTime() - sub.sentAt.getTime() > 1000;
}

/** The tester's session-page actions. */
export async function logTesterAction(userId: string, contractId: string, action: string, body: B, result: unknown) {
  const c = await db.contract.findUnique({ where: { id: contractId } });
  if (!c) return;
  let text = "";
  switch (action) {
    case "leave": text = "left the test"; break;
    // (Owner, Oct 29, batch 29 section 13) "You sent your updated answers in another tab" (a part sent again replaces the sent one).
    case "written": text = (await resent(contractId, "written")) ? "sent your updated answers" : "sent your written answers"; break;
    case "recording-send": text = (await resent(contractId, "recording")) ? "sent your updated recording" : "sent your recording"; break;
    case "terms": text = body.choice === "switch" ? "switched to the new terms" : "kept your current terms"; break;
    case "choose": {
      // (Batch 29 section 13) "You charged Nora Lane $10.00 for your recording in another tab".
      const what = body.callId ? "live call" : (await db.submission.findUnique({ where: { id: s(body.submissionId) } }))?.kind === "recording" ? "recording" : "written answers";
      const dev = await db.test.findUnique({ where: { id: c.testId }, include: { developer: true } });
      const cents = (result as { amountCents?: number } | null)?.amountCents ?? 0;
      text = body.choice === "letgo" ? `let your ${what} go` : `charged ${dev ? displayName(dev.developer) : "the developer"} ${money(cents)} for your ${what}`;
      break;
    }
    case "request-time": {
      const r = result as { booked?: boolean; message?: string };
      if (r?.booked && r.message) text = r.message.replace(/^Booked: you both picked /, "booked a call for ").replace(/\.$/, "");
      else {
        // (Batch 29 section 13) "You requested a call for Thu, Nov 5, 3:00 PM in another tab".
        const q = await db.callRequest.findFirst({ where: { contractId, fromSide: "tester" }, orderBy: { createdAt: "desc" } });
        text = !q ? "sent a call request" : rowsOf(q).length > 1 ? `requested a call (pick one of ${rowsOf(q).length} times)` : `requested a call for ${fmtDateTime(q.startsAt)}`;
      }
      break;
    }
    case "answer-request": {
      const { when } = await requestLine(s(body.requestId));
      text = `${body.action === "accept" ? "accepted" : body.action === "withdraw" ? "withdrew" : "declined"} ${body.action === "withdraw" ? "your" : "the"} call request for ${when}`;
      break;
    }
    case "cancel-call": text = `cancelled ${await callLine(s(body.callId), false)}`; break;
    case "cancel-set": text = "cancelled the rest of a daily / weekly set of calls"; break;
    case "no-show": text = `reported a problem with ${await callLine(s(body.callId), false)}`; break;
    case "dispute": text = "opened a dispute"; break;
    // (Batch 29 section 13) Rate (and the end of the part it brings) is never a line that stops other presses: it only races with Rate itself ("You already rated …").
    default: return;
  }
  await logAction(userId, c.testId, body, text);
}

/** The developer's test-page actions (and the tester's join-page ones on the same route). (Batch 16 section 21) Each with what it touched (OwnAbout). */
export async function logTestAction(userId: string, testId: string, action: string, body: B, result: unknown) {
  let text = "";
  let about: OwnAbout | undefined;
  const callKeys = async (callId: string) => {
    const call = await db.call.findUnique({ where: { id: callId }, select: { contractId: true, setId: true } });
    return [`call:${callId}`, ...(call ? [`c:${call.contractId}`] : []), ...(call?.setId ? [`set:${call.setId}`] : [])];
  };
  switch (action) {
    case "edit": {
      const r = (result ?? {}) as { changed?: string[]; closedApps?: string[]; resent?: string[]; notReinvited?: string[]; spotClosed?: string[] };
      const closings = [
        ...(r.spotClosed ?? []).map((n) => `closed ${n}'s invite (fewer spots)`),
        ...(r.closedApps ?? []).map((n) => `closed ${n}'s application`),
        ...(r.resent ?? []).map((n) => `re-sent ${n}'s invite`),
        ...(r.notReinvited ?? []).map((n) => `didn't re-invite ${n}`),
      ];
      // (Batch 29 section 12) Any Save is a change that stops the other tabs' presses once.
      // (Batch 35 §34) What the Save closed or re-sent goes with it, each its own line on the other tabs ("You re-sent fbbb's invite (the listing changed)").
      about = { a: "edit", k: ["test"], ...(closings.length ? { x: closings } : {}) };
      // (Owner, Oct 28; batch 29 section 12) One Save, one line, one voice: "You saved the listing in another tab: spots, description". (Batch 30 §10, Oct 29
      // addition) A rename saved with other fields is named here ("title (now “X”)"), and its own "You renamed the test to X" line is dropped (live.ts devChanges).
      // (Owner's finding, Oct 30, batch 34 §8) A save that also closed or re-sent invites names its fields too: "…: description, build link; this re-sent fbbb's invite".
      const title = typeof body.fields === "object" && body.fields ? String((body.fields as Record<string, unknown>).title ?? "").trim() : "";
      const names = (r.changed ?? []).filter((n) => n !== "title");
      if ((r.changed ?? []).includes("title") && title) names.splice(Math.max(0, (r.changed ?? []).indexOf("title")), 0, `title (now “${title}”)`);
      // A rename alone stays its own info-only line (it never stops a press).
      if (!(r.changed ?? []).some((n) => n !== "title") && !closings.length) return;
      text = names.length
        ? `You saved the listing in another tab: ${names.join(", ")}${closings.length ? `; this ${andList(closings)}` : ""}`
        : `You changed the listing in another tab: ${andList(closings)}`;
      break;
    }
    case "open": text = "opened the test"; about = { a: "open", k: ["test"] }; break;
    case "stop": text = "stopped the test"; about = { a: "stop", k: ["test"] }; break;
    case "end-early": {
      const ids = Array.isArray(body.contractIds) ? body.contractIds.map(s) : [s(body.contractId)];
      // (Batch 16 section 21) Only the testers it actually ended (one already ended elsewhere was dropped from the press).
      const ended = (result as { endedIds?: string[] })?.endedIds ?? ids;
      text = `ended ${andList(await Promise.all(ended.map(contractName)))}'s work early`;
      about = { a: "end-early", k: ended.map((id) => `c:${id}`) };
      break;
    }
    case "next-round": text = "started the next round"; about = { a: "next-round", k: ["test"] }; break;
    case "cancel-call": text = `cancelled ${await callLine(s(body.callId), true)}`; about = { a: "cancel-call", k: await callKeys(s(body.callId)) }; break;
    case "cancel-set": text = `cancelled the rest of a daily / weekly set of calls with ${await contractName(s(body.contractId))}`; about = { a: "cancel-set", k: [`set:${s(body.setId)}`, `c:${s(body.contractId)}`] }; break;
    case "no-show": text = `reported a problem with ${await callLine(s(body.callId), true)}`; about = { a: "no-show", k: await callKeys(s(body.callId)) }; break;
    case "dispute-side": text = "added your side to a dispute"; about = { a: "dispute-side", k: [`dispute:${s(body.disputeId)}`] }; break;
    case "pay-extra": {
      // (Batch 20 section 12) Waiting for the bank's check: nothing is paid yet (it's logged when the bank confirms: logPayMore). A repeat isn't news.
      const r = (result ?? {}) as { amountCents?: number; requiresAction?: boolean; repeated?: boolean };
      if (r.requiresAction || r.repeated) return;
      const piece = body.callId ? `call:${s(body.callId)}` : `sub:${s(body.submissionId)}`;
      const sub = body.callId ? null : await db.submission.findUnique({ where: { id: s(body.submissionId) }, select: { kind: true } });
      const label = body.callId ? "live call" : sub?.kind === "recording" ? "recording" : "written answers";
      // (Batch 20 section 12) "You paid Ana Silva $5.00 more for their written answers in another tab": it stops every press on the test page once (BIG_OWN_ACTS).
      text = `paid ${await contractName(s(body.contractId))} ${money(r.amountCents ?? 0)} more for their ${label}`;
      about = { a: "pay-more", k: [piece, `c:${s(body.contractId)}`] };
      break;
    }
    case "invite": {
      const ids = (result as { invited?: string[] })?.invited ?? [];
      if (!ids.length) return;
      const people = await db.user.findMany({ where: { id: { in: ids } } });
      text = `invited ${andList(people.map(displayName))}`;
      about = { a: "invite", k: ids.map((id) => `t:${id}`) };
      break;
    }
    case "cancel-invite": {
      const inv = await db.invite.findUnique({ where: { id: s(body.inviteId) } });
      const who = inv ? await db.user.findUnique({ where: { id: inv.testerId } }) : null;
      text = `cancelled ${who ? `${displayName(who)}'s` : "an"} invite`;
      about = { a: "cancel-invite", k: inv ? [`t:${inv.testerId}`] : [] };
      break;
    }
    case "request-time": {
      const r = result as { booked?: boolean; message?: string; batchId?: string };
      const ids = Array.isArray(body.contractIds) ? body.contractIds.map(s) : body.contractId ? [s(body.contractId)] : [];
      if (r?.booked && r.message) {
        // (Batch 29 section 12) "You booked a call with Ana Silva for Thu, Nov 5, 3:00 PM in another tab".
        const names = await Promise.all(ids.map(contractName));
        text = r.message.replace(/^Booked: you both picked /, names.length ? `booked a call with ${andList(names)} for ` : "booked a call for ").replace(/\.$/, "");
      } else {
        // (Batch 16 section 21) "requested a call with Ben Okafor for Nov 3, 3:00 PM" (the live box: "You requested … in another tab").
        const reqs = r?.batchId ? await db.callRequest.findMany({ where: { batchId: r.batchId } }) : [];
        const names = await Promise.all((reqs.length ? reqs.map((x) => x.contractId) : ids).map(contractName));
        text = reqs.length ? `requested a call with ${andList(names)} for ${fmtDateTime(reqs[0].startsAt)}` : "sent a call request";
      }
      about = { a: "request-time", k: ids.map((id) => `c:${id}`) };
      break;
    }
    case "answer-request": {
      const { when, name } = await requestLine(s(body.requestId));
      text = body.action === "withdraw" ? `withdrew your call request for ${when}` : `${body.action === "accept" ? "accepted" : "declined"} ${name}'s call request for ${when}`;
      about = { a: "answer-request", k: [`req:${s(body.requestId)}`, `c:${s(body.contractId)}`] };
      break;
    }
    case "application": {
      const a = await db.application.findUnique({ where: { id: s(body.applicationId) } });
      const who = a ? await db.user.findUnique({ where: { id: a.testerId } }) : null;
      text = `${body.action === "decline" ? "declined" : "accepted"} ${who ? displayName(who) : "a tester"}'s application`;
      about = { a: "application", k: [`app:${s(body.applicationId)}`] };
      break;
    }
    case "join": text = "joined this test"; break;
    case "rate": {
      const c = await db.contract.findUnique({ where: { id: s(body.contractId) }, include: { tester: true } });
      text = `rated ${c ? displayName(c.tester) : "a tester"}`;
      about = { a: "rate", k: [`c:${s(body.contractId)}`] };
      break;
    }
    // (Batch 29 section 13) The tester's join-page presses: "You applied to join in another tab".
    case "apply": text = (result as { joined?: boolean })?.joined ? "joined this test" : "applied to join"; break;
    case "rejoin-ask": text = "asked to rejoin"; break;
    case "withdraw-application": text = "withdrew your application"; break;
    default: return;
  }
  await logAction(userId, testId, body, text, about);
}

/** (Batch 20 section 12) A Pay more the bank confirmed afterwards: logged then, as the press would have been. */
export async function logPayMore(userId: string, body: B, p: { contractId: string | null; submissionId: string | null; callId: string | null; amountCents: number }) {
  if (!p.contractId) return;
  const c = await db.contract.findUnique({ where: { id: p.contractId }, select: { testId: true } });
  if (c) await logTestAction(userId, c.testId, "pay-extra", { ...body, contractId: p.contractId, ...(p.callId ? { callId: p.callId } : { submissionId: p.submissionId ?? "" }) }, { amountCents: p.amountCents });
}

/** Pay / Reject on a piece of work or a call. */
export async function logReview(userId: string, body: B, result: { amountCents?: number; rejected?: boolean; repeated?: boolean }) {
  if (result.repeated) return;
  const id = s(body.id);
  const piece = body.kind === "call"
    ? await db.call.findUnique({ where: { id }, include: { contract: { include: { tester: true } } } }).then((x) => x && { c: x.contract, label: "live call" })
    : await db.submission.findUnique({ where: { id }, include: { contract: { include: { tester: true } } } }).then((x) => x && { c: x.contract, label: x.kind === "recording" ? "recording" : "written answers" });
  if (!piece) return;
  const name = displayName(piece.c.tester);
  const text = result.rejected ? `rejected ${name}'s ${piece.label}` : `paid ${name} ${money(result.amountCents ?? 0)} for the ${piece.label}`;
  // (Batch 16 section 21) It touches this piece (another Pay on it stops once) and this tester (an End early that includes them stops once).
  await logAction(userId, piece.c.testId, body, text, { a: "pay", k: [`${body.kind === "call" ? "call" : "sub"}:${id}`, `c:${piece.c.id}`] });
}
