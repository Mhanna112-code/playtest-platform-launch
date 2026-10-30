// (Owner, Oct 30, batch 33 §1) A line the team reads in the admin console and the admin boxes, in pieces: plain text, or a link (a person's profile, a test's
// page, or a Stripe Dashboard page, opened in a new tab). The server builds them (lib/server/adminLinks.ts); AdminRich renders them. Client-safe: no server imports.

export type Seg = string | { t: string; href: string; ext?: boolean };
export type Rich = Seg[];

/** The line as plain text (the same words, without the links). */
export const plainOf = (r: Rich) => r.map((s) => (typeof s === "string" ? s : s.t)).join("");
/** Every link in the line, in order. */
export const hrefsOf = (r: Rich) => r.flatMap((s) => (typeof s === "string" ? [] : [s.href]));
