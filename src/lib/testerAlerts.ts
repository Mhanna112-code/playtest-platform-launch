/**
 * (Owner, Oct 28, batch 17 section 13) Whether this tester's Alerts is Off, as this tab last heard it: from the server with each stop box (`alertsOff`), from the
 * Alerts button on the session page, and from "Turn off alerts" in a box. The tester's stop box drops "Turn off alerts" and "You can turn these stops off below"
 * while it's Off.
 */
let OFF: boolean | null = null;
export const setTesterAlertsOff = (off: boolean) => {
  OFF = off;
};
export const testerAlertsAreOff = () => OFF === true;
