// (Design doc 11.5) Every limit in one table. Pages and rules read their numbers from here; nothing else spells them out.
export const LIMITS = {
  spots: { min: 1, max: 50 }, // and the developer's own tester limit (10 to start, +10% per 10 good ratings, max 50)
  deadlineDays: { min: 1, max: 90 }, // a tester's deadline; it must also leave `deadlineBufferDays` inside Open until
  deadlineBufferDays: 3,
  openUntilMaxDays: 30, // (Owner, Oct 29, batch 12) required, 3 to 30 days after today on Post; Edit moves it only later, within 30 days of today
  openUntilMinDays: 3,
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
  criticalChanges: 3, // (Owner, Oct 28 afternoon) per field: saves that change the steps (What to do), the NDA, questions, required languages or required devices, each counted from the first join
  contactPerDay: 5, // (Owner, Oct 27) Contact us messages per account per day
} as const;

/**
 * (Owner, Oct 28) The limited test fields: once a tester has joined, each of these fields may be changed by at most 3 Saves: what to do (the steps), the NDA, the questions,
 * the required languages and the required devices / technology. (Owner, Oct 28 afternoon) The limit is PER FIELD: each field has its own 3 changes, and one Save that changes two of
 * them uses one change of each. Part prices, parts and the build link are NOT limited (changing prices or parts still offers working testers Switch / Keep), and access keys stay out
 * of it (a key given to a tester stays theirs). The words are the ones used in messages.
 */
export const CRITICAL_FIELDS = {
  description: "steps",
  ndaText: "NDA", // (Owner, Oct 28) confirmed: the NDA counts
  questions: "questions",
  languages: "languages",
  devices: "devices",
} as const;
export type CriticalField = keyof typeof CRITICAL_FIELDS;
export const CRITICAL_KEYS = Object.keys(CRITICAL_FIELDS) as CriticalField[];
export const isCritical = (f: string): f is CriticalField => f in CRITICAL_FIELDS;
/** "steps, NDA, questions, languages or devices": every limited field. */
export const CRITICAL_WORDS = (() => {
  const names = [...new Set(Object.values(CRITICAL_FIELDS))];
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
})();

/** Each limited field's count of changes since the first join (Test.criticalCounts, a Json object; a missing or bad value counts 0). */
export type CriticalCounts = Record<CriticalField, number>;
export function countsOf(v: unknown): CriticalCounts {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
  return Object.fromEntries(CRITICAL_KEYS.map((k) => [k, n(o[k])])) as CriticalCounts;
}
/** The counts after one Save that changed these fields (each changed field uses one of its own changes). */
export const countsAfter = (counts: CriticalCounts, changed: readonly CriticalField[]): CriticalCounts =>
  Object.fromEntries(CRITICAL_KEYS.map((k) => [k, counts[k] + (changed.includes(k) ? 1 : 0)])) as CriticalCounts;
/** The fields that have used all their changes. */
export const lockedFields = (counts: CriticalCounts) => CRITICAL_KEYS.filter((k) => counts[k] >= LIMITS.criticalChanges);

/** "Changes left: 2 of 3" (one field's count) */
export const changesLeftLine = (used: number) => `Changes left: ${Math.max(0, LIMITS.criticalChanges - used)} of ${LIMITS.criticalChanges}`;

/** (Owner, Oct 28 afternoon) One field's lock: "You've changed the NDA 3 times since testers joined. Contact us in Settings to change it again." */
export function criticalLine(field: CriticalField) {
  return `You've changed the ${CRITICAL_FIELDS[field]} ${LIMITS.criticalChanges} times since testers joined. Contact us in Settings to change it again.`;
}

/** (Owner, Oct 27) Contact us: at most 5 messages per account per day. */
export const CONTACT_LIMIT_PER_DAY = LIMITS.contactPerDay;
export const contactLimitLine = () => `You've sent ${CONTACT_LIMIT_PER_DAY} messages today. We'll reply by email.`;
