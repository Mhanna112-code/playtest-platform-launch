import { AsyncLocalStorage } from "node:async_hooks";
import { safeZone } from "@/lib/tz";

const zones = new AsyncLocalStorage<{ timeZone: string }>();
export const withDateZone = <T>(timeZone: string | null | undefined, run: () => T): T => zones.run({ timeZone: safeZone(timeZone) }, run);
export const dateZone = () => zones.getStore()?.timeZone ?? "UTC";
/** Authentication fills only this request's store. Browser zone wins over its saved copy. */
export function setDateZone(timeZone: string | null | undefined) {
  const store = zones.getStore();
  if (store) store.timeZone = safeZone(timeZone);
}
