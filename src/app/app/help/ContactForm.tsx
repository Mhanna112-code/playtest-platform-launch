"use client";
import { useState } from "react";
import { Send } from "lucide-react";
import { Err } from "@/components/Err";
import { api, errOf } from "@/lib/client";
import { checkFields } from "@/components/FieldChecks";
import { NotSentTag, useKept } from "@/lib/useKept";

/** "Contact us": a topic and the message. */
export function ContactForm({ topics }: { topics: readonly string[] }) {
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const keep = useKept("chat:help", { topic, message }, message === "" && topic === "", (v) => { setTopic(v.topic ?? ""); setMessage(v.message ?? ""); });
  return (
    <form
      className="card space-y-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!checkFields(e.currentTarget)) return;
        setBusy(true);
        setErr("");
        try {
          await api("/api/help", { topic, message });
          await keep.clear();
          setSent(true);
          setMessage("");
          setTopic("");
        } catch (x) {
          setErr(errOf(x));
        } finally {
          setBusy(false);
        }
      }}
    >
      {err && <Err text={err} />}
      {sent && <p className="text-emerald-300">Your message is sent: the team will reply by email.</p>}
      <label className="block space-y-1"><span className="label req">What&apos;s it about?</span>
        <select required className="input" value={topic} onChange={(e) => setTopic(e.target.value)}>
          <option value="" disabled>Choose…</option>
          {topics.map((t) => <option key={t}>{t}</option>)}
        </select>
      </label>
      <label className="block space-y-1"><span className="label req">Your message</span>
        <textarea required minLength={10} maxLength={3000} data-min-chars="10" data-msg="Write a few words about what happened (at least 10 characters)." className="input min-h-32" value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder="What happened, and what you'd like us to do. Include amounts and dates if it's about a payment." />
      </label>
      <div className="flex flex-wrap items-center"><button className="btn" disabled={busy}><Send className="h-4 w-4" /> {busy ? "Sending…" : "Send to the team"}</button>{keep.restored && <NotSentTag />}</div>
    </form>
  );
}
