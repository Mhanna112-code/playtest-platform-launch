"use client";
import { useEffect, useState } from "react";

/**
 * (Owner, Oct 31, batch 35 §72) A notice shown on the first page view only: once shown, leaving or reloading the page hides it for good on this browser.
 * `id` names this one notice (e.g. the reinstatement and its time), so a later one shows again.
 */
export function OnceNote({ id, className, children }: { id: string; className?: string; children: React.ReactNode }) {
  const key = `pt-once:${id}`;
  const [show, setShow] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(key)) setShow(false);
      else localStorage.setItem(key, "1");
    } catch {
      // storage blocked: it shows each time, as before
    }
  }, [key]);
  if (!show) return null;
  return (
    <p className={className} role="status" data-reinstated-box="">
      {children}
    </p>
  );
}
