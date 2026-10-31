"use client";
import { useState } from "react";
import { Send } from "lucide-react";
import { api, errOf } from "@/lib/client";
import { checkFields } from "@/components/FieldChecks";
import { FormMistakes } from "@/components/FormMistakes";
import { DraftTag, useKept } from "@/lib/useKept";

/** "Contact us": a topic and the message. (Batch 16 section 10) A mistake is red at its box, with the server's own line, and listed under Send. */
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
      {sent && <p className="text-emerald-300">Your message is sent: the team will reply by email.</p>}
      <label className="block space-y-1"><span className="label req">What&apos;s it about?</span>
        <select id="topic" required className="input" data-required="" data-required-msg="Choose what it's about." data-match="what it's about" value={topic} onChange={(e) => setTopic(e.target.value)}>
          <option value="" disabled>Choose…</option>
          {topics.map((t) => <option key={t}>{t}</option>)}
        </select>
      </label>
      <label className="block space-y-1"><span className="label req">Your message</span>
        <textarea id="message" required minLength={10} maxLength={3000} data-required="" data-required-msg="Write a few words about what happened (at least 10 characters)." data-min-chars="10" data-msg="Write a few words about what happened (at least 10 characters)." data-match="few words|keep it to" className="input min-h-32" value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder="What happened, and what you'd like us to do. Include amounts and dates if it's about a payment." />
      </label>
      <div className="flex flex-wrap items-center"><button className="btn" disabled={busy}><Send className="h-4 w-4" /> {busy ? "Sending…" : "Send to the team"}</button>{keep.restored && (message !== "" || topic !== "") && <DraftTag kind="discard" onUseSaved={keep.signedIn ? () => { setMessage(""); setTopic(""); } : undefined} />}</div>
      <FormMistakes text={err} press="Send to the team" />
    </form>
  );
}
