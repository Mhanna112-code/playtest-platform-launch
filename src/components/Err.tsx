import { FIELD } from "@/lib/client";

/** Red for a form mistake (fix the field and press again); blue for a refusal. */
export function Err({ text }: { text: string }) {
  if (!text) return null;
  const red = text.startsWith(FIELD);
  return <p className={red ? "err-field" : "err"}>{red ? text.slice(1) : text}</p>;
}
