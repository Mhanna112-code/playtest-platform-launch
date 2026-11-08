export const PREVIOUS_TEST_FILTERS = ["Removed From", "Closed", "Left"];
export const DEV_TEST_FILTERS = ["Stopped by admin", "Stopped by you", "Paused", "Open"];
export function previousTestGroup(c: {status:string;endKind:string;test:{status:string;workEndedAt:Date|null}}): string|null {
 if(c.endKind === "early" || c.endKind === "suspended" || c.endKind === "removed" || c.endKind === "blocked") return "Removed From";
 if(c.status === "left") return "Left";
 if(c.status !== "working" || c.test.status === "stopped" || c.test.status === "closed" || c.test.workEndedAt) return "Closed";
 return null;
}
export function developerTestGroups(t:{status:string;adminStoppedAt:Date|null},paused:boolean,closed:boolean) {
 return [...(t.status==="stopped"?[t.adminStoppedAt?"Stopped by admin":"Stopped by you"]:[]),...(paused?["Paused"]:[]),...(t.status!=="draft"&&!closed?["Open"]:[])];
}
