import { mergeLinks, type LineLink } from "./lineLinks";

// (Owner, Nov 5, §270) The links the server sent with this page's refusals, stop boxes and bank notices (the people and tests their lines name, for this reader).
// A line the page draws from a reply's text alone (a refusal kept on screen, a bank notice's line) finds its green links here.

let KNOWN: LineLink[] = [];
/** (§270) Keep these links for the lines drawn from this page's replies (the newest list wins a name). */
export function rememberLinks(...lists: (LineLink[] | undefined | null)[]) {
  const fresh = lists.flat().filter((l): l is LineLink => !!l && typeof l.text === "string" && typeof l.href === "string" && (l.kind === "person" || l.kind === "test"));
  if (fresh.length) KNOWN = mergeLinks(fresh, KNOWN).slice(0, 500);
}
/** (§270) Every link a reply carried: its own (`links`), its stop lines' and its Pay what you owe lines'. */
export function rememberReply(data: unknown) {
  if (!data || typeof data !== "object") return;
  const d = data as { links?: LineLink[]; changes?: unknown; lines?: unknown };
  const of = (xs: unknown) => (Array.isArray(xs) ? xs.flatMap((x) => (x && typeof x === "object" && Array.isArray((x as { links?: unknown }).links) ? (x as { links: LineLink[] }).links : [])) : []);
  rememberLinks(Array.isArray(d.links) ? d.links : [], of(d.changes), of(d.lines));
}
/** (§270) The links known on this page. */
export const knownLinks = () => KNOWN;
/** (§270) Tests: a fresh page. */
export const forgetLinks = () => {
  KNOWN = [];
};
