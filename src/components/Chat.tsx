"use client";
import { Err } from "@/components/Err";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, errOf } from "@/lib/client";

type Msg = { id: string; mine: boolean; who: string; body: string; at: string };

/** The simple chat between the developer and one tester. New messages show on send or when the page is reloaded. */
export function Chat({ path, extra = {}, messages, other, closed }: { path: string; extra?: Record<string, unknown>; messages: Msg[]; other: string; closed?: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      {/* The full app's chat: bubbles, yours on the right in the brand colour, theirs on the left with the name. */}
      {messages.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No messages yet. Write to {other} here.</p>}
      <ul className="max-h-80 space-y-3 overflow-y-auto" role="log" aria-label="Messages">
        {messages.map((m) => (
          <li key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
            <div className="max-w-[78%] space-y-1">
              {!m.mine && <p className="px-1 text-xs text-slate-400">{m.who}</p>}
              <div className={`rounded-2xl px-3.5 py-2 text-sm ${m.mine ? "bg-volt-300 text-ink-950" : "bg-white/[0.07] text-slate-100"}`}>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`mt-1 text-[10px] ${m.mine ? "text-ink-950/75" : "text-slate-500"}`}>{new Date(m.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {closed ? <p className="border-t border-white/10 pt-3 text-sm text-slate-400">This chat is closed.</p> : <form
        className="flex gap-2 border-t border-white/10 pt-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr("");
          try {
            await api(path, { ...extra, body: text });
            setText("");
            router.refresh();
          } catch (e2) {
            setErr(errOf(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        <input className="input" aria-label={`Message ${other}`} placeholder={`Message ${other}…`} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn" disabled={busy || !text.trim()}>Send</button>
      </form>}
      <Err text={err} />
    </div>
  );
}
