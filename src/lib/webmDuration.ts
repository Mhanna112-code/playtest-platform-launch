/**
 * (Owner, Oct 31, batch 35 §42) Recordings can be scrubbed. A WebM made in the browser (MediaRecorder, ScreenRecorder) is written live, so its header has no
 * Duration: the player shows no length and dragging the time bar snaps back. Before the upload, `withDuration` writes the recording's length into the file's
 * Segment Info (the EBML Duration element), which is all the player needs to seek (the file route answers byte ranges, §42).
 *
 * Only the first bytes of the file change (the EBML header, the Segment's size, its Info), so `webmWithDuration` patches the head of the Blob and keeps the rest
 * as it is (no copy of a 500 MB recording). Anything it doesn't recognise (not a WebM, a SeekHead whose positions would move, a size it can't read) is left
 * exactly as it was.
 */

const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const SEEK_HEAD = 0x114d9b74;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
/** How much of the file's start is read to find its Info (MediaRecorder writes it within the first few hundred bytes). */
export const HEAD_BYTES = 64 * 1024;

type Vint = { value: number; length: number; unknown: boolean };

/** An element ID at `pos` (its marker bits kept, as IDs are written). */
function readId(b: Uint8Array, pos: number): Vint | null {
  const first = b[pos];
  if (first === undefined || first === 0) return null;
  const length = first >= 0x80 ? 1 : first >= 0x40 ? 2 : first >= 0x20 ? 3 : first >= 0x10 ? 4 : 0;
  if (!length || pos + length > b.length) return null;
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + b[pos + i];
  return { value, length, unknown: false };
}

/** An element size at `pos` (1 to 8 bytes; all ones means "unknown", as a live recording writes its Segment). */
function readSize(b: Uint8Array, pos: number): Vint | null {
  const first = b[pos];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || pos + length > b.length) return null;
  let value = first & (0xff >> length);
  let ones = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + b[pos + i];
    if (b[pos + i] !== 0xff) ones = false;
  }
  return { value, length, unknown: ones };
}

/** A size written in `length` bytes (null when it doesn't fit: all ones is reserved for "unknown"). */
export function encodeSize(value: number, length: number): Uint8Array | null {
  if (length < 1 || length > 8 || value < 0 || !Number.isSafeInteger(value) || value >= 2 ** (7 * length) - 1) return null;
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] |= 0x80 >> (length - 1);
  return out;
}

/** The size in its old length when it still fits, else in 8 bytes. */
const resize = (value: number, length: number) => encodeSize(value, length) ?? encodeSize(value, 8)!;

const readUint = (b: Uint8Array, pos: number, n: number) => {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + b[pos + i];
  return v;
};

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** The Duration element (8-byte float, in the file's timecode units). */
function durationElement(units: number) {
  const out = new Uint8Array(11);
  out.set([0x44, 0x89, 0x88]);
  new DataView(out.buffer).setFloat64(3, units);
  return out;
}

/** The Duration a file's head says, in ms (null: none, or not a WebM it can read). */
export function webmDurationMs(head: Uint8Array): number | null {
  const info = findInfo(head);
  if (!info || info.duration == null) return null;
  return (info.duration * info.scale) / 1e6;
}

type InfoAt = { segment: { at: number; size: Vint }; info: { at: number; id: Vint; size: Vint; dataAt: number }; scale: number; duration: number | null; durationAt: { at: number; n: number } | null };

function findInfo(b: Uint8Array): InfoAt | null {
  const ebml = readId(b, 0);
  if (!ebml || ebml.value !== EBML) return null;
  const ebmlSize = readSize(b, ebml.length);
  if (!ebmlSize || ebmlSize.unknown) return null;
  let pos = ebml.length + ebmlSize.length + ebmlSize.value;
  const seg = readId(b, pos);
  if (!seg || seg.value !== SEGMENT) return null;
  const segSize = readSize(b, pos + seg.length);
  if (!segSize) return null;
  const segment = { at: pos + seg.length, size: segSize };
  pos += seg.length + segSize.length;
  while (pos < b.length) {
    const id = readId(b, pos);
    const size = id && readSize(b, pos + id.length);
    if (!id || !size) return null;
    // A SeekHead points at positions inside the Segment: a longer Info would move them, so such a file is left alone.
    if (id.value === SEEK_HEAD) return null;
    const dataAt = pos + id.length + size.length;
    if (id.value === INFO) {
      if (size.unknown || dataAt + size.value > b.length) return null;
      let scale = 1_000_000;
      let duration: number | null = null;
      let durationAt: InfoAt["durationAt"] = null;
      let p = dataAt;
      while (p < dataAt + size.value) {
        const cid = readId(b, p);
        const csize = cid && readSize(b, p + cid.length);
        if (!cid || !csize || csize.unknown) return null;
        const at = p + cid.length + csize.length;
        if (at + csize.value > dataAt + size.value) return null;
        if (cid.value === TIMECODE_SCALE && csize.value >= 1 && csize.value <= 8) scale = readUint(b, at, csize.value) || 1_000_000;
        if (cid.value === DURATION && (csize.value === 4 || csize.value === 8)) {
          const view = new DataView(b.buffer, b.byteOffset + at, csize.value);
          duration = csize.value === 8 ? view.getFloat64(0) : view.getFloat32(0);
          durationAt = { at, n: csize.value };
        }
        p = at + csize.value;
      }
      return { segment, info: { at: pos, id, size, dataAt }, scale, duration, durationAt };
    }
    if (size.unknown) return null;
    pos = dataAt + size.value;
  }
  return null;
}

/**
 * The file's head with its Duration set to `durationMs` (ms), or null when it can't be done safely (then the file goes as it is). A Duration that's already there
 * and above 0 is kept.
 */
export function withDuration(head: Uint8Array, durationMs: number): Uint8Array | null {
  if (!(durationMs > 0) || !Number.isFinite(durationMs)) return null;
  const found = findInfo(head);
  if (!found) return null;
  if (found.duration != null && found.duration > 0) return head;
  const units = (durationMs * 1e6) / found.scale;
  if (found.durationAt) {
    // A Duration of 0: written over in place.
    const out = head.slice();
    const view = new DataView(out.buffer, found.durationAt.at, found.durationAt.n);
    if (found.durationAt.n === 8) view.setFloat64(0, units);
    else view.setFloat32(0, units);
    return out;
  }
  const { segment, info } = found;
  const add = durationElement(units);
  const infoEnd = info.dataAt + info.size.value;
  const infoSize = resize(info.size.value + add.length, info.size.length);
  const grown = add.length + (infoSize.length - info.size.length);
  const segSize = segment.size.unknown ? head.subarray(segment.at, segment.at + segment.size.length) : resize(segment.size.value + grown, segment.size.length);
  return concat([
    head.subarray(0, segment.at),
    segSize,
    head.subarray(segment.at + segment.size.length, info.at + info.id.length),
    infoSize,
    head.subarray(info.dataAt, infoEnd),
    add,
    head.subarray(infoEnd),
  ]);
}

/** A recorded WebM Blob with its Duration written (the head patched, the rest kept as it is); the Blob as it was when that can't be done. */
export async function webmWithDuration(blob: Blob, durationMs: number): Promise<Blob> {
  try {
    const headBlob = blob.slice(0, HEAD_BYTES);
    const head = new Uint8Array(await headBlob.arrayBuffer());
    const patched = withDuration(head, durationMs);
    if (!patched || patched === head) return blob;
    return new Blob([patched as BlobPart, blob.slice(head.length)], { type: blob.type });
  } catch {
    return blob;
  }
}
