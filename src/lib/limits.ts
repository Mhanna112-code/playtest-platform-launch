// (Design doc 11.5) Every limit in one table. Pages and rules read their numbers from here; nothing else spells them out.
export const LIMITS = {
  spots: { min: 1, max: 50 }, // and the developer's own tester limit (10 to start, +10% per 10 good ratings, max 50)
  deadlineDays: { min: 1, max: 90 }, // a tester's deadline; it must also leave `deadlineBufferDays` inside Open until
  deadlineBufferDays: 3,
  openUntilMaxDays: 366, // future, at most a year ahead, extend only
  productName: 60,
  testName: 60,
  whatToDo: 1000,
  matureWhy: 500,
  nda: 20_000,
  categoriesMin: 1,
  questions: { min: 1, max: 20 },
  partMinCents: 100, // $1.00, or free
  rateMinCents: 1000, // $10.00 an hour, or free
  chargeMinCents: 50, // $0.50
  chargeMaxCents: 99_999_999, // $999,999.99 (Stripe's per-charge maximum)
  callMinutes: { min: 10, max: 180 },
  callLogPercent: 150,
  callRequestRows: 3,
  callRepeats: { min: 2, max: 8 },
  callsBookedPerTester: 3,
  callsWaitingPerTester: 3,
  testsPerTester: 10,
  recordingBytes: 500 * 1024 * 1024,
  recordingsPerSession: 5,
  ratingComment: 500,
  disputeText: 2000,
  bio: 1000,
  contact: { min: 10, max: 3000 },
  criticalChanges: 3, // (Owner, Oct 27) saves that change part prices, parts, questions, steps (What to do), the build link or the NDA, counted from the first join
  contactPerDay: 5, // (Owner, Oct 27) Contact us messages per account per day
} as const;

/**
 * (Owner, Oct 27) The significant test fields: once a tester has joined, Saves that change part prices, parts, questions, steps (What to do), the build link or the NDA
 * are limited to 3 (one Save counts once, however many of these fields it touches). The words are the ones used in messages.
 */
export const CRITICAL_FIELDS = {
  description: "steps",
  buildUrl: "build link",
  ndaText: "NDA", // (DEFAULT, pending the owner: the NDA counts; flip it by removing this line)
  writtenCents: "part prices",
  recordingCents: "part prices",
  liveRateCents: "part prices",
  liveMinutes: "parts",
  writtenRequired: "parts",
  recordingRequired: "parts",
  liveRequired: "parts",
  questions: "questions",
} as const;
export type CriticalField = keyof typeof CRITICAL_FIELDS;
export const isCritical = (f: string): f is CriticalField => f in CRITICAL_FIELDS;

/** "Changes left: 2 of 3" */
export const changesLeftLine = (used: number) => `Changes left: ${Math.max(0, LIMITS.criticalChanges - used)} of ${LIMITS.criticalChanges}`;

/** "You've changed the steps, build link or part prices 3 times since testers joined. Contact us to change them again." */
export function criticalLine(fields: string[], used: number = LIMITS.criticalChanges) {
  const names = [...new Set(fields.map((f) => (isCritical(f) ? CRITICAL_FIELDS[f] : f)))];
  const list = names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  return `You've changed the ${list} ${used} times since testers joined. Contact us in Settings to change them again.`;
}

/** (Owner, Oct 27) Contact us: at most 5 messages per account per day. */
export const CONTACT_LIMIT_PER_DAY = LIMITS.contactPerDay;
export const contactLimitLine = () => `You've sent ${CONTACT_LIMIT_PER_DAY} messages today. We'll reply by email.`;
