import { createHash, createHmac } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HttpError } from "./http";

// Recordings: Cloudflare R2 (S3 API, presigned URLs, the browser uploads straight to R2) when the four R2_* variables
// are set; otherwise saved on local disk under UPLOAD_DIR (default ./uploads) through the app, for development.

export const MAX_RECORDING_BYTES = 500 * 1024 * 1024;
export const MAX_RECORDINGS = 5;
/** (Owner, Oct 29, batch 11) Files attached to a written part: at most 5, 25 MB each (images, PDF, plain text, zip). Recordings attached to it count as recordings. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;
export const ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain", "application/zip", "application/x-zip-compressed"];
export const isVideo = (contentType: string) => contentType.startsWith("video/");

const r2 = () => {
  const e = process.env;
  if (!e.R2_ACCOUNT_ID?.trim() || !e.R2_ACCESS_KEY_ID?.trim() || !e.R2_SECRET_ACCESS_KEY?.trim() || !e.R2_BUCKET?.trim()) return null;
  return { account: e.R2_ACCOUNT_ID.trim(), key: e.R2_ACCESS_KEY_ID.trim(), secret: e.R2_SECRET_ACCESS_KEY.trim(), bucket: e.R2_BUCKET.trim() };
};
export const r2On = () => !!r2();
const uploadDir = () => path.resolve(process.env.UPLOAD_DIR || "uploads");

/**
 * AWS Signature V4 query presign for R2 (region "auto"). (Batch 15 section 6) `contentLength`: a PUT signs `content-length` as a signed header, so R2 refuses a body of
 * any other size (the browser sets that header from the file it sends).
 */
export function presign(method: "GET" | "PUT" | "HEAD" | "DELETE", key: string, expiresSec = 3600, contentLength?: number) {
  const c = r2()!;
  const host = `${c.account}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/auto/s3/aws4_request`;
  const pathPart = `/${c.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const headers: [string, string][] = contentLength != null ? [["content-length", String(contentLength)], ["host", host]] : [["host", host]];
  const signedHeaders = headers.map(([k]) => k).join(";");
  const q = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${c.key}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSec),
    "X-Amz-SignedHeaders": signedHeaders,
  });
  const sorted = [...q.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const canonical = [method, pathPart, sorted, headers.map(([k, v]) => `${k}:${v}\n`).join(""), signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  const h = (k: Buffer | string, d: string) => createHmac("sha256", k).update(d).digest();
  const signingKey = h(h(h(h(`AWS4${c.secret}`, day), "auto"), "s3"), "aws4_request");
  const sig = createHmac("sha256", signingKey).update(toSign).digest("hex");
  return `https://${host}${pathPart}?${sorted}&X-Amz-Signature=${sig}`;
}

/** Where the browser sends the file: a presigned R2 URL (signed for exactly `size` bytes), or this app's local upload route. */
export const uploadTarget = (recordingId: string, key: string, size?: number) => (r2() ? presign("PUT", key, 3600, size) : `/api/recordings/${recordingId}/upload`);
export const viewUrl = (recordingId: string, key: string) => (r2() ? presign("GET", key) : `/api/recordings/${recordingId}/file`);

/** (Batch 15 section 6) The stored object's real size on R2 (a HEAD request), or null when it isn't there. */
export async function headObject(key: string): Promise<{ size: number } | null> {
  const r = await fetch(presign("HEAD", key, 300), { method: "HEAD" });
  if (r.status === 404) return null;
  if (!r.ok) throw new HttpError(502, "storage", "The file storage didn't answer. Try again.");
  return { size: Number(r.headers.get("content-length") ?? "NaN") };
}
/** Delete an object from R2 (a missing one is fine). */
export async function deleteObject(key: string) {
  const r = await fetch(presign("DELETE", key, 300), { method: "DELETE" });
  if (!r.ok && r.status !== 404) console.error("[storage] delete failed:", r.status);
}

/** Local disk only: stream the request body to the file, refusing anything over the limit. */
export async function saveLocal(key: string, body: ReadableStream<Uint8Array> | null, limit: number, tooLarge = "Recordings can be at most 500 MB.") {
  if (!body) throw new HttpError(400, "empty", "That file is empty.");
  const file = path.join(uploadDir(), key);
  if (!file.startsWith(uploadDir())) throw new HttpError(400, "bad_key", "Bad file name.");
  await fs.mkdir(path.dirname(file), { recursive: true });
  let size = 0;
  const counted = Readable.fromWeb(body as never).on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > limit) counted.destroy(new HttpError(413, "too_large", tooLarge));
  });
  try {
    await pipeline(counted, createWriteStream(file));
  } catch (e) {
    await fs.rm(file, { force: true });
    throw e instanceof HttpError ? e : new HttpError(400, "upload_failed", "The upload stopped. Try again.");
  }
  return size;
}

export async function readLocal(key: string) {
  const file = path.join(uploadDir(), key);
  const stat = await fs.stat(file);
  return { stream: Readable.toWeb(createReadStream(file)) as ReadableStream, size: stat.size };
}
