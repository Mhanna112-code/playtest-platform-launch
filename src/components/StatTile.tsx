import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

// The full app's stat tile (src/components/ui.tsx there): an icon in a tinted square, the label, the value, a hint.
const TONES = {
  indigo: "from-indigo-500/20 text-indigo-300",
  emerald: "from-emerald-500/20 text-emerald-300",
  amber: "from-amber-500/20 text-amber-300",
  fuchsia: "from-fuchsia-500/20 text-fuchsia-300",
} as const;

export function StatTile({ icon: Icon, label, value, hint, tone = "indigo" }: { icon: LucideIcon; label: string; value: ReactNode; hint?: string; tone?: keyof typeof TONES }) {
  return (
    <div className="card flex items-start gap-3 p-4">
      <div className={`rounded-xl bg-gradient-to-br to-transparent p-2.5 ${TONES[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-xl font-semibold text-white">{value}</p>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}
