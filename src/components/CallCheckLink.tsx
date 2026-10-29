/**
 * (Owner, Oct 28, batch 18 section 13) "Check your call setup": the account's private Jitsi practice room, in a new tab, from the moment a call is booked. It never counts
 * as a call and is never measured; Join for the real call still opens 10 minutes before the start.
 */
import { CALL_CHECK_LINE, CALL_CHECK_LABEL } from "@/lib/rules";

export function CallCheckLink({ url, className = "" }: { url: string; className?: string }) {
  if (!url) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-2 text-xs ${className}`} data-call-check="">
      <a href={url} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">{CALL_CHECK_LABEL}</a>
      <span className="text-slate-400">{CALL_CHECK_LINE}</span>
    </span>
  );
}
