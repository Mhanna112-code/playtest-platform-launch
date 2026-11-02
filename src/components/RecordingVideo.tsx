"use client";
import { createElement, useRef } from "react";

type Player = { duration: number; currentTime: number; dataset: Record<string, string | undefined> };

/**
 * (Nov 2 fixes B, §119) What the player does with its length. A recording with a stored length (batch 35 §42) reports it at once. One made before Oct 31 was
 * uploaded without it, so the browser reports Infinity and the time bar snaps back when dragged: then the player asks for a time far past the end, which makes
 * the browser read the file's last part (the file route answers byte ranges) and learn the real duration; once it has it, the player goes back to the start.
 */
export function lengthFinder(finding: { current: boolean }, onLength?: (seconds: number) => void) {
  return {
    loaded(v: Player) {
      if (Number.isFinite(v.duration)) return onLength?.(v.duration);
      finding.current = true; // no stored length: find it
      v.dataset.lengthFound = "";
      v.currentTime = 1e101;
    },
    durationChanged(v: Player) {
      if (!finding.current || !Number.isFinite(v.duration)) return;
      finding.current = false;
      v.currentTime = 0;
      v.dataset.lengthFound = String(v.duration);
      onLength?.(v.duration);
    },
  };
}

/** A recording's player whose time bar can always be dragged, old recordings included (lengthFinder). */
export function RecordingVideo({ src, className, onLength }: { src: string; className?: string; /** the length in seconds, once known */ onLength?: (seconds: number) => void }) {
  const finding = useRef(false);
  const f = lengthFinder(finding, onLength);
  // createElement (no JSX): the player also renders inside server-rendered answers, where tests render it without React in scope.
  return createElement("video", { controls: true, preload: "metadata", className, src, "data-recording-video": "", onLoadedMetadata: (e: React.SyntheticEvent<HTMLVideoElement>) => f.loaded(e.currentTarget), onDurationChange: (e: React.SyntheticEvent<HTMLVideoElement>) => f.durationChanged(e.currentTarget) });
}
