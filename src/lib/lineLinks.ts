// (Owner, Nov 5, §270) Green, clickable names and tests in every line. The server sends, with each line, the people and tests it names as
// `links: { text, href, kind }[]`; the client turns those exact substrings into green links (components/LineLinks.tsx). No JSX here: the server builds
// the lists with the same code the client draws them with.

export type LineLinkKind = "person" | "test";
/** (Owner, Nov 5, §270) A person or test named in a line: the name as the line writes it, and where it opens (a profile; the test page, a session page or the public page). */
export type LineLink = { text: string; href: string; kind: LineLinkKind };

/** (§270) "You" / "your" is never a link (a name that is only that word is left out). */
const YOU = /^(you|your|yours|you're)$/i;

/**
 * (Owner, Nov 5, §270) A person's link: their profile (a tester's /app/testers/<id>, a developer's /app/developers/<id>). Null: a deleted account (its name stays
 * plain text), the reader themselves ("You" is never a link), or a name too short to find safely.
 */
export function personLink(u: { id: string; name: string; deleted?: boolean }, as: "tester" | "developer", viewerId?: string | null): LineLink | null {
  const text = u.name.trim();
  if (u.deleted || !text || text.length < 2 || YOU.test(text) || (viewerId && u.id === viewerId)) return null;
  return { text, href: as === "developer" ? `/app/developers/${u.id}` : `/app/testers/${u.id}`, kind: "person" };
}

/**
 * (Owner, Nov 5, §270) A test's link, as the reader opens it: the developer's test page; a tester's session page for it (when they have one), else the test's
 * public page.
 */
export function testLink(t: { id: string; title: string }, viewer: { developer?: boolean; sessionId?: string | null } = {}): LineLink | null {
  const text = t.title.trim();
  if (!text) return null;
  const href = viewer.developer ? `/app/tests/${t.id}` : viewer.sessionId ? `/app/sessions/${viewer.sessionId}` : `/app/find/${t.id}`;
  return { text, href, kind: "test" };
}

const isWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}@_]/u.test(ch);
/** A match at `i` of `len` characters stands on its own (never inside a word or an email: "ana@…", "Anabela" for "Ana"). */
const standsAlone = (text: string, i: number, len: number) => !isWord(text[i - 1]) && !(isWord(text[i + len]) && isWord(text[i + len - 1])) && !(text[i + len] === "@") && !(text[i + len] === "." && isWord(text[i + len + 1]));

/**
 * (Owner, Nov 5, §270) The links a line needs: the pool's people and tests that the line names (whole, standing alone), each once. `prefer`: links listed first
 * win a name two of them share (the line's own test's people). "You" is never in the pool, so it never links.
 */
export function linksIn(text: string, pool: (LineLink | null | undefined)[], prefer: (LineLink | null | undefined)[] = []): LineLink[] {
  // Each name once (the preferred list wins a name), longest first: a name inside a longer one ("Ana" in "Ana Silva") isn't counted there.
  const byText = new Map<string, LineLink>();
  for (const l of [...prefer, ...pool]) if (l && l.text && !byText.has(l.text)) byText.set(l.text, l);
  const taken: [number, number][] = [];
  const found: { at: number; l: LineLink }[] = [];
  for (const l of [...byText.values()].sort((a, b) => b.text.length - a.text.length)) {
    let first = -1;
    for (let at = text.indexOf(l.text); at >= 0; at = text.indexOf(l.text, at + 1)) {
      const end = at + l.text.length;
      if (!standsAlone(text, at, l.text.length) || taken.some(([s, e]) => at < e && end > s)) continue;
      taken.push([at, end]);
      if (first < 0) first = at;
    }
    if (first >= 0) found.push({ at: first, l });
  }
  // A name an older cut ended with "…" (a bell written before §270: “excerptexcer…”, "Alexandra…"): its visible start, as splitLinks draws it.
  const left = [...byText.values()].filter((l) => !found.some((f) => f.l === l));
  for (let k = text.indexOf("…"); k >= 0 && left.length; k = text.indexOf("…", k + 1)) {
    const hit = cutHead(text, k, left);
    if (hit && !taken.some(([s, e]) => hit.s < e && k > s)) {
      found.push({ at: hit.s, l: hit.l });
      left.splice(left.indexOf(hit.l), 1);
    }
  }
  // In the order the line names them.
  return found.sort((a, b) => a.at - b.at).map((x) => x.l);
}

/** (§270) The longest start of a name ending right before the "…" at `k` (beginning a word, at least 2 characters), or null. */
function cutHead(text: string, k: number, links: LineLink[], free: (s: number, e: number) => boolean = () => true): { s: number; e: number; l: LineLink } | null {
  const longest = Math.max(0, ...links.map((l) => l.text.length));
  for (let s = Math.max(0, k - longest); s < k; s++) {
    if (isWord(text[s - 1]) || !isWord(text[s])) continue;
    const head = text.slice(s, k).trimEnd();
    if (Array.from(head).length < 2) continue;
    const l = links.find((x) => x.text.length > head.length && x.text.startsWith(head));
    if (l && free(s, s + head.length)) return { s, e: s + head.length, l };
  }
  return null;
}

/** (§270) One piece of a drawn line: plain words, or a name or test that is its own link. */
export type LinePiece = { t: string; link?: LineLink };

/**
 * (Owner, Nov 5, §270) A line cut into its pieces: each person or test it names, longest name first, wherever it stands whole; and a name the 50 cut (or a name's own
 * cut) ended with "…" ("on “Harbor…", "Alexandra…"): the visible start of the name stays its link (the "…" itself is not part of it). The rest is plain words.
 */
export function splitLinks(text: string, links: LineLink[] | undefined | null): LinePiece[] {
  if (!links?.length || !text) return [{ t: text }];
  const sorted = [...links].filter((l) => l.text).sort((a, b) => b.text.length - a.text.length);
  // Taken ranges [start, end) and their link.
  const taken: { s: number; e: number; link: LineLink }[] = [];
  const free = (s: number, e: number) => taken.every((r) => e <= r.s || s >= r.e);
  for (const l of sorted) {
    let at = text.indexOf(l.text);
    while (at >= 0) {
      if (standsAlone(text, at, l.text.length) && free(at, at + l.text.length)) taken.push({ s: at, e: at + l.text.length, link: l });
      at = text.indexOf(l.text, at + l.text.length);
    }
  }
  // A cut name: the words right before each "…" that a name starts with (the longest such start, beginning a word).
  for (let k = text.indexOf("…"); k >= 0; k = text.indexOf("…", k + 1)) {
    const hit = cutHead(text, k, sorted, free);
    if (hit) taken.push({ s: hit.s, e: hit.e, link: hit.l });
  }
  if (!taken.length) return [{ t: text }];
  taken.sort((a, b) => a.s - b.s);
  const out: LinePiece[] = [];
  let last = 0;
  for (const r of taken) {
    if (r.s > last) out.push({ t: text.slice(last, r.s) });
    out.push({ t: text.slice(r.s, r.e), link: r.link });
    last = r.e;
  }
  if (last < text.length) out.push({ t: text.slice(last) });
  return out;
}

/** (§270) A line's links merged with more (by name, the first kept): e.g. a stop box's lines arriving with their own lists. */
export function mergeLinks(...lists: (LineLink[] | undefined | null)[]): LineLink[] {
  const seen = new Set<string>();
  const out: LineLink[] = [];
  for (const l of lists.flat()) if (l && !seen.has(l.text)) { seen.add(l.text); out.push(l); }
  return out;
}
