// (Owner, Oct 30, batch 33 §1) A line the team reads in the admin console and the admin boxes, in pieces: plain text, or a link (a person's profile, a test's
// page, or a Stripe Dashboard page, opened in a new tab). The server builds them (lib/server/adminLinks.ts); AdminRich renders them. Client-safe: no server imports.

// (Owner, Oct 31, batch 35 §43) Or a reason or note someone typed (`q`): shown in the small quoted box (ReasonQuote: italic, quoted, about 4 lines, scrolls).
export type Seg = string | { t: string; href: string; ext?: boolean } | { q: string };
export type Rich = Seg[];

/** (Batch 35 §43) A typed reason or note, for the quoted box. */
export const quoted = (q: string): Seg => ({ q });
/** The line as plain text (the same words, without the links; a reason in its quotes). */
export const plainOf = (r: Rich) => r.map((s) => (typeof s === "string" ? s : "q" in s ? ` “${s.q.trim()}”` : s.t)).join("");
/** Every link in the line, in order. */
export const hrefsOf = (r: Rich) => r.flatMap((s) => (typeof s === "string" || "q" in s ? [] : [s.href]));
