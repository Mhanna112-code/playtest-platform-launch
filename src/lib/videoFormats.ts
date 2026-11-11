/**
 * (Owner, Nov 3) The video formats a recording can be: the ones that play in the developer's browser (MP4, WebM, MOV, M4V). Other videos (.mkv, .avi, .wmv, .flv,
 * .3gp) usually don't play there, so they are refused with every format named. Shared by the upload boxes and the server.
 */
export const VIDEO_FORMATS: { ext: string; type: string }[] = [
  { ext: ".mp4", type: "video/mp4" },
  { ext: ".webm", type: "video/webm" },
  { ext: ".mov", type: "video/quicktime" },
  { ext: ".m4v", type: "video/x-m4v" },
];
export const VIDEO_ACCEPT = VIDEO_FORMATS.flatMap((f) => [f.ext, f.type]).join(",");
export const VIDEO_FORMATS_LINE = "Choose a video in MP4, WebM, MOV or M4V format (.mp4, .webm, .mov or .m4v).";
export const ATTACH_FORMATS_LINE = "Attach an image (PNG, JPEG, GIF or WebP), a PDF, a text file (.txt), a zip, or a video in MP4, WebM, MOV or M4V format.";

const extOf = (filename: string) => (filename.includes(".") ? filename.slice(filename.lastIndexOf(".")).toLowerCase() : "");
/**
 * The type a picked file is stored as when it's one of the video formats, else null. The file's name decides (a browser may label a video only "video/…" or
 * not at all; a name with no extension goes by its label), and a known label is kept: a screen recording named .webm that Safari made as MP4 stays "video/mp4".
 */
export function videoTypeOf(filename: string, type: string): string | null {
  const known = VIDEO_FORMATS.some((f) => f.type === type);
  const ext = extOf(filename);
  // A name with no extension goes by its label alone.
  if (!ext) return known ? type : null;
  const byExt = VIDEO_FORMATS.find((f) => f.ext === ext);
  if (!byExt) return null;
  return known ? type : byExt.type;
}

/** (Batch 11; batch 31 section 2) What a file attached to a written part can be besides a video: images, PDF, plain text, zip. */
export const ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain", "application/zip", "application/x-zip-compressed"];
/** A recording, and any file attached to a written part: at most 500 MB. */
export const UPLOAD_MAX_BYTES = 500 * 1024 * 1024;

/**
 * (Owner, Nov 11, §380 D2b) An upload's own mistakes, from the file's details alone (name, type, size; never its bytes): the type, an empty file, over 500 MB.
 * The picker marks it red at once and the press still asks the server (with the details only), which answers its refusals first (part over, closed at $0, the
 * limits) and then this same mistake; nothing is uploaded while it remains.
 */
export function uploadMistake(f: { filename: string; contentType: string; size: number; part: "recording" | "written" }): { status: 400 | 413; code: string; message: string } | null {
  const given = f.contentType.split(";")[0].trim().toLowerCase();
  const videoType = videoTypeOf(f.filename, given);
  const type = videoType ?? given;
  const video = !!videoType;
  if (!video && (f.part !== "written" || type.startsWith("video/") || !ATTACHMENT_TYPES.includes(type)))
    return { status: 400, code: "bad_type", message: f.part === "written" && !type.startsWith("video/") ? ATTACH_FORMATS_LINE : VIDEO_FORMATS_LINE };
  if (!Number.isFinite(f.size) || f.size <= 0) return { status: 400, code: "empty", message: "That file is empty." };
  if (f.size > UPLOAD_MAX_BYTES) return { status: 413, code: "too_large", message: video ? "Recordings can be at most 500 MB." : "Files can be at most 500 MB." };
  return null;
}
