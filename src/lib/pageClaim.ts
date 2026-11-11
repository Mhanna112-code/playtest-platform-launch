/**
 * (Owner, Nov 11, §380) One page at a time, across devices. A developer's test page and its Edit page are ONE page per test ("test:<id>"); a tester's session page
 * is one page per session ("session:<contract id>"). Opening the page claims it (the newest copy always wins, no waiting); any older copy (another tab, browser
 * or device) disables its buttons and goes to the dashboard, where this line says why. A press from an older copy is refused with the same line.
 */
export const PAGE_MOVED_CODE = "page_moved";
export const PAGE_MOVED_LINE = "This page was opened somewhere else.";
/** The dashboard's address after a copy lost its claim (the dashboard shows PAGE_MOVED_LINE). */
export const PAGE_MOVED_PATH = "/app?moved=1";

export const testScope = (testId: string) => `test:${testId}`;
export const sessionScope = (contractId: string) => `session:${contractId}`;
/** A scope this app claims: "test:<id>" or "session:<id>" (ids are cuids). */
export const isScope = (v: unknown): v is string => typeof v === "string" && /^(test|session):[A-Za-z0-9_-]{1,80}$/.test(v);
