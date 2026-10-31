"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { newPageLoad } from "@/lib/client";

/** (Owner, Oct 31, batch 35 §51) Every admin page drawn in a tab is its own page load: its presses never count another page's changes as their own. */
export function PageLoad() {
  const path = usePathname();
  useEffect(() => newPageLoad(), [path]);
  return null;
}
