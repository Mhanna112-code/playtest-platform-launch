/**
 * (Owner, Nov 11, §380 A) While a Stop or End early (the developer's test page) or a Block (any page) is on its way, EVERY button on the page is disabled until it
 * goes through and the page redraws (other presses keep disabling only their own button): a quick Pay right after Stop can't go out before the redraw. The page
 * is covered (no click or key press reaches anything) and every button looks greyed; React's own `disabled` props are never touched, so nothing is left
 * enabled or disabled wrongly afterwards. A press that is refused or stopped unlocks at once; one that went through unlocks when its redraw lands (or the page
 * reloads). A lock never outlasts `maxMs` (a lost redraw never leaves the page dead).
 */
const ATTR = "data-page-locked";
let held: { timer: ReturnType<typeof setTimeout>; cover: HTMLElement } | null = null;

const block = (e: Event) => {
  if (!held) return;
  e.preventDefault();
  e.stopPropagation();
};

function ensureStyle(d: Document) {
  if (d.getElementById("page-lock-style")) return;
  const s = d.createElement("style");
  s.id = "page-lock-style";
  s.textContent = `body[${ATTR}] button, body[${ATTR}] [role="button"], body[${ATTR}] input[type="submit"] { opacity: .5; cursor: progress !important; }`;
  d.head.appendChild(s);
}

export function lockPage(maxMs = 20_000, d: Document | undefined = typeof document === "undefined" ? undefined : document) {
  if (!d || held) return;
  ensureStyle(d);
  const cover = d.createElement("div");
  cover.setAttribute("data-page-lock", "");
  cover.style.cssText = "position:fixed;inset:0;z-index:2147483646;cursor:progress;background:transparent";
  d.body.appendChild(cover);
  d.body.setAttribute(ATTR, "");
  d.body.setAttribute("aria-busy", "true");
  for (const t of ["click", "keydown", "submit", "pointerdown"]) d.addEventListener(t, block, true);
  held = { cover, timer: setTimeout(() => unlockPage(d), maxMs) };
}

export function unlockPage(d: Document | undefined = typeof document === "undefined" ? undefined : document) {
  if (!d || !held) return;
  clearTimeout(held.timer);
  held.cover.remove();
  held = null;
  d.body.removeAttribute(ATTR);
  d.body.removeAttribute("aria-busy");
  for (const t of ["click", "keydown", "submit", "pointerdown"]) d.removeEventListener(t, block, true);
}

export const pageLocked = () => !!held;
