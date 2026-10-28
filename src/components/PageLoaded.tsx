"use client";
import { useEffect } from "react";
import { notePageLoaded } from "@/lib/live";

/** (Owner, Oct 28, batch 16 section 38B) Notes when this page first loaded in this tab; a refresh of its data (a new `at`) never moves it. */
export function PageLoaded({ at }: { at: string }) {
  useEffect(() => {
    notePageLoaded(at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
