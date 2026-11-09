/**
 * (Owner, Nov 9, §351) The part panels' box style, in a plain module: a constant exported from a "use client" file (components/Panel) reaches a server page as a
 * client reference, and its class attribute rendered the reference's source ("function() { throw new Error(\"Attempted to call PART_PANEL() from the server…\") }").
 */
export const PART_PANEL = "min-w-0 rounded-lg border border-white/10 p-2";
