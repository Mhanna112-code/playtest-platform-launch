/** Suspended testers retain read/dispute access to their own sessions, regardless of how participation ended. */
export function limitedTesterSession(viewer: {id:string;testerSuspendedAt:Date|null}, contract: {testerId:string}) {
 return !!viewer.testerSuspendedAt && contract.testerId === viewer.id;
}
