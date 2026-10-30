// The full app's invite-row text (lib/devices.ts doesntListTag and the rows' grey detail), on lean data.
// (Owner, Oct 30) Row badges name missing kinds; named lists in confirmation boxes keep their usual wording.
export const TAG_NAMES = 3;

/** "Spanish or French"; past 3: "English, Spanish, French +2 more" (the rest open in place on the page). */
export function shortList(names: string[], noun: "language" | "device") {
  void noun;
  if (names.length <= TAG_NAMES) return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  return `${names.slice(0, TAG_NAMES).join(", ")} +${names.length - TAG_NAMES} more`;
}
/** The requirement kinds for which they list no matching item. */
export function doesntListItems(test: { devices: string[]; languages: string[] }, p: { devices: string[]; languages: string[] } | null) {
  return [...(test.devices.length && !test.devices.some((d) => p?.devices.includes(d)) ? ["devices"] : []), ...(test.languages.length && !test.languages.some((l) => p?.languages.includes(l)) ? ["languages"] : [])];
}

/** The orange badge names only devices and/or languages, or is absent. */
export function doesntListTag(test: { devices: string[]; languages: string[] }, p: { devices: string[]; languages: string[] } | null) {
  const kinds = doesntListItems(test, p);
  return kinds.length ? `Doesn't list ${kinds.join(" or ")}` : "";
}

/** The public rating and the number of distinct tests together. */
export function withYouText(rating: number | null, tests: number, count = 0) {
  return `${rating == null || !count ? "No ratings yet" : `${rating.toFixed(1)} ★ (${count} rating${count === 1 ? "" : "s"})`} · ${tests} test${tests === 1 ? "" : "s"} with you`;
}
