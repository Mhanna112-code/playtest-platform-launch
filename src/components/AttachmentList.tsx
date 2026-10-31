import { fileSize } from "@/lib/format";

/**
 * (Owner, Oct 29, batch 11) The files and recordings sent with a piece, each playable, viewable or downloadable (through the recording file route: only the tester who
 * made it and the test's developer can open it).
 */
export function AttachmentList({ items }: { items: { id: string; filename: string; contentType: string; sizeBytes: number }[] }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-2 text-sm" data-attachments="">
      {items.map((r) => {
        const href = `/api/recordings/${r.id}/file`;
        const size = fileSize(r.sizeBytes);
        return (
          <li key={r.id} className="space-y-1">
            {r.contentType.startsWith("video/") && <video controls preload="metadata" className="max-h-72 w-full rounded bg-black" src={href} />}
            {r.contentType.startsWith("image/") && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={href} alt={r.filename} className="max-h-72 rounded border border-white/10" />
            )}
            <a href={href} target="_blank" rel="noreferrer" download={r.contentType.includes("zip") ? r.filename : undefined}>{r.filename}</a> <span className="text-xs text-slate-500">· {size}</span>
          </li>
        );
      })}
    </ul>
  );
}
