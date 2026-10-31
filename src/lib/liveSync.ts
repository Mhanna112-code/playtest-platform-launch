/**
 * (Owner, Oct 31, batch 35 §37) One check, not two. A page's redraw (AutoRefresh's fingerprint poll, JoinWatch on the join page) and the live "Updated" box
 * (LiveTop, with its "1 new update ↑" pill) used to run their own 20-second timers: they drifted, and a redraw from elsewhere (tab focus, a press, another
 * component) could change rows and buttons up to 20 s before the box's line said why. Now:
 * - ONE timer per page (this clock, running while anything rides it) beats every 20 s; each beat is the "live-tick" event every check listens to, so the
 *   redraw's poll and the box's check run as one tick.
 * - Whenever the page redraws (its server render time, LiveTop's `seenAt`, changes), the box checks at once (LiveTop).
 * - Whenever the box finds new lines, it asks the page to redraw at once (`askRedraw`); the page's redraw driver answers (`onBoxLines`). While that redraw is
 *   on its way the box holds its new lines and shows them, with the pill, when the redraw lands (at most a few seconds later if it never lands), so the rows
 *   and the line change in the same moment.
 * Steady state (nothing changes): one beat every 20 s and no other request.
 */
export const LIVE_EVERY = 20_000;
export const LIVE_TICK = "live-tick";
export const BOX_LINES_EVENT = "live-box-lines";
/** How long the box holds its new lines for the redraw it asked for. */
export const HOLD_FOR_REDRAW = 3000;

let timer: ReturnType<typeof setInterval> | null = null;
let riders = 0;
let lastBeat = 0;

/** A beat now: every check on the page runs (the redraw's poll, the box, the page's other live parts). Two calls in the same moment make one beat. */
export function liveBeat() {
  const now = Date.now();
  if (now - lastBeat < 250) return;
  lastBeat = now;
  window.dispatchEvent(new Event(LIVE_TICK));
}

/** Rides the page's one 20-second clock (started by the first rider, stopped when the last one leaves). Returns the leave function. */
export function rideLiveClock(): () => void {
  riders += 1;
  if (!timer) timer = setInterval(liveBeat, LIVE_EVERY);
  let left = false;
  return () => {
    if (left) return;
    left = true;
    riders = Math.max(0, riders - 1);
    if (!riders && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** How many timers drive the page's checks now (0 or 1). */
export const liveClockTimers = () => (timer ? 1 : 0);

/**
 * When the page's redraw driver last asked for a redraw, and when the page last drew (LiveTop sees its render time change). A redraw asked after the last
 * drawing, a moment ago, is on its way: the box's ask then waits for it instead of asking a second one (the poll's redraw of the same beat carries the lines).
 */
let askedAt = 0;
let drawnAt = 0;
export function noteRedrawAsked() {
  askedAt = Date.now();
}
export function notePageDrawn() {
  drawnAt = Date.now();
}
export const redrawOnItsWay = () => askedAt > drawnAt && Date.now() - askedAt < HOLD_FOR_REDRAW;

type Ask = { redrawing: boolean };
/** The box found new lines: the page redraws at once. True when a redraw is on its way (the box then shows its lines as it lands). */
export function askRedraw(): boolean {
  const detail: Ask = { redrawing: false };
  window.dispatchEvent(new CustomEvent<Ask>(BOX_LINES_EVENT, { detail }));
  return detail.redrawing;
}

/**
 * For a page's redraw driver (AutoRefresh, JoinWatch): `redraw` redraws the page and says whether it did (false: this page doesn't redraw now, e.g. Edit, or
 * the bank's check is open). Once per ask, whoever answers first; none while a redraw is already on its way.
 */
export function onBoxLines(redraw: () => boolean): () => void {
  const on = (e: Event) => {
    const d = (e as CustomEvent<Ask>).detail;
    if (!d || d.redrawing) return;
    if (redrawOnItsWay()) d.redrawing = true;
    else if (redraw()) {
      noteRedrawAsked();
      d.redrawing = true;
    }
  };
  window.addEventListener(BOX_LINES_EVENT, on);
  return () => window.removeEventListener(BOX_LINES_EVENT, on);
}

/** True while the box announces lines that came with the page's redraw (a listener that would redraw for them needn't: JoinBox). */
let withRedraw = false;
export const announcedWithRedraw = () => withRedraw;
export function whileRedrawn(redrawn: boolean, run: () => void) {
  withRedraw = redrawn;
  try {
    run();
  } finally {
    withRedraw = false;
  }
}

/**
 * The box's side (LiveTop): when the page last drew, and the new lines held for the redraw they asked for. `drawn` on every redraw (held lines show then, as
 * having come with it); `lines` when a check that started at `started` found new lines: shown at once if the page drew during that check, otherwise the page is
 * asked to redraw and they show when it lands (or after `hold` ms if it never does; at once when nothing on the page redraws, e.g. Edit).
 */
export function boxSync(hold = HOLD_FOR_REDRAW) {
  let drawn = 0;
  let held: { apply: (redrawn: boolean) => void; t: ReturnType<typeof setTimeout> } | null = null;
  const release = (redrawn: boolean) => {
    const h = held;
    if (!h) return;
    held = null;
    clearTimeout(h.t);
    h.apply(redrawn);
  };
  return {
    drawn() {
      drawn = Date.now();
      notePageDrawn();
      release(true);
    },
    lines(started: number, apply: (redrawn: boolean) => void) {
      if (drawn > started) return apply(true);
      if (!askRedraw()) return apply(false);
      release(false);
      held = { apply, t: setTimeout(() => release(false), hold) };
    },
    holding: () => held !== null,
    stop() {
      if (held) clearTimeout(held.t);
      held = null;
    },
  };
}
