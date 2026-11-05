"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { BellOff } from "lucide-react";
import { ALERT_TYPES } from "@/lib/alerts";

/** (Batch 16 section 21) The line under "Alerts". */
export const ALERTS_INTRO_REST = "stop your buttons. A payment hold or pause, a stopped test and final refusals always stop.";
import { api } from "@/lib/client";
import { refusalLine } from "@/lib/pressLabels";
import { startIgnoredAlertsSave, useIgnoredAlerts } from "@/lib/testerAlerts";

/** (Owner, Nov 5, §207) The gap the open menu keeps from the screen's edges (px). */
export const MENU_EDGE = 8;
/** (§207) Below this width (Tailwind's `sm`) the menu opens in the page under the button (static, full width): nothing to place. */
export const MENU_STATIC_BELOW = 640;
/**
 * (Owner, Nov 5, §207) Where the open menu goes, as its left edge relative to the button (px), so all of it is on the screen wherever the button sits:
 * right edges together (it opens leftward) when there's room on the left; else left edges together (it opens rightward); and, when neither fits, slid
 * in from whichever edge it would cross. `button`: the button's left and right on the screen; `width`: the menu's; `viewport`: the screen's width.
 */
export function menuLeft(button: { left: number; right: number }, width: number, viewport: number, edge = MENU_EDGE) {
  let x = button.right - width;
  if (x < edge) x = button.left;
  x = Math.min(x, viewport - edge - width);
  x = Math.max(x, edge);
  return Math.round(x - button.left);
}

/** (§169) "All" is ticked exactly while every type that can be changed here (`open`) is ticked: unticking one unticks it, ticking that one again ticks it. */
export const allAlertsOn = (open: string[], ignored: string[]) => open.length > 0 && open.every((k) => ignored.includes(k));

/**
 * (Design doc 6) "Alerts": tick the update types that should NOT interrupt your buttons any more. They still show (greyed) in the live
 * box. A payment hold, a stopped test and final refusals always stop. (Batch 16 section 21) A stored tick for a type no longer in the menu (the old
 * "Your saves and presses in another tab") is ignored.
 */
export function AlertsMenu({ testId, ignored: start, v: startV, keys }: { testId: string; ignored: string[]; /** (§169) the version of `ignored` */ v?: number; keys?: string[] }) {
  // (Owner, Oct 31, batch 35 §73) The ticks are this test's own (a new test and a Next round start with every alert on).
  // (Batch 20 section 8) The one shared setting: a stop box's "Don't stop me for" chip ticks it here at once (and in other tabs); un-ticking here turns the chip back.
  const shared = useIgnoredAlerts(testId, start, startV);
  const ignored = shared.filter((k) => ALERT_TYPES.some((a) => a.key === k));
  const [saved, setSaved] = useState("");
  // (Owner, Nov 4, §169) One save for one type or for All's types: they tick (or untick) at once on the ticks shown NOW (never a list this click was drawn with:
  // the old loop's copy showed one tick at a time), stay so over any poll or redraw answered meanwhile, and the saved list (with its version) replaces them.
  async function save(change: string[], on: boolean, body: Record<string, unknown>) {
    const end = startIgnoredAlertsSave(testId, change, on);
    await api<{ ignored: string[]; v?: number }>("/api/account/alerts", { testId, ...body }).then((r) => {
      // (Owner, Oct 31, batch 35 §71) No "Saved." line: the tick itself shows it took; only a failure says so.
      end(r);
      setSaved("");
    }, (e) => {
      end(); // only these types go back (another save's ticks stay)
      // (§156) A tick that didn't save names its press, as every refusal does: "Your Alerts didn't go through: …".
      setSaved(refusalLine("Alerts", (e as Error)?.message || "Couldn't save. Try again."));
    });
  }
  // One type at a time (the server adds or removes just it), so a menu drawn earlier never saves its old list over a chip's press.
  const toggle = (key: string, on: boolean) => save([key], on, { key, off: on });
  // (Owner, Oct 31, batch 35 §71) "All": ticks (or unticks) every type that can happen here at once; greyed types keep their ticks.
  // (Owner, Nov 4, §169) ONE request with every open type (`keys`), saved together: every box ticks at once and stays. All is ticked exactly while every open
  // type is, so unticking one unticks All and ticking it again ticks All.
  const open = ALERT_TYPES.filter((a) => !keys || keys.includes(a.key));
  const allOn = allAlertsOn(open.map((a) => a.key), ignored);
  const toggleAll = (on: boolean) => {
    const ks = open.map((a) => a.key);
    return save(ks, on, { keys: ks, off: on });
  };
  // (Owner, Nov 5, §207) The open menu is placed from where its button is NOW (menuLeft), so it is never past either edge of the screen: it hung off the left
  // edge on the test page at a desktop width (the button sat near the left once the header's buttons wrapped), and its ticks couldn't be reached. Placed
  // again when the window changes size while it is open. Phones keep the menu in the page under the button (static, full width).
  const box = useRef<HTMLDetailsElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState<number | null>(null);
  const place = useCallback(() => {
    const d = box.current, m = menu.current;
    if (!d?.open || !m || window.innerWidth < MENU_STATIC_BELOW) return setLeft(null);
    const r = d.getBoundingClientRect();
    setLeft(menuLeft(r, m.offsetWidth, document.documentElement.clientWidth || window.innerWidth));
  }, []);
  useEffect(() => {
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [place]);
  return (
    <details ref={box} className="relative" data-alerts-menu="" onToggle={place}>
      <summary className="btn-secondary cursor-pointer list-none px-3 py-1.5 text-sm"><BellOff className="h-4 w-4" /> Alerts{ignored.length ? ` (${ignored.length} off)` : ""}</summary>
      {/* On phones the button can sit at the left edge: the menu opens in the page under it instead of hanging off-screen. */}
      <div ref={menu} style={left == null ? undefined : { left, right: "auto" }} data-alerts-panel="" className="absolute right-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] max-sm:static max-sm:w-full max-sm:max-w-none space-y-1.5 rounded-2xl border border-white/15 bg-slate-900 p-3 text-sm shadow-2xl">
        <p className="text-xs text-slate-400" data-alerts-intro="">Tick what should <b>not</b> {ALERTS_INTRO_REST}</p>
        {/* (Batch 15 section 39; owner, Oct 31, batch 35 §63) Every type is listed, so "(N off)" matches the ticks shown; a type that can't happen on a paused or
            stopped test is greyed and can't be changed there (its tick is kept). */}
        <label className="flex cursor-pointer items-center gap-2 border-b border-white/10 pb-1.5 font-medium text-slate-100" data-alerts-all="">
          <input type="checkbox" checked={allOn} onChange={(e) => void toggleAll(e.target.checked)} /> All
        </label>
        {ALERT_TYPES.map((a) => {
          const off = !!keys && !keys.includes(a.key);
          return (
            <label key={a.key} className={`flex items-center gap-2 ${off ? "cursor-default text-slate-500" : "cursor-pointer text-slate-200"}`} data-alert-na={off ? "" : undefined}>
              <input type="checkbox" checked={ignored.includes(a.key)} disabled={off} onChange={(e) => void toggle(a.key, e.target.checked)} /> {a.label}
            </label>
          );
        })}
        {saved && <p className="err text-xs" role="status" data-alerts-refused="">{saved}</p>}
      </div>
    </details>
  );
}
