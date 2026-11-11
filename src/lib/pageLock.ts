/**
 * (Owner, Nov 11, §380 A and E) The page lock: while it is on, EVERY button on the page is disabled (greyed, and no click, Enter / Space on it or form submit gets
 * through); typing in fields stays allowed. React's own `disabled` props are never touched, so nothing is left enabled or disabled wrongly afterwards.
 * - A: a Stop or End early (the developer's test page) or a Block (any page) locks the page until it goes through and the page redraws (lockPage / unlockPage).
 * - E: on EVERY page, ANY press locks the page until the server answers and, for a press that redraws the page, until the redraw lands (pressStarted /
 *   pressAnswered / holdForRedraw / redrawLanded; lib/client.ts and useFinished call them). A payment the bank has to confirm inline (3D Secure) never freezes
 *   the page: the page is released as soon as the server answered and the bank's check is showing.
 * Always usable, locked or not (FREE): typing, links, drop-downs and every fold toggle ("Show more", "+3 more": `aria-expanded`), copy buttons, an open bank
 *   check (`data-bank-check`) and a live call's controls (`data-press-free`: mute, camera, share, leave, report a problem with the call).
 * A lock never outlasts MAX_MS (a lost answer or redraw never leaves the page dead).
 */
const ATTR = "data-page-locked";
const MAX_MS = 20_000;
/** After a press went through, how long the page waits for its redraw to start (useFinished's holdForRedraw) before it lets go. */
const GRACE_MS = 600;
const BUTTONS = 'button, [role="button"], input[type="submit"], input[type="button"]';
/** (§380 E) Never locked: fold toggles and drop-downs (aria-expanded), copy buttons, an open bank check, a live call's controls. */
export const FREE = '[aria-expanded], [data-press-free], [data-bank-check]';

let explicit = false;
let presses = 0;
let redraw = false;
let grace: ReturnType<typeof setTimeout> | null = null;
let safety: ReturnType<typeof setTimeout> | null = null;
let engagedOn: Document | null = null;

const doc = (): Document | undefined => (typeof document === "undefined" ? undefined : document);

/** The event reaches a button (or submits a form): swallowed while the page is locked. Typing in a field goes through. */
export function lockBlocks(e: { type: string; key?: string; target?: unknown }) {
  const t = e.target as { closest?: (s: string) => unknown } | null | undefined;
  const has = (s: string) => !!t && typeof t.closest === "function" && !!t.closest(s);
  if (has(FREE)) return false;
  if (e.type === "submit") return true;
  if (!has(BUTTONS)) return false;
  return e.type === "click" || (e.type === "keydown" && (e.key === "Enter" || e.key === " "));
}
const block = (e: Event) => {
  if (!lockBlocks(e as Event & { key?: string })) return;
  e.preventDefault();
  e.stopPropagation();
};
const EVENTS = ["click", "keydown", "submit"];

function ensureStyle(d: Document) {
  if (d.getElementById("page-lock-style")) return;
  const s = d.createElement("style");
  s.id = "page-lock-style";
  const free = ":not([aria-expanded]):not([data-press-free]):not([data-press-free] *):not([data-bank-check] *)";
  s.textContent = ["button", '[role="button"]', 'input[type="submit"]', 'input[type="button"]'].map((b) => `body[${ATTR}] ${b}${free}`).join(", ") + " { opacity: .5; cursor: progress !important; }";
  d.head.appendChild(s);
}

function apply(d: Document | undefined = engagedOn ?? doc()) {
  noteIdle();
  if (!d) return;
  const on = explicit || presses > 0 || redraw || !!grace;
  if (on && !engagedOn) {
    ensureStyle(d);
    d.body.setAttribute(ATTR, "");
    d.body.setAttribute("aria-busy", "true");
    for (const t of EVENTS) d.addEventListener(t, block, true);
    engagedOn = d;
    safety = setTimeout(() => releaseAll(), MAX_MS);
  } else if (!on && engagedOn) {
    engagedOn.body.removeAttribute(ATTR);
    engagedOn.body.removeAttribute("aria-busy");
    for (const t of EVENTS) engagedOn.removeEventListener(t, block, true);
    engagedOn = null;
    if (safety) clearTimeout(safety);
    safety = null;
  }
}

/** Everything off at once (the safety limit, a test). */
export function releaseAll() {
  explicit = false;
  presses = 0;
  redraw = false;
  if (grace) clearTimeout(grace);
  grace = null;
  apply();
}

/** (A) Lock the page for a Stop, End early or Block on its way. `d`: tests. */
export function lockPage(_maxMs = MAX_MS, d: Document | undefined = doc()) {
  void _maxMs;
  explicit = true;
  apply(d);
}
/** (A) Its press was refused or stopped, or its redraw landed. */
export function unlockPage(d: Document | undefined = engagedOn ?? doc()) {
  explicit = false;
  apply(d);
}

/** (E) A press from a one-at-a-time page went out. `d`: tests. */
export function pressStarted(d: Document | undefined = doc()) {
  presses++;
  if (grace) clearTimeout(grace);
  grace = null;
  apply(d);
}
/**
 * (E) Its answer came. Refused or stopped (`ok` false), or a payment now waiting on the bank's inline check (`bank`): released at once. Gone through: the page
 * waits a moment for its redraw to start (holdForRedraw), then lets go.
 */
export function pressAnswered(ok: boolean, bank = false) {
  presses = Math.max(0, presses - 1);
  if (grace) clearTimeout(grace);
  grace = ok && !bank ? setTimeout(() => { grace = null; apply(); }, GRACE_MS) : null;
  apply();
}
/** (E) A press that went through redraws the page: locked until the redraw lands. Only right after a locking press (a free one never locks its redraw). */
export function holdForRedraw() {
  if (!grace && !presses) return;
  redraw = true;
  if (grace) clearTimeout(grace);
  grace = null;
  apply();
}
/** (E) The redraw landed. */
export function redrawLanded() {
  if (!redraw) return;
  redraw = false;
  apply();
}

export const pageLocked = () => !!engagedOn;
/** (§380 J) A press of this page is on its way, or its redraw hasn't landed yet: a new copy of the page waits for it before taking over. */
export const pressInFlight = () => presses > 0 || redraw || !!grace;

/** (§380 J) Told when the page's presses are all over (answered, and their redraw landed): a one-at-a-time page then says so (OnePage), or hands over. */
const idle = new Set<() => void>();
let wasInFlight = false;
function noteIdle() {
  const now = presses > 0 || redraw || !!grace;
  const ended = wasInFlight && !now;
  wasInFlight = now;
  if (ended) for (const f of [...idle]) f();
}
export function onPressIdle(f: () => void) {
  idle.add(f);
  return () => {
    idle.delete(f);
  };
}
