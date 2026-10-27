"use client";
import { api } from "@/lib/client";

/**
 * Upload one file to a session through the recording upload (start -> PUT to storage -> done). (Owner, Oct 29, batch 11) `part: "written"` attaches it to the written
 * part (a file, or a screen recording); otherwise it is a recording for the Recording part. The server checks the type, the size and the counts.
 */
export async function uploadToSession(sessionId: string, file: Blob, filename: string, part: "recording" | "written", onProgress?: (pct: number) => void) {
  const contentType = (file.type || (part === "recording" ? "video/mp4" : "application/octet-stream")).split(";")[0];
  const { recordingId, uploadUrl } = await api<{ recordingId: string; uploadUrl: string }>(`/api/sessions/${sessionId}/recording-start`, { filename, size: file.size, contentType, part });
  await new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", uploadUrl);
    x.setRequestHeader("content-type", contentType);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    x.onload = () => {
      if (x.status < 300) return resolve();
      let msg = "The upload didn't finish. Try again.";
      try { msg = JSON.parse(x.responseText)?.error?.message || msg; } catch { /* not JSON (storage) */ }
      reject(new Error(msg));
    };
    x.onerror = () => reject(new Error("The upload stopped. Check your connection and try again."));
    x.send(file);
  });
  await api(`/api/sessions/${sessionId}/recording-done`, { recordingId });
  return recordingId;
}
