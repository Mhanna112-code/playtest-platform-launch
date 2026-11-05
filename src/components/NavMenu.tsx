"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { MESSAGES_EVENT } from "@/components/MessagesBadge";

/**
 * (Owner, Nov 4, §187) The header's links on a phone: the sticky header was 171px tall at 375px (the links wrapped to 3 rows). Below 640px (Tailwind's `sm`) the
 * side's links (Dashboard, Post a test / Find tests, Profile, Payments, Messages) fold into ONE "Menu" button: a disclosure (aria-expanded / aria-controls)
 * opening the same links in a drop-down under it. It closes on a link pressed, on navigation, on Escape (focus back on Menu) and on a press outside it. While
 * Messages has unread chats, a dot shows on the Menu button (and its label says how many). The bell, the account and sign-out stay in the header. From 640px
 * up nothing changes: the links sit in the header as before and the button is not shown.
 */
export function NavMenu({ children, messages = 0 }: { children: ReactNode; /** unread chats (Messages' badge), for the dot on Menu */ messages?: number }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(messages);
  useEffect(() => setUnread(messages), [messages]);
  useEffect(() => {
    const changed = (e: Event) => { const n = (e as CustomEvent<number>).detail; if (typeof n === "number") setUnread(n); };
    window.addEventListener(MESSAGES_EVENT, changed);
    return () => window.removeEventListener(MESSAGES_EVENT, changed);
  }, []);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    const outside = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", esc);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", esc); document.removeEventListener("pointerdown", outside); };
  }, [open]);
  const id = useId();
  return (
    <div ref={root} className="relative ml-2 sm:ml-4" data-nav-menu={open ? "open" : "closed"}>
      <button ref={button} type="button" className="nav-link relative border border-white/10 sm:hidden" aria-expanded={open} aria-controls={id} data-nav-menu-button=""
        onClick={() => setOpen(!open)}>
        <Menu className="h-4 w-4" aria-hidden="true" /> Menu
        {unread > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-fuchsia-400 ring-2 ring-ink-950" aria-hidden="true" data-nav-menu-dot={unread} />}
        {unread > 0 && <span className="sr-only">{`, ${unread > 9 ? "9+" : unread} unread message${unread === 1 ? "" : "s"}`}</span>}
      </button>
      <div id={id} data-nav-links=""
        className={`${open ? "absolute left-0 top-full z-30 mt-2 flex w-56 flex-col items-stretch gap-1 rounded-xl border border-white/15 bg-ink-950 p-2 shadow-2xl" : "hidden"} sm:static sm:mt-0 sm:flex sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-1 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none`}
        onClick={(e) => { if ((e.target as Element).closest("a")) setOpen(false); }}>
        {children}
      </div>
    </div>
  );
}
