"use client";
import { Err } from "@/components/Err";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, errOf, newPressId } from "@/lib/client";
import { NotSentTag, useKept } from "@/lib/useKept";

type Msg = { id: string; mine: boolean; who: string; body: string; at: string };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/**
 * The chat page's conversation, as the full app's: one card (the other person's name and the test in its header), the
 * messages with a day line between days (yours on the right in the brand colour), and the message box at the bottom.
 */
export function Chat({ path, extra = {}, messages, other, title, closed, closedNote, pausedNote, keepKey }: { path: string; extra?: Record<string, unknown>; messages: Msg[]; other: string; title: string; closed?: boolean; /** Replaces "This chat is closed." (e.g. "Messages are paused for now. You can still read this chat.") */ closedNote?: string; /** (Batch 15 section 1) The box is paused because the other person is restricted: it comes back live when that lifts. */ pausedNote?: boolean; keepKey: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // (Owner, Oct 26) A block (or a deleted account) while the page is open: the next send is refused with "This chat is closed." under Send and the box goes away.
  const [shut, setShut] = useState(false);
  // (Owner, Oct 30, batch 15 section 1) The other person became restricted after the page loaded: the Send is turned back (the typed text is kept), the box hides live
  // and comes back by itself once the page learns the restriction lifted.
  const [pausedNow, setPausedNow] = useState(false);
  useEffect(() => setPausedNow(false), [closed, pausedNote]);
  // (Batch 15 section 13) One press id per message: made at the first Send of this text, kept while it isn't confirmed (a repeat after a lost answer posts once),
  // and replaced once it is, so the same words sent again on purpose post again.
  const pressId = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const count = useRef(0);
  // (NEXT-UI 10) The message typed and not sent is kept on the server (back after a reload / another device, "Not sent yet").
  const keep = useKept(keepKey, { text }, text === "", (v) => setText(v.text ?? ""));
  // Scroll to the newest message when one arrives.
  useEffect(() => {
    if (messages.length > count.current) bottom.current?.scrollIntoView({ behavior: count.current ? "smooth" : "auto" });
    count.current = messages.length;
  }, [messages.length]);
  return (
    <div className="card flex h-[70vh] flex-col p-0">
      <div className="border-b border-white/10 px-5 py-3">
        <p className="font-semibold text-white">{other}</p>
        <p className="text-xs text-slate-400">{title}</p>
      </div>
      <div className="relative flex-1 space-y-3 overflow-y-auto px-5 py-4" tabIndex={0} role="log" aria-label="Messages" aria-live="polite">
        {messages.length === 0 && <p className="py-10 text-center text-sm text-slate-500">No messages yet. Ask a question, or say hello.</p>}
        {messages.map((m, i) => (
          <div key={m.id}>
            {(i === 0 || day(messages[i - 1].at) !== day(m.at)) && <p className="my-2 text-center text-xs text-slate-500">{day(m.at)}</p>}
            <div className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[78%] space-y-1">
                {!m.mine && <p className="px-1 text-xs text-slate-400">{m.who}</p>}
                <div className={`rounded-2xl px-3.5 py-2 text-sm ${m.mine ? "bg-volt-300 text-ink-950" : "bg-white/[0.07] text-slate-100"}`}>
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                  <p className={`mt-1 text-[10px] ${m.mine ? "text-ink-950/75" : "text-slate-500"}`}>{time(m.at)}</p>
                </div>
              </div>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {closed && !shut ? (
        <p className="border-t border-white/10 px-5 py-3 text-sm text-slate-400" data-chat-closed="" {...(pausedNote ? { "data-chat-paused": "" } : {})}>{closedNote || "This chat is closed."}</p>
      ) : shut || pausedNow ? null : (
        <form
          className="flex items-end gap-2 border-t border-white/10 px-4 py-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr("");
            pressId.current ??= newPressId();
            try {
              await api(path, { ...extra, body: text, clientId: pressId.current });
              pressId.current = null; // confirmed: the next message gets its own id
              setText("");
              await keep.clear();
              router.refresh();
            } catch (e2) {
              if (e2 instanceof ApiError && e2.code === "closed") setShut(true);
              if (e2 instanceof ApiError && e2.code === "chat_paused") {
                setPausedNow(true);
                router.refresh();
              }
              setErr(errOf(e2));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input className="input" aria-label={`Message ${other}`} placeholder={`Message ${other}…`} value={text} onChange={(e) => { if (e.target.value !== text) pressId.current = null; setText(e.target.value); }} />
          <button className="btn" disabled={busy || !text.trim()}>Send</button>
          {keep.restored && <span className="self-center"><NotSentTag /></span>}
        </form>
      )}
      {err && <div className="px-5 pb-3"><Err text={err} /></div>}
    </div>
  );
}
