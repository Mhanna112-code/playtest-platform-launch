import { db } from "@/lib/db";
import { displayName, fmtDateTime, money } from "@/lib/format";
import { andList } from "@/lib/rules";
import { logAction } from "./live";

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
    case "no-show": text = `reported a problem with ${await callLine(s(body.callId), false)}`; break;
    case "dispute": text = "opened a dispute"; break;
    case "rate": text = "rated the test"; break;
    default: return;
  }
  await logAction(userId, c.testId, body, text);
}

/** The developer's test-page actions (and the tester's join-page ones on the same route). */
export async function logTestAction(userId: string, testId: string, action: string, body: B, result: unknown) {
  let text = "";
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
      // Listing info (title, description, devices, languages) shows as its own line (F), not twice.
      const names = (r.changed ?? []).filter((n) => !["title", "description", "devices", "languages"].includes(n));
      if (!names.length) return;
      text = `changed the ${andList(names)}`;
      break;
    }
    case "open": text = "opened the test"; break;
    case "stop": text = "stopped the test"; break;
    case "end-early": {
      const ids = Array.isArray(body.contractIds) ? body.contractIds.map(s) : [s(body.contractId)];
      text = `ended ${andList(await Promise.all(ids.map(contractName)))}'s work early`;
      break;
    }
    case "next-round": text = "started a new round"; break;
    case "cancel-call": text = `cancelled ${await callLine(s(body.callId), true)}`; break;
    case "call-length": text = `entered the length of ${await callLine(s(body.callId), true)}`; break;
    case "no-show": text = `reported a problem with ${await callLine(s(body.callId), true)}`; break;
    case "dispute-side": text = "added your side to a dispute"; break;
    case "invite": {
      const ids = (result as { invited?: string[] })?.invited ?? [];
      if (!ids.length) return;
      const people = await db.user.findMany({ where: { id: { in: ids } } });
      text = `invited ${andList(people.map(displayName))}`;
      break;
    }
    case "cancel-invite": text = "cancelled an invite"; break;
    case "request-time": {
      const r = result as { booked?: boolean; message?: string };
      text = r?.booked && r.message ? r.message.replace(/^Booked: you both picked /, "booked a call for ") : "sent a call request";
      break;
    }
    case "answer-request": {
      const { when, name } = await requestLine(s(body.requestId));
      text = body.action === "withdraw" ? `withdrew your call request for ${when}` : `${body.action === "accept" ? "accepted" : "declined"} ${name}'s call request for ${when}`;
      break;
    }
    case "application": {
      const a = await db.application.findUnique({ where: { id: s(body.applicationId) } });
      const who = a ? await db.user.findUnique({ where: { id: a.testerId } }) : null;
      text = `${body.action === "decline" ? "declined" : "accepted"} ${who ? displayName(who) : "a tester"}'s application`;
      break;
    }
    case "join": text = "joined this test"; break;
    case "rate": {
      const c = await db.contract.findUnique({ where: { id: s(body.contractId) }, include: { tester: true } });
      text = `rated ${c ? displayName(c.tester) : "a tester"}`;
      break;
    }
    case "apply": text = (result as { joined?: boolean })?.joined ? "joined this test" : "applied to join this test"; break;
    case "withdraw-application": text = "withdrew your application"; break;
    default: return;
  }
  await logAction(userId, testId, body, text);
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
  await logAction(userId, piece.c.testId, body, text);
}
