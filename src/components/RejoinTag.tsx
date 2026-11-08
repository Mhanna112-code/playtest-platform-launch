import React from "react";
import type { RejoinLabel } from "@/lib/server/rejoinHistory";

export function RejoinTag({ label }: { label?: RejoinLabel }) {
  return label ? <span className="badge shrink-0 whitespace-nowrap border-orange-400/40 text-orange-200" data-rejoin-history="">{label}</span> : null;
}
