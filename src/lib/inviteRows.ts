// The full app's invite-row text (lib/devices.ts doesntListTag and the rows' grey detail), on lean data.
// (Batch 15 section 35) The pill names 3 items, then "+N more", which opens to show the rest.
export const TAG_NAMES = 3;

/** "Spanish or French"; past 3: "English, Spanish, French +2 more" (the rest open in place on the page). */
export function shortList(names: string[], noun: "language" | "device") {
  void noun;
  if (names.length <= TAG_NAMES) return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  return `${names.slice(0, TAG_NAMES).join(", ")} +${names.length - TAG_NAMES} more`;
}
/** Every item the pill can name (for its "+N more" to open). */
export function doesntListItems(test: { devices: string[]; languages: string[] }, p: { devices: string[]; languages: string[] } | null) {
  const langs = test.languages.length && !test.languages.some((l) => p?.languages.includes(l)) ? test.languages : [];
  const devs = test.devices.length && !test.devices.some((d) => p?.devices.includes(d)) ? test.devices : [];
  return [...langs, ...devs];
}

/** The amber pill: the test's needs the tester doesn't list ("Doesn't list iOS or Android"), or "". */
export function doesntListTag(test: { devices: string[]; languages: string[] }, p: { devices: string[]; languages: string[] } | null) {
  const langs = test.languages.length && !test.languages.some((l) => p?.languages.includes(l)) ? test.languages : [];
  const devs = test.devices.length && !test.devices.some((d) => p?.devices.includes(d)) ? test.devices : [];
  const parts = [langs.length ? shortList(langs, "language") : "", devs.length ? shortList(devs, "device") : ""].filter(Boolean);
  return parts.length ? `Doesn't list ${parts.join(", or ")}` : "";
}

/** The grey detail on the right: "you rated 5.0/5 · 1 test with you" / "not rated by you · 4 tests with you". */
export function withYouText(ratedByYou: number | null, tests: number) {
  return `${ratedByYou == null ? "not rated by you" : `you rated ${ratedByYou.toFixed(1)}/5`} · ${tests} test${tests === 1 ? "" : "s"} with you`;
}
