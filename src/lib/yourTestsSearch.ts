// (Owner, Nov 5, §204) The developer dashboard's "Your tests" search: as you type, case-insensitive, anywhere in the test's name (as its card shows it) or its
// product name, like the Call requests boxes' name search (§185). On this page only (every card is already on it), nothing sent. Pure, so the box and the tests
// share it.

/** The box's label and placeholder. */
export const YOUR_TESTS_SEARCH_LABEL = "Search by test or product";

/** Whether a test card stays: an empty search keeps every test. */
export const yourTestMatches = (t: { title: string; product?: string | null }, query: string) => {
  const q = query.trim().toLowerCase();
  return !q || t.title.toLowerCase().includes(q) || (t.product ?? "").toLowerCase().includes(q);
};

/** No card matches: "No tests match “har”." */
export const noYourTestsLine = (query: string) => `No tests match “${query.trim()}”.`;
