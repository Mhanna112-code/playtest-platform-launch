/**
 * (Owner, Oct 30, batch 35 §6; §8: the side switch only, still signed in; restored silently) A tab that moves because the account switched sides in another tab
 * keeps what was typed there. The fields useKept doesn't cover (inputs, text boxes and dropdowns with an id or name inside the page's main content; never passwords, files, hidden
 * fields, ticks or card / payment fields) are snapshotted into this tab's sessionStorage before it moves, keyed by the ACCOUNT, the SIDE and the page path,
 * and put back only when that same account, on that same side, shows that same path in this tab again: into fields still empty (a dropdown still on its
 * starting choice), with the input events React needs. Restored or older than an hour, a snapshot goes. Another account never gets one.
 */

export const TYPED_PREFIX = "pt-typed:";
export const TYPED_TTL_MS = 3_600_000;

/** The snapshot's key: account, side and path ("pt-typed:<user>:<side>:/app/tests/x"). */
export const typedKey = (userId: string, side: string | null | undefined, path: string) => `${TYPED_PREFIX}${userId}:${side || "-"}:${path}`;

/** What the helpers read from a field (a DOM element satisfies it). */
export type FieldEl = {
  tagName: string; type?: string; id?: string; name?: string; autocomplete?: string; value: string; defaultValue?: string; disabled?: boolean; readOnly?: boolean;
  options?: ArrayLike<{ value: string; defaultSelected: boolean }>;
  closest?: (selector: string) => unknown; dispatchEvent?: (e: Event) => boolean; setAttribute?: (k: string, v: string) => void;
};
export type Root = { querySelectorAll: (selector: string) => ArrayLike<FieldEl> | Iterable<FieldEl> };
export type StoreLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
export type Snapshot = { at: number; fields: Record<string, { v: string; start?: string }> };

const SKIP_TYPES = new Set(["password", "file", "hidden", "checkbox", "radio", "submit", "button", "reset", "image", "range", "color"]);
/** Card, bank and payment fields (and secrets) are never kept, by their id, name or autocomplete. */
const PAYMENT = /card|cc-|cvc|cvv|csc|iban|routing|account.?(number|no)|payment|stripe|password|secret|token|otp/i;

/** The field's key in a snapshot: "#<id>", else "@<name>". */
export const fieldKey = (f: FieldEl) => (f.id ? `#${f.id}` : f.name ? `@${f.name}` : "");

export function keepable(f: FieldEl) {
  const tag = f.tagName.toLowerCase();
  if (tag !== "input" && tag !== "textarea" && tag !== "select") return false;
  if (tag === "input" && SKIP_TYPES.has((f.type || "text").toLowerCase())) return false;
  if (!fieldKey(f) || f.disabled || f.readOnly) return false;
  if (PAYMENT.test(`${f.id ?? ""} ${f.name ?? ""} ${f.autocomplete ?? ""}`)) return false;
  if (f.closest?.("[data-no-keep]")) return false;
  return true;
}

/** A dropdown's starting choice (the option the page drew selected). */
const startOf = (f: FieldEl) => {
  const o = f.options ? Array.from(f.options) : [];
  return (o.find((x) => x.defaultSelected) ?? o[0])?.value ?? "";
};
const isSelect = (f: FieldEl) => f.tagName.toLowerCase() === "select";

/** What was typed: every keepable field with a value (a dropdown only once changed from its starting choice). Null: nothing to keep. */
export function snapshotOf(fields: Iterable<FieldEl>, now = Date.now()): Snapshot | null {
  const out: Snapshot["fields"] = {};
  for (const f of fields) {
    if (!keepable(f) || !f.value) continue;
    if (isSelect(f)) {
      const start = startOf(f);
      if (f.value !== start) out[fieldKey(f)] = { v: f.value, start };
    } else out[fieldKey(f)] = { v: f.value };
  }
  return Object.keys(out).length ? { at: now, fields: out } : null;
}

const all = (root: Root) => Array.from(root.querySelectorAll("input, textarea, select") as Iterable<FieldEl>);

function read(store: StoreLike | null, key: string): Snapshot | null {
  try {
    const v = JSON.parse(store?.getItem(key) ?? "null") as Snapshot | null;
    return v && typeof v.at === "number" && v.fields && typeof v.fields === "object" ? v : null;
  } catch {
    return null;
  }
}
const drop = (store: StoreLike | null, key: string) => {
  try { store?.removeItem(key); } catch { /* storage blocked */ }
};

/** Before the tab moves: keep this page's typed fields for `key` (a snapshot already kept for it is replaced). */
export function saveTyped(store: StoreLike | null, root: Root | null, key: string, now = Date.now()) {
  if (!store || !root) return false;
  const snap = snapshotOf(all(root), now);
  try {
    if (snap) store.setItem(key, JSON.stringify(snap));
    return !!snap;
  } catch {
    return false; // storage blocked or full: nothing kept
  }
}

/** Every snapshot (any account) older than an hour goes. */
export function dropStaleTyped(store: StoreLike | null, now = Date.now()) {
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(TYPED_PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      const s = read(store, k);
      if (!s || now - s.at > TYPED_TTL_MS) drop(store, k);
    }
  } catch {
    // storage blocked
  }
}

/** (Batch 35 §8) Every snapshot in this tab (any account) goes: signed out, or another account signed in. */
export function dropAllTyped(store: StoreLike | null) {
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(TYPED_PREFIX)) keys.push(k);
    }
    for (const k of keys) drop(store, k);
  } catch {
    // storage blocked
  }
}

/** Sets a field's value the way React notices (the native setter, then input and change events). */
export function fillField(f: FieldEl, value: string) {
  const proto = Object.getPrototypeOf(f) as object | null;
  const setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : undefined;
  if (setter) setter.call(f, value);
  else f.value = value;
  f.dispatchEvent?.(new Event("input", { bubbles: true }));
  f.dispatchEvent?.(new Event("change", { bubbles: true }));
  f.setAttribute?.("data-kept-typed", "");
}

/**
 * Puts `key`'s snapshot back into the page's fields still empty (a dropdown still on its starting choice); a field found already filled keeps what it has (and
 * that part of the snapshot goes). Fields not on the page yet stay kept (the page may show them later, e.g. after the switch back). Returns how many were filled.
 */
export function restoreTyped(store: StoreLike | null, root: Root | null, key: string, now = Date.now(), focused?: unknown) {
  if (!store || !root) return 0;
  const snap = read(store, key);
  if (!snap) return 0;
  if (now - snap.at > TYPED_TTL_MS) {
    drop(store, key);
    return 0;
  }
  const byKey = new Map(all(root).filter(keepable).map((f) => [fieldKey(f), f]));
  const left: Snapshot["fields"] = {};
  let n = 0;
  for (const [k, kept] of Object.entries(snap.fields)) {
    const f = byKey.get(k);
    if (!f) {
      left[k] = kept;
      continue;
    }
    const untouched = f !== focused && (isSelect(f) ? f.value === (kept.start ?? startOf(f)) : f.value === "");
    if (untouched && f.value !== kept.v) {
      fillField(f, kept.v);
      n++;
    }
  }
  try {
    if (Object.keys(left).length) store.setItem(key, JSON.stringify({ at: snap.at, fields: left }));
    else store.removeItem(key);
  } catch {
    // storage blocked
  }
  return n;
}

/** This tab's sessionStorage, or null where it's blocked. */
export function tabStore(): StoreLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
