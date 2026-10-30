/** Marker kept in a plain-text answer; the upload id is stable across renames. */
export const attachmentMarker = (id: string, filename: string) => `[[attachment:${id}|${filename.replace(/[\]\n|]/g, "_")}]]`;
export const markerPattern = /\[\[attachment:([^|\]]+)\|([^\]]+)\]\]/g;
export function withoutAttachmentMarkers(text: string) { return text.replace(markerPattern, "").replace(/\[Uploading [^\]\n]+… \d+%\]/g, ""); }
export function excerptWithFiles(text: string) { return text.replace(markerPattern, "[file]"); }
export function removeAttachmentMarker(text: string, id: string) { return text.replace(markerPattern, (full, found: string) => found === id ? "" : full); }
export type AnswerAttachment = { id: string; filename: string; size: number; contentType: string };
