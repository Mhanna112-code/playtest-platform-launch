/** (Owner, Nov 5, §273) The search found nobody only because of the ticked filters: "No testers match “mha” with Korean ticked: 1 tester matches without the filters." */
export const filteredOutLine = (term: string, ticks: string[], n: number) =>
  `No testers match “${term}” with ${ticks.join(", ")} ticked: ${n} ${n === 1 ? "tester matches" : "testers match"} without the filters.`;
