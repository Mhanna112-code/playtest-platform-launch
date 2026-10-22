"use client";

export type Change = { text: string; at: string };

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** The stop-once box: exactly what changed since the page loaded, then "Press again to go ahead." */
export function ChangesBox({ changes, error, tail = "Press again to go ahead." }: { changes: Change[] | null; error?: string; tail?: string }) {
  if (!changes && !error) return null;
  return (
    <div className={changes ? "info" : "rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"} role="status" aria-live="polite">
      {changes && (
        <>
          <p className="font-medium">Since you opened this page:</p>
          <ul className="my-1 list-disc pl-5">
            {changes.map((c, i) => (
              <li key={i}>
                {c.text} · {time(c.at)}
              </li>
            ))}
          </ul>
          <p>{tail}</p>
        </>
      )}
      {error && <p>{error}</p>}
    </div>
  );
}
