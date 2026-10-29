// Preloaded into the Stripe recording server for the real-email part (NODE_OPTIONS=--require this file). Every POST to Resend's /emails is checked first:
// only the owner's own aliases (marchanna111+pt…@gmail.com) may receive, and at most MAX_SENDS emails in all (a counter file shared by every server process).
// Anything else is refused locally with a 403 (nothing reaches Resend). Each real send's Resend id, recipient and subject go to a log (never the key).
const fs = require("fs");
const path = require("path");
const DIR = process.env.RESEND_GUARD_DIR || path.join(__dirname, "logs");
fs.mkdirSync(DIR, { recursive: true });
const COUNT = path.join(DIR, "resend-count.txt");
const LOG = path.join(DIR, "resend-sends.jsonl");
const MAX_SENDS = Number(process.env.RESEND_MAX || 15);
const ALLOWED = /^marchanna111\+pt[a-z0-9]+@gmail\.com$/i;
const orig = globalThis.fetch;
const note = (o) => fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...o }) + "\n");
const refuse = (why) => new Response(JSON.stringify({ name: "recording_guard", message: `Refused by the recording guard: ${why}` }), { status: 403, headers: { "content-type": "application/json" } });
globalThis.fetch = async function guarded(input, init = {}) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url ?? "";
  if (!/^https:\/\/api\.resend\.com\//.test(url)) return orig.call(this, input, init);
  const method = (init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
  if (method === "GET") return orig.call(this, input, init);
  if (!/^https:\/\/api\.resend\.com\/emails\/?$/.test(url) || method !== "POST") { note({ refused: true, why: "not a single email send", url }); return refuse("only single sends are allowed"); }
  let body = {};
  try { body = JSON.parse(typeof init.body === "string" ? init.body : ""); } catch { /* not JSON */ }
  const to = [].concat(body.to || [], body.cc || [], body.bcc || []);
  if (!to.length || !to.every((t) => ALLOWED.test(String(t).trim()))) { note({ refused: true, why: "recipient", to, subject: body.subject }); return refuse("recipient not allowed"); }
  // the shared counter (claimed before the send)
  let n = 0;
  try { n = Number(fs.readFileSync(COUNT, "utf8")) || 0; } catch { /* first */ }
  if (n >= MAX_SENDS) { note({ refused: true, why: "limit", to, subject: body.subject }); return refuse("the recording's email limit is used up"); }
  fs.writeFileSync(COUNT, String(n + 1));
  const res = await orig.call(this, input, init);
  const copy = res.clone();
  let id = "";
  try { id = (await copy.json()).id || ""; } catch { /* no JSON */ }
  note({ sent: res.ok, status: res.status, id, to, subject: body.subject, n: n + 1 });
  return res;
};
note({ loaded: true });
