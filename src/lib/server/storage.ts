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

const r2 = () => {
  const e = process.env;
  if (!e.R2_ACCOUNT_ID?.trim() || !e.R2_ACCESS_KEY_ID?.trim() || !e.R2_SECRET_ACCESS_KEY?.trim() || !e.R2_BUCKET?.trim()) return null;
  return { account: e.R2_ACCOUNT_ID.trim(), key: e.R2_ACCESS_KEY_ID.trim(), secret: e.R2_SECRET_ACCESS_KEY.trim(), bucket: e.R2_BUCKET.trim() };
};
export const r2On = () => !!r2();
const uploadDir = () => path.resolve(process.env.UPLOAD_DIR || "uploads");

/** AWS Signature V4 query presign for R2 (region "auto"). */
function presign(method: "GET" | "PUT", key: string, expiresSec = 3600) {
  const c = r2()!;
  const host = `${c.account}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/auto/s3/aws4_request`;
  const pathPart = `/${c.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const q = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${c.key}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSec),
    "X-Amz-SignedHeaders": "host",
  });
  const sorted = [...q.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const canonical = [method, pathPart, sorted, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  const h = (k: Buffer | string, d: string) => createHmac("sha256", k).update(d).digest();
  const signingKey = h(h(h(h(`AWS4${c.secret}`, day), "auto"), "s3"), "aws4_request");
  const sig = createHmac("sha256", signingKey).update(toSign).digest("hex");
  return `https://${host}${pathPart}?${sorted}&X-Amz-Signature=${sig}`;
}

/** Where the browser sends the file: a presigned R2 URL, or this app's local upload route. */
export const uploadTarget = (recordingId: string, key: string) => (r2() ? presign("PUT", key) : `/api/recordings/${recordingId}/upload`);
export const viewUrl = (recordingId: string, key: string) => (r2() ? presign("GET", key) : `/api/recordings/${recordingId}/file`);

/** Local disk only: stream the request body to the file, refusing anything over the limit. */
export async function saveLocal(key: string, body: ReadableStream<Uint8Array> | null, limit: number) {
  if (!body) throw new HttpError(400, "empty", "That file is empty.");
  const file = path.join(uploadDir(), key);
  if (!file.startsWith(uploadDir())) throw new HttpError(400, "bad_key", "Bad file name.");
  await fs.mkdir(path.dirname(file), { recursive: true });
  let size = 0;
  const counted = Readable.fromWeb(body as never).on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > limit) counted.destroy(new HttpError(413, "too_large", "Recordings can be at most 500 MB."));
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
