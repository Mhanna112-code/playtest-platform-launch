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
      {messages.length === 0 && <p className="note">No messages yet. Write to {other} here.</p>}
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {messages.map((m) => (
          <li key={m.id} className={"rounded-lg px-3 py-2 text-sm " + (m.mine ? "ml-8 bg-indigo-50" : "mr-8 bg-slate-100")}>
            <span className="text-xs text-slate-500">{m.who} · {new Date(m.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ul>
      {closed ? <p className="note">This chat is closed.</p> : <form
        className="flex gap-2"
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
