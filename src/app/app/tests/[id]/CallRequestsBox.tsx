"use client";
import { CallRequestsPanel, callRequestsAnchor, useClosingRequests, yourRequestsAnchor, type PanelReq } from "@/components/CallRequestsPanel";
import { HoldFold } from "@/components/HoldFold";

/**
 * (Owner, Nov 4, §181) The developer's Call requests: a box of its own on the test page (open at first; it replaces the Live session's Call requests list and each
 * tester's "Waiting" list there). Its content is the draggable panel, holding one drop-down per person (closed; the green name, then "· N requests"), in the order
 * of each person's oldest request; inside, their requests oldest first. Every press is as before (the stop-once box, the clash refusals). A link to a request
 * (`#req-<id>`: the dashboard, the bell, a refusal's link) or to a person's drop-down (Needs you's "2 call requests ↓") opens the box and the drop-down first; a
 * press under way, its stop box or its refusal keeps them open.
 * (Owner, Nov 4, §185) Now TWO boxes, replacing §181's single one: "Requests to you (N)" (the testers' requests waiting for your answer: Accept, an Accept per time
 * for a "one of" request, Decline; panel `call-requests-<testId>`, people `call-requests-person-<contractId>`: Needs you's link lands here) and "Your requests (N)"
 * (your own waiting requests: Withdraw; panel `your-requests-<testId>`, people `your-requests-person-<contractId>`). Each has a name search above its people.
 */
export function CallRequestsBox({ testId, seenAt, requests, leadMinutes }: { testId: string; seenAt: string; requests: PanelReq[]; leadMinutes: number }) {
  // (Owner, Nov 5, §228 fix) Held over both boxes: a request that stops waiting keeps its row, saying what happened, for 6 seconds from any cause (the page drops
  // it at once); a box whose last request closed stays drawn meanwhile (so the page draws this even with none waiting).
  const { shown, closing } = useClosingRequests(requests);
  const toYou = shown.filter((r) => !r.mine), yours = shown.filter((r) => r.mine);
  const box = (kind: "to-you" | "yours", title: string, list: PanelReq[]) => (
    <HoldFold defaultOpen className="card scroll-mt-24" summaryClassName="flex items-center gap-2 font-semibold text-white" bodyClassName="mt-4 min-w-0"
      data={{ "data-call-requests-box": "", [kind === "to-you" ? "data-requests-to-you" : "data-your-requests"]: "", "aria-label": title }}
      summary={<><h2 className="inline">{title}</h2> <span className="text-sm font-normal text-slate-400">(<span data-call-requests-count="">{list.length}</span>)</span></>}>
      <CallRequestsPanel byPerson side="developer" seenAt={seenAt} requests={list} path={() => `/api/tests/${testId}`} leadMinutes={leadMinutes} title={title} search={kind}
        sectionId={kind === "to-you" ? "call-requests" : "your-requests"} anchor={kind === "to-you" ? callRequestsAnchor : yourRequestsAnchor}
        panelId={`${kind === "to-you" ? "call-requests" : "your-requests"}-${testId}`} closing={closing} />
    </HoldFold>
  );
  return (
    <>
      {toYou.length > 0 && box("to-you", "Requests to you", toYou)}
      {yours.length > 0 && box("yours", "Your requests", yours)}
    </>
  );
}
