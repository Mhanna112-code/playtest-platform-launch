import { db } from "@/lib/db";
import { displayName, fmtDateTime, money } from "@/lib/format";
import { andList } from "@/lib/rules";
import { logAction, type OwnAbout } from "./live";

// What a person did, in their own words, for reason E ("You also did this in another tab: ..."). Logged after the
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


/** The tester's session-page actions. */
export async function logTesterAction(userId: string, contractId: string, action: string, body: B, result: unknown) {
  const c = await db.contract.findUnique({ where: { id: contractId } });
  if (!c) return;
  let text = "";
  switch (action) {
    case "leave": text = "left the test"; break;
    case "written": text = "sent your written answers"; break;
    case "recording-send": text = "sent your recording"; break;
    case "terms": text = body.choice === "switch" ? "switched to the new terms" : "kept your current terms"; break;
    case "choose": {
      const sub = await db.submission.findUnique({ where: { id: s(body.submissionId) } });
      const what = sub?.kind === "recording" ? "recording" : "written answers";
      text = body.choice === "letgo" ? `let your ${what} go` : `charged for your ${what}`;
      break;
    }
    case "request-time": {
      const r = result as { booked?: boolean; message?: string };
      text = r?.booked && r.message ? r.message.replace(/^Booked: you both picked /, "booked a call for ") : "sent a call request";
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
    case "rate": text = "rated the test"; break;
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
      if (closings.length) {
        text = `You changed the listing in another tab: ${andList(closings)}`;
        break;
      }
      // (Owner, Oct 28) One Save, one line, one voice: "You changed the description and access keys in another tab". (A rename stays its own info-only line.)
      const names = (r.changed ?? []).filter((n) => n !== "title");
      if (!names.length) return;
      text = `You changed the ${andList(names)} in another tab`;
      about = { a: "edit", k: ["test"] };
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
    case "next-round": text = "started a new round"; about = { a: "next-round", k: ["test"] }; break;
    case "cancel-call": text = `cancelled ${await callLine(s(body.callId), true)}`; about = { a: "cancel-call", k: await callKeys(s(body.callId)) }; break;
    case "cancel-set": text = `cancelled the rest of a daily / weekly set of calls with ${await contractName(s(body.contractId))}`; about = { a: "cancel-set", k: [`set:${s(body.setId)}`, `c:${s(body.contractId)}`] }; break;
    case "no-show": text = `reported a problem with ${await callLine(s(body.callId), true)}`; about = { a: "no-show", k: await callKeys(s(body.callId)) }; break;
    case "dispute-side": text = "added your side to a dispute"; about = { a: "dispute-side", k: [`dispute:${s(body.disputeId)}`] }; break;
    case "pay-extra": {
      const r = (result ?? {}) as { amountCents?: number };
      const piece = body.callId ? `call:${s(body.callId)}` : `sub:${s(body.submissionId)}`;
      const sub = body.callId ? null : await db.submission.findUnique({ where: { id: s(body.submissionId) }, select: { kind: true } });
      const label = body.callId ? "live call" : sub?.kind === "recording" ? "recording" : "written answers";
      text = `paid ${await contractName(s(body.contractId))} ${money(r.amountCents ?? 0)} more for the ${label}`;
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
      if (r?.booked && r.message) text = r.message.replace(/^Booked: you both picked /, "booked a call for ");
      else {
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
    case "apply": text = (result as { joined?: boolean })?.joined ? "joined this test" : "applied to join this test"; break;
    case "withdraw-application": text = "withdrew your application"; break;
    default: return;
  }
  await logAction(userId, testId, body, text, about);
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
