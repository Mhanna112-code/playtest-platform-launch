"use client";
import { ApiError } from "./client";
import type { Change } from "@/components/ChangesBox";

export type StopBox = { changes: Change[]; tail: string };

/** A stop-once refusal from the server, for the box under the pressed button (null for anything else). */
export function stopBox(e: unknown): StopBox | null {
  if (e instanceof ApiError && e.code === "stop_once") return { changes: (e.data.changes as Change[]) ?? [], tail: String(e.data.tail ?? "Press again to go ahead.") };
  return null;
}
