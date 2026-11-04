"use client";
import { CallRequestsPanel, type PanelReq } from "@/components/CallRequestsPanel";
import { HoldFold } from "@/components/HoldFold";

/**
 * (Owner, Nov 4, §181) The developer's Call requests: a box of its own on the test page (open at first; it replaces the Live session's Call requests list and each
 * tester's "Waiting" list there). Its content is the draggable panel (`call-requests-<testId>`, as before), holding one drop-down per person (closed; the green
 * name, then "· N requests"), in the order of each person's oldest request; inside, their requests oldest first, both kinds together: theirs to answer (Accept,
 * an Accept per time for "one of" requests, Decline) and the ones waiting on them, yours included ("asked by you", Withdraw). Every press is as before (the
 * stop-once box, the clash refusals). A link to a request (`#req-<id>`: the dashboard, the bell, a refusal's link) or to a person's drop-down (Needs you's
 * "2 call requests ↓") opens the box and the drop-down first; a press under way, its stop box or its refusal keeps them open.
 */
export function CallRequestsBox({ testId, seenAt, requests, leadMinutes }: { testId: string; seenAt: string; requests: PanelReq[]; leadMinutes: number }) {
  return (
    <HoldFold defaultOpen className="card scroll-mt-24" summaryClassName="flex items-center gap-2 font-semibold text-white" bodyClassName="mt-4 min-w-0"
      data={{ "data-call-requests-box": "", "aria-label": "Call requests" }}
      summary={<><h2 className="inline">Call requests</h2> <span className="text-sm font-normal text-slate-400" data-call-requests-count="">{requests.length}</span></>}>
      <CallRequestsPanel byPerson side="developer" seenAt={seenAt} requests={requests} path={() => `/api/tests/${testId}`} leadMinutes={leadMinutes} panelId={`call-requests-${testId}`} />
    </HoldFold>
  );
}
