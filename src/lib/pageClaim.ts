/**
 * (Owner, Nov 11, §380) One page at a time, across devices. A developer's test page and its Edit page are ONE page per test ("test:<id>"); a tester's session page
 * is one page per session ("session:<contract id>"). Opening the page claims it; any older copy (another tab, browser or device) disables its buttons and goes to
 * the dashboard, where this line says why. A press from an older copy is refused with the same line.
 * (Owner, Nov 11, §380 J) The new copy first asks whether the copy holding the page has a press on its way: if so it shows HANDOVER_LINE with "Open now" and waits
 * (at most HANDOVER_CAP_MS) while the old copy finishes its press, keeps its unsent drafts and hands the page over.
 * (Owner, Nov 11, §380 K) Also one at a time: the tester's join page (per test: "join:<test id>"), Payments, Blocked people, Contact us, each settings page on its
 * own ("page:<name>"), and profile pages, the person's own and each other person's ("tester:<id>", "developer:<id>"; the own profile editor is "page:profile").
 */
export const PAGE_MOVED_CODE = "page_moved";
export const PAGE_MOVED_LINE = "This page was opened somewhere else.";
/** The dashboard's address after a copy lost its claim (the dashboard shows PAGE_MOVED_LINE). */
export const PAGE_MOVED_PATH = "/app?moved=1";
/** (§380 J) What the new copy shows while the old one finishes its press. */
export const HANDOVER_LINE = "Saving changes in other tab…";
export const HANDOVER_OPEN_NOW = "Open now";
/** (§380 J) The longest a new copy waits for the old one (closed or asleep: it takes over then). */
export const HANDOVER_CAP_MS = 10_000;
/** (§380 J) A "press on its way" mark older than this is from a copy that's gone (closed mid-press): never waited for. */
export const BUSY_STALE_MS = 25_000;

export const testScope = (testId: string) => `test:${testId}`;
export const sessionScope = (contractId: string) => `session:${contractId}`;
/** (§380 K) The tester's join page for one test. */
export const joinScope = (testId: string) => `join:${testId}`;
/** (§380 K) The person's own pages, each one its own page. */
export const OWN_PAGES = ["payments", "blocked", "contact", "profile", "notifications"] as const;
export type OwnPage = (typeof OWN_PAGES)[number];
export const ownPageScope = (name: OwnPage) => `page:${name}`;
/** (§380 K) A person's public profile page (their tester or developer profile), whoever looks at it (the person themselves included). */
export const profileScope = (side: "tester" | "developer", userId: string) => `${side}:${userId}`;
/** A scope this app claims ("test:<id>", "session:<id>", "join:<id>", "page:<name>", "tester:<id>", "developer:<id>"; ids are cuids). */
export const isScope = (v: unknown): v is string => typeof v === "string" && /^(test|session|join|page|tester|developer):[A-Za-z0-9_-]{1,80}$/.test(v);
