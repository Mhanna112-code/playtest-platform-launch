"use client";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Err } from "@/components/Err";
import { api, errOf } from "@/lib/client";

/**
 * (Owner, Oct 28, batch 17 §18) A "Tests visited" card with its small "Remove" (×): the card goes at once, no confirm (the list then reloads). Opening the test's
 * join page again brings it back.
 */
export function VisitedCard({ testId, title, children }: { testId: string; title: string; children: ReactNode }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [gone, setGone] = useState(false);
  if (gone) return null;
  const remove = async () => {
    setErr("");
    setGone(true);
    try {
      await api(`/api/visits/${testId}`, {});
      router.refresh();
    } catch (e) {
      setGone(false);
      setErr(errOf(e));
    }
  };
  return (
    <li className="card card-hover relative flex flex-wrap items-center gap-3 p-4" data-visited={testId}>
      {children}
      <span className="relative z-10 inline-flex flex-col items-end gap-1">
        <button type="button" className="btn-ghost inline-flex items-center gap-1 px-2 py-1 text-xs" onClick={() => void remove()} aria-label={`Remove “${title}” from Tests visited`} data-remove-visit={testId}>
          <X className="h-3.5 w-3.5" /> Remove
        </button>
        <Err text={err} />
      </span>
    </li>
  );
}
