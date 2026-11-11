"use client";
import { api } from "@/lib/client";
import { uploadMistake, videoTypeOf } from "@/lib/videoFormats";

/** (Owner, Nov 11, §380 D2b) The picked file's own mistake (type, empty, over 500 MB), the server's line; "" when there is none. The picker marks it red. */
export const fileMistake = (file: Blob, filename: string, part: "recording" | "written") => uploadMistake({ filename, contentType: file.type, size: file.size, part })?.message ?? "";

/**
 * Upload one file to a session through the recording upload (start -> PUT to storage -> done). (Owner, Oct 29, batch 11) `part: "written"` attaches it to the written
 * part (a file, or a screen recording); otherwise it is a recording for the Recording part. The server checks the type, the size and the counts.
 */
export async function uploadToSession(sessionId: string, file: Blob, filename: string, part: "recording" | "written", onProgress?: (pct: number) => void): Promise<{ id: string; tag: string }> {
  // (Owner, Nov 3) A video's type comes from its name when the browser gives none (the server checks the same way); nothing is guessed as MP4 any more.
  const given = file.type.split(";")[0];
  const contentType = videoTypeOf(filename, given) ?? (given || "application/octet-stream");
  // (Batch 35 §4) `tag`: the short tag of a written answer's marker ("[📎 map.png #k3f9]"), unique among the contract's uploads.
  // (Owner, Nov 11, §380 D2b) Asked even with a mistake in the file (only its details go, never its bytes): the server answers its refusals first, then the
  // same mistake. Nothing is uploaded while one remains (a server that let it through anyway is answered with the mistake, and its row dropped).
  const mistake = fileMistake(file, filename, part);
  const { recordingId, tag, uploadUrl } = await api<{ recordingId: string; tag: string; uploadUrl: string }>(`/api/sessions/${sessionId}/recording-start`, { filename, size: file.size, contentType, part });
  if (mistake) {
    await api(`/api/sessions/${sessionId}/recording-abandon`, { recordingId }).catch(() => null);
    throw new Error(mistake);
  }
  // (Owner, Nov 5) While the file goes up, the page says so every 20 s (an unfinished upload holds Send only while it does); leaving the page mid-upload
  // drops it at once, so a reload or a closed tab never leaves Send refused.
  const alive = setInterval(() => void fetch(`/api/sessions/${sessionId}/recording-alive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recordingId }) }).catch(() => null), 20_000);
  const leave = () => void fetch(`/api/sessions/${sessionId}/recording-abandon`, { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ recordingId }) }).catch(() => null);
  window.addEventListener("pagehide", leave);
  try {
    await put(uploadUrl, file, contentType, onProgress);
    window.removeEventListener("pagehide", leave);
    await api(`/api/sessions/${sessionId}/recording-done`, { recordingId });
  } catch (e) {
    // (Batch 31 section 2) A failed upload leaves nothing behind: its row and any partial file go, so pressing again starts clean (best effort; the daily clean-up
    // catches the rest).
    await api(`/api/sessions/${sessionId}/recording-abandon`, { recordingId }).catch(() => null);
    throw e;
  } finally {
    clearInterval(alive);
    window.removeEventListener("pagehide", leave);
  }
  return { id: recordingId, tag };
}

/** The PUT to storage (R2's presigned URL, or the local upload route), reporting its percentage. */
function put(uploadUrl: string, file: Blob, contentType: string, onProgress?: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
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
    x.onabort = () => reject(new Error("The upload stopped. Try again."));
    x.send(file);
  });
}
