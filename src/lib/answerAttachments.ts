/**
 * (Owner's spec, docs/CODEX-TASKS.md Task 3; batch 35 §4) A file placed in a written answer is a short marker in the text: "[📎 map.png #k3f9]" (a recording the
 * same: "[📎 recording-….webm #x81c]"). The tag is the end of the upload's id, long enough to be unique among the contract's uploads (4 characters, more only
 * when another upload's id ends the same), so the marker keeps a stable link to its upload; every renderer and the server resolve it against the contract's uploads.
 * Answers stored with the earlier long form "[[attachment:<id>|map.png]]" still read.
 */
export type AnswerAttachment = { id: string; filename: string; size: number; contentType: string };

/** The shortest tag: the id's last 4 characters, lengthened while another upload's id ends the same. */
export const TAG_MIN = 4;
export function attachmentTag(id: string, others: readonly string[] = []) {
  const rest = others.filter((o) => o !== id);
  for (let n = TAG_MIN; n < id.length; n++) {
    const tag = id.slice(-n);
    if (!rest.some((o) => o.endsWith(tag))) return tag;
  }
  return id;
}

/** The filename as it reads in the marker (no brackets, "#" or line breaks, so the marker stays one piece). */
const markerName = (filename: string) => filename.replace(/[[\]\n\r#]/g, "_").trim() || "file";

/** The marker for an upload with its tag: "[📎 map.png #k3f9]". */
export const tagMarker = (tag: string, filename: string) => `[📎 ${markerName(filename)} #${tag}]`;
/** The marker for an upload, its tag unique among `others` (the contract's other uploads). */
export const attachmentMarker = (id: string, filename: string, others: readonly string[] = []) => tagMarker(attachmentTag(id, others), filename);

/** Either form: (1) the old long form's id and (2) its name; (3) the short form's name and (4) its tag. */
export const markerPattern = /\[\[attachment:([^|\]]+)\|([^\]]+)\]\]|\[📎 ([^\]\n]*?) #([A-Za-z0-9_-]{4,64})\]/g;
export type MarkerRef = { id?: string; tag?: string; name: string };
export const refOf = (m: readonly (string | undefined)[]): MarkerRef => (m[1] ? { id: m[1], name: m[2] ?? "" } : { tag: m[4], name: m[3] ?? "" });

/**
 * The upload a marker stands for: the old form by its id; the short form by the upload whose id ends with its tag. Should two ever end the same, the marker's own
 * filename decides, then the earliest upload (ids are made in time order; a later one got a longer tag).
 */
export function resolveMarker<T extends { id: string; filename?: string }>(ref: MarkerRef, uploads: readonly T[]): T | undefined {
  if (ref.id) return uploads.find((u) => u.id === ref.id);
  const tag = ref.tag ?? "";
  const hits = uploads.filter((u) => u.id.endsWith(tag));
  if (hits.length <= 1) return hits[0];
  const named = hits.filter((u) => u.filename != null && markerName(u.filename) === ref.name);
  return [...(named.length ? named : hits)].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}

/** The ids of the uploads the markers in `text` stand for. */
export function markerIds(text: string, uploads: readonly { id: string; filename?: string }[]) {
  const ids = new Set<string>();
  for (const m of text.matchAll(markerPattern)) {
    const u = resolveMarker(refOf(m), uploads);
    if (u) ids.add(u.id);
  }
  return ids;
}

/** Does `text` (an answer, or a whole draft or set as JSON) hold a marker for upload `id`? `uploads`: the contract's uploads (without them, only `id` itself). */
export const hasMarkerFor = (text: string, id: string, uploads: readonly { id: string; filename?: string }[] = [{ id }]) => markerIds(text, uploads).has(id);

/** Markers don't count toward the 50,000-character limit or the 50-character minimum; nor does an "[Uploading …]" placeholder. */
export function withoutAttachmentMarkers(text: string) { return text.replace(markerPattern, "").replace(/\[Uploading [^\]\n]+… \d+%\]/g, ""); }
/** An excerpt shows "[file]" where a marker was. */
export function excerptWithFiles(text: string) { return text.replace(markerPattern, "[file]"); }
/** Takes out the markers for upload `id` (both forms). `uploads`: the contract's uploads (without them, a short marker whose tag ends `id`). */
export function removeAttachmentMarker(text: string, id: string, uploads: readonly { id: string; filename?: string }[] = [{ id }]) {
  return text.replace(markerPattern, (full: string, ...groups: (string | undefined)[]) => (resolveMarker(refOf([full, ...groups]), uploads)?.id === id ? "" : full));
}

/** (Batch 35 §77) The same set of files (by name and size, each counted): a file removed and uploaded again is no change. */
export function sameFiles(a: { filename: string; sizeBytes: number }[], b: { filename: string; sizeBytes: number }[]) {
  const sig = (xs: { filename: string; sizeBytes: number }[]) => xs.map((x) => `${x.filename}|${x.sizeBytes}`).sort().join("/");
  return a.length === b.length && sig(a) === sig(b);
}
/** (Batch 35 §77) An answer with its markers read by file name only (a re-uploaded file's new tag is no change). */
export const withoutTags = (s: string) => s.replace(markerPattern, (_m, _id, long, short) => `[📎 ${short ?? long}]`);
