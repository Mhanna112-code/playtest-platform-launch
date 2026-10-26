"use client";
import { useState } from "react";
import { api, errOf } from "@/lib/client";

/** (Design doc 10) "Preview a suspension's effects": what suspending this account would do right now. */
export function PreviewButton({ id }: { id: string }) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [err, setErr] = useState("");
  return (
    <span className="inline-flex flex-col gap-1">
      <button className="btn-ghost" onClick={() => api<{ lines: string[] }>("/api/admin/preview-suspension", { id }).then((r) => { setErr(""); setLines(r.lines); }).catch((e) => setErr(errOf(e)))}>Preview suspension</button>
      {lines && <span className="note" data-preview="">{lines.join(" ")}</span>}
      {err && <span className="err">{err}</span>}
    </span>
  );
}
