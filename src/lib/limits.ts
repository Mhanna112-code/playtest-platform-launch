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
  criticalChanges: 3, // saves that change instructions, link, languages, technology, parts or Open until, counted from the first join
} as const;

/** The test fields that count towards the critical-change limit (the doc's fields 3, 4, 6, 7, 8 and 12), with the words used in messages. */
export const CRITICAL_FIELDS = {
  description: "instructions",
  buildUrl: "link",
  languages: "language requirements",
  devices: "technology requirements",
  writtenCents: "parts",
  recordingCents: "parts",
  liveRateCents: "parts",
  liveMinutes: "parts",
  writtenRequired: "parts",
  recordingRequired: "parts",
  liveRequired: "parts",
  questions: "questions",
  openUntil: "Open until",
} as const;
export type CriticalField = keyof typeof CRITICAL_FIELDS;
export const isCritical = (f: string): f is CriticalField => f in CRITICAL_FIELDS;

/** "You've changed the instructions, link or parts 3 times since testers joined. Contact support to change them again." */
export function criticalLine(fields: string[], used: number = LIMITS.criticalChanges) {
  const names = [...new Set(fields.map((f) => (isCritical(f) ? CRITICAL_FIELDS[f] : f)))];
  const list = names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  return `You've changed the ${list} ${used} times since testers joined. Contact support to change them again.`;
}
