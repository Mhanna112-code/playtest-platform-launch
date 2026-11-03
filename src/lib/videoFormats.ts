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
