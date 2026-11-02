/** Server-only display helpers. UTC storage and calendar arithmetic stay unchanged. */
export * from "@/lib/format";
import { renderTimes } from "@/lib/tz";
import { fmtDateIn, fmtDateTimeIn, fmtTimeIn } from "@/lib/format";
import { dateZone } from "./dateZone";
export const fmtDate = (d: Date | string) => fmtDateIn(d, dateZone());
export const fmtDateTime = (d: Date | string) => fmtDateTimeIn(d, dateZone());
export const fmtTime = (d: Date | string) => fmtTimeIn(d, dateZone());

/** Localize time tokens in a view model, preserving Dates and non-text values. */
export function renderDateText<T>(value: T): T {
  if (typeof value === "string") return renderTimes(value, dateZone()) as T;
  if (Array.isArray(value)) return value.map(renderDateText) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderDateText(item)])) as T;
  return value;
}
