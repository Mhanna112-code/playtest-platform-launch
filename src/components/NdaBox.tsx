import { NDA_BOX_MAX, ValueText } from "@/components/QA";

/**
 * (Owner, Oct 29, batch 13 section 9) An NDA, wherever it's shown: a scroll box, never in full. (Owner, Nov 5, batch 35 §231) The shared box for contract and
 * listing texts (ValueText: drags taller, its own scroll inside any panel), about 12rem at first. `id`: unique on the page; `label`: "Before" / "Offered".
 */
export function NdaBox({ id, text, label }: { id: string; text: string; label?: string }) {
  return (
    <div className="space-y-1" data-nda-box="">
      {label && <p className="text-xs font-medium text-slate-400">{label}</p>}
      <ValueText id={id} label={label ? `NDA: ${label}` : "NDA"} defaultMax={NDA_BOX_MAX}>{text || "None"}</ValueText>
    </div>
  );
}
