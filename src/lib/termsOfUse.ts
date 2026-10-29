// (Owner, Oct 28 evening, batch 18 section 1) The Terms of Use version each account accepted is stored (User.termsVersion; at sign-up, and when they agree again).
// TERMS_VERSION is bumped whenever the Terms change. An account on an older version is asked once, at its next Post a test / post a draft (developer) or Join,
// Apply, Accept an invite, Ask to rejoin (tester): a box under the button with a link to what changed and a tick. Nothing else is blocked.

/** The current Terms of Use version. Bump it (and add a WHAT_CHANGED entry) whenever the Terms change. */
export const TERMS_VERSION = 2;
/** The anchor of the "What changed" note at the top of the Terms page. */
export const WHAT_CHANGED_ID = "what-changed";
export const TERMS_CHANGED_HREF = `/terms#${WHAT_CHANGED_ID}`;
/** The box's line (and the server's refusal of an unticked press). "Read what changed" links to the note. */
export const TERMS_UPDATED_LINE = "We updated our Terms of Use. Read what changed.";
export const TERMS_AGREE_LABEL = "I agree to the updated Terms";
/** The refusal's code: the page shows the box with the tick under the pressed button. */
export const TERMS_UPDATED_CODE = "terms_updated";

/** The short "What changed" note at the top of the Terms page: the newest version first. */
export const WHAT_CHANGED: { version: number; date: string; points: string[] }[] = [
  {
    version: 2,
    date: "Oct 28, 2026",
    points: [
      "The content rule (section 6) now reads: “Never allowed: sexual content involving minors, illegal content, real-world gore. Other graphic or mature content must be marked Mature (18+), with a reason.”",
      "A live call ends when its pay would pass what's left of the $1,000 for that tester's calls on the test; minutes after that don't count (section 4).",
      "Every call uses its own Jitsi video room, opened from the call page; keep the call page open, it measures the call (section 8).",
      "When these terms change, you're asked to agree to the new version the next time you post a test, or join, apply, accept an invite or ask to rejoin (section 9).",
    ],
  },
];

/** Whether this account still has to agree to the current Terms. */
export const needsTermsAgain = (u: { termsVersion: number }) => u.termsVersion < TERMS_VERSION;
