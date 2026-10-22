"use client";
import { ApiError } from "./client";

/** A tester-side stop-once refusal shown in the box at the TOP of the session page. Returns true when handled. */
export function topStop(e: unknown) {
  if (e instanceof ApiError && e.code === "stop_once" && e.data.top) {
    window.dispatchEvent(new CustomEvent("tester-top", { detail: e.data }));
    window.scrollTo({ top: 0, behavior: "smooth" });
    return true;
  }
  return false;
}
