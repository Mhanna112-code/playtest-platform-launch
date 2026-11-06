/**
 * (Owner, Nov 6, §305) Testing only: NEXT_PUBLIC_TESTING_NO_LIMITS=1 in a LOCAL .env lifts the 3-changes-per-field limit after testers join and the call
 * request limits (3 calls or waiting requests per tester, 3 requests a day per person), so the owner can test freely on the dev site. Never on Vercel: the
 * deploy sets VERCEL=1, and the switch is ignored there (the browser bundle never sees VERCEL, so a stray public var there could only change the page's own
 * hints, never what the server allows).
 */
export const TESTING_NO_LIMITS = process.env.NEXT_PUBLIC_TESTING_NO_LIMITS === "1" && process.env.VERCEL !== "1";
/** The limit, or a number no test reaches while the testing switch is on. */
export const limitOr = (n: number) => (TESTING_NO_LIMITS ? 999 : n);
