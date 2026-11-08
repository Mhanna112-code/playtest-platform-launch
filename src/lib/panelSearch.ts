export function panelMatches(search: string, query: string, states: string[] = [], ticks: string[] = []) {
 return search.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (!ticks.length || states.some(s=>ticks.includes(s)));
}
