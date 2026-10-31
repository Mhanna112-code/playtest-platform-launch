/** (Owner, Oct 31, batch 35 §41) A finished press's result line (green), shown in place of its box's inputs until the page has redrawn (`useFinished`). */
export function PressDone({ line }: { line: string }) {
  if (!line) return null;
  return <p className="ok" role="status" data-press-done="">{line}</p>;
}
