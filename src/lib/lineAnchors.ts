// (Owner, Nov 6, §284) Every top-box line about something with a place on the page opens it (jumps and marks, as other row links do), ignored (greyed)
// lines too. The places are the rows' own ids, the same on the server (which sets each line's `link`) and the client (which jumps to it). No JSX here.
import { NDA_NOTICE } from "./ndaNotice";

/** (§284) The tester's Requests section on the session page (the Live session's "Requests": both of her Call requests panels, or "No call requests waiting."). */
export const TESTER_REQUESTS_BOX = "requests";
/** (§284) Where a request's line goes once its row has left (withdrawn, taken, closed): the Call requests box of the page, else the Live session. */
export const REQUEST_BOXES = [TESTER_REQUESTS_BOX, "call-requests", "your-requests", "live"] as const;
/** (§284; §268's pill target) The tester's new-terms box (Switch / Keep). */
export const TERMS_OFFER_BOX = "terms-offer";
/** (§284; §267) The NDA line in the tester's contract card. */
export const NDA_INFO = "info-nda";
/** (Owner, Nov 6, §302) The NDA notice with its Acknowledge button on the session page (the NDA line once it's acknowledged). */
export const NDA_NOTICE_BOX = NDA_NOTICE;

/** (§284) A call request's row (both sides' Call requests boxes). */
export const requestRow = (id: string) => `req-${id}`;
/** (§284) A call's row (the tester's Live session; the developer's tester row and Calls panel). */
export const callRow = (id: string) => `call-${id}`;
/** (§284) A tester's row in the developer's Testers list (left testers keep theirs). */
export const testerRow = (contractId: string) => `tester-${contractId}`;
/** (§284) An application's row in the developer's Needs you. */
export const appRow = (id: string) => `item-app-${id}`;
/** (§284) The tester's session page: a part ("part-written", "part-recording"), or a call's own row. */
export const testerPartRow = (p: { kind?: string | null; callId?: string | null }) => (p.callId ? callRow(p.callId) : p.kind === "recording" ? "part-recording" : "part-written");
/** (§284) The developer's test page: a sent part's line on its tester's row ("part-<submission>"), or a call's row. "" when neither. */
export const devPartRow = (p: { submissionId?: string | null; callId?: string | null }) => (p.submissionId ? `part-${p.submissionId}` : p.callId ? callRow(p.callId) : "");

/** (Owner, Nov 9, §356) A disputed part's payments in the developer's Testers list (where a decided dispute shows under Payments). */
export const disputePart = (disputeId: string) => `dispute-part-${disputeId}`;
const DISPUTE_ROW = "item-dispute-";

/**
 * (§284) Where a line's link lands, first found wins: a request's row while it is still shown, otherwise the Call requests box; the new-terms box once the offer
 * is decided: the contract card; (§302) the NDA notice once acknowledged: the NDA line.
 */
// (§356) "{tester} disputed …" (bell and email, old lines too): Needs you's dispute row while it is open there; once decided, that tester's part.
export const lineFallbacks = (id: string): string[] => (id.startsWith(DISPUTE_ROW) ? [id, disputePart(id.slice(DISPUTE_ROW.length))] : id.startsWith("req-") ? [id, ...REQUEST_BOXES] : id === TERMS_OFFER_BOX ? [id, "scope"] : id === NDA_NOTICE_BOX ? [id, NDA_INFO] : [id]);

/**
 * (§284) A person's own action in another tab ("You withdrew a call request for … in another tab"): the place it touched, from what the log kept (`k`: "req:<id>",
 * "call:<id>", "sub:<id>", "app:<id>", "dispute:<id>", "c:<contract>"). `sub`: that side's part row; `contract`: the developer's tester row (none for a tester).
 */
export function ownLink(k: readonly string[] | undefined, sub: (id: string) => string, contract?: (id: string) => string) {
  const v = (p: string) => k?.find((x) => x.startsWith(p))?.slice(p.length);
  const req = v("req:"), call = v("call:"), s = v("sub:"), app = v("app:"), dispute = v("dispute:"), c = v("c:");
  return req ? requestRow(req) : call ? callRow(call) : s ? sub(s) : app ? appRow(app) : dispute ? `item-dispute-${dispute}` : c && contract ? contract(c) : "";
}
