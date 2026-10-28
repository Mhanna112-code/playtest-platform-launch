/** (Owner, Oct 29, batch 13 section 9) An NDA, wherever it's shown: a scroll box about 12 lines tall, never in full. */
export function NdaBox({ text, label }: { text: string; label?: string }) {
  return (
    <div className="space-y-1" data-nda-box="">
      {label && <p className="text-xs font-medium text-slate-400">{label}</p>}
      <div className="max-h-[15rem] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-ink-950/60 p-3 text-sm leading-5 text-slate-300" tabIndex={0}>{text || "None"}</div>
    </div>
  );
}
