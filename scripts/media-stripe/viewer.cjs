// A small local page that shows what Stripe itself holds for the recording's accounts, read from Stripe's API in TEST MODE with the test key on the server side
// (the Stripe Dashboard needs the owner's sign-in). It is recorded beside the app. Port 3461. Never prints or serves a key.
//   /panel?dev=<email>&testers=<email>,<email>&title=…   the page (polls /data every 1.5 s)
//   /data?…                                              the JSON it draws
//   /emails?ids=<id>,<id>                                 Resend's status for these email ids (the real-email part)
const http = require("http");
const { execFileSync } = require("child_process");
const { stripeKeys, parse } = require("./env.cjs");
const Stripe = require("C:/Users/march/Projects/playtest-lite/node_modules/stripe");
const { sk } = stripeKeys();
const stripe = new Stripe(sk);
const PORT = Number(process.env.VIEWER_PORT || 3461);
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-p", "5499", "-U", "postgres", "-d", "playtest_lite_media", "-t", "-A", "-F", "\t", "-c", q]).toString().replace(/\r/g, "").trim();
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const userRow = (email) => {
  if (!email) return null;
  const r = sql(`select name, coalesce("stripeCustomerId",''), coalesce("stripeAccountId",''), coalesce("stripePaymentMethodId",'') from "User" where email = ${lit(email)}`);
  if (!r) return null;
  const [name, customer, account, pm] = r.split("\t");
  return { email, name, customer: customer.startsWith("cus_") ? customer : "", account: account.startsWith("acct_") ? account : "", pm };
};
// The Dashboard's words for a PaymentIntent's status.
function word(pi) {
  const ch = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  if (ch?.disputed) return { w: "Disputed", c: "bad" };
  if (pi.status === "succeeded") return ch?.refunded ? { w: "Refunded", c: "mute" } : { w: "Succeeded", c: "ok" };
  if (pi.status === "requires_capture") return { w: "Uncaptured", c: "warn" };
  if (pi.status === "canceled") return { w: "Canceled", c: "mute" };
  if (pi.status === "requires_action") return { w: "Incomplete", c: "warn" };
  if (pi.status === "requires_payment_method") return pi.last_payment_error ? { w: "Failed", c: "bad" } : { w: "Incomplete", c: "warn" };
  if (pi.status === "processing") return { w: "Processing", c: "warn" };
  return { w: pi.status, c: "mute" };
}
const usd = (c) => `$${(c / 100).toFixed(2)}`;
async function data(q) {
  const dev = userRow(q.get("dev"));
  const testers = (q.get("testers") || "").split(",").filter(Boolean).map(userRow).filter(Boolean);
  const out = { at: new Date().toISOString(), dev: dev && { name: dev.name, customer: dev.customer }, payments: [], card: null, transfers: [], accounts: [], disputes: [], subscriptions: [] };
  if (dev?.customer) {
    const pis = await stripe.paymentIntents.list({ customer: dev.customer, limit: 12, expand: ["data.latest_charge", "data.payment_method"] });
    out.payments = pis.data.map((pi) => {
      const ch = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
      const pm = typeof pi.payment_method === "object" && pi.payment_method ? pi.payment_method.card : ch?.payment_method_details?.card;
      return {
        id: pi.id, amount: usd(pi.amount), status: pi.status, ...word(pi), created: pi.created, description: pi.description || "",
        card: pm ? `${pm.brand} •••• ${pm.last4}` : "", manual: pi.capture_method === "manual", captured: pi.amount_received ? usd(pi.amount_received) : "",
        decline: pi.last_payment_error ? (pi.last_payment_error.decline_code || pi.last_payment_error.code || "") : "",
        destination: pi.transfer_data?.destination || "", fee: pi.application_fee_amount != null ? usd(pi.application_fee_amount) : "",
        tds: ch?.payment_method_details?.card?.three_d_secure?.result || "",
      };
    });
    if (dev.pm.startsWith("pm_")) {
      const pm = await stripe.paymentMethods.retrieve(dev.pm).catch(() => null);
      if (pm?.card) out.card = `${pm.card.brand} •••• ${pm.card.last4}`;
    }
    const subs = await stripe.subscriptions.list({ customer: dev.customer, status: "all", limit: 3, expand: ["data.latest_invoice"] });
    out.subscriptions = subs.data.map((s) => {
      const item = s.items.data[0];
      const inv = typeof s.latest_invoice === "object" ? s.latest_invoice : null;
      return { id: s.id, status: s.status, amount: item?.price ? `${usd(item.price.unit_amount || 0)}/${item.price.recurring?.interval || ""}` : "", periodEnd: item?.current_period_end || s.current_period_end || null, invoice: inv && { id: inv.id, status: inv.status, amount: usd(inv.amount_paid || inv.amount_due || 0), created: inv.created } };
    });
    const ids = new Set(out.payments.map((p) => p.id));
    const ds = await stripe.disputes.list({ limit: 20 });
    out.disputes = ds.data.filter((d) => ids.has(typeof d.payment_intent === "string" ? d.payment_intent : d.payment_intent?.id)).map((d) => ({ id: d.id, amount: usd(d.amount), status: d.status, reason: d.reason, pi: d.payment_intent, created: d.created }));
  }
  for (const t of testers) {
    if (!t.account) { out.accounts.push({ name: t.name, account: "", note: "no Stripe account yet" }); continue; }
    const a = await stripe.accounts.retrieve(t.account).catch((e) => ({ error: e.message }));
    out.accounts.push({ name: t.name, account: t.account, details: !!a.details_submitted, payouts: !!a.payouts_enabled, transfers: a.capabilities?.transfers || "inactive", due: (a.requirements?.currently_due || []).length });
    const tr = await stripe.transfers.list({ destination: t.account, limit: 8 });
    for (const x of tr.data) out.transfers.push({ id: x.id, to: t.name, account: t.account, amount: usd(x.amount), created: x.created, source: typeof x.source_transaction === "string" ? x.source_transaction : x.source_transaction?.id || "", reversed: x.reversed });
  }
  out.transfers.sort((a, b) => b.created - a.created);
  return out;
}
async function emails(ids) {
  const { RESEND_API_KEY: k } = parse();
  const out = [];
  for (const id of ids) {
    const r = await fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${k}` } });
    const j = await r.json().catch(() => ({}));
    out.push({ id, to: (j.to || []).join(", "), subject: j.subject || "", last_event: j.last_event || (r.ok ? "" : `error ${r.status}`), created: j.created_at || "" });
  }
  return out;
}
const PAGE = (title) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stripe (test mode) viewer</title>
<style>
:root{--bg:#f6f8fb;--card:#fff;--ink:#1a2233;--mute:#6b7385;--line:#e3e8ef;--ok:#0e7a3a;--okb:#d9f5e3;--warn:#8a5a00;--warnb:#fff1cc;--bad:#a1122b;--badb:#fde2e6;--mb:#eceff4}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.35 system-ui,Segoe UI,Arial,sans-serif}
header{background:#1d2340;color:#fff;padding:10px 14px}header b{font-size:15px}.tm{display:inline-block;background:#f5a524;color:#1d2340;font-weight:700;font-size:11px;padding:1px 6px;border-radius:4px;margin-left:6px;vertical-align:1px}
header p{margin:4px 0 0;font-size:12px;color:#c9cfe6}
section{background:var(--card);margin:10px;border:1px solid var(--line);border-radius:8px}
h2{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--mute);margin:0;padding:8px 12px;border-bottom:1px solid var(--line)}
.row{padding:7px 12px;border-bottom:1px solid var(--line)}.row:last-child{border-bottom:0}.top{display:flex;gap:8px;align-items:center}.amt{font-weight:700;min-width:64px}
.id{font:12px ui-monospace,Consolas,monospace;color:var(--mute);word-break:break-all}.d{color:var(--mute);font-size:12px}
.pill{font-size:12px;font-weight:600;padding:1px 8px;border-radius:10px;margin-left:auto;white-space:nowrap}.ok{color:var(--ok);background:var(--okb)}.warn{color:var(--warn);background:var(--warnb)}.bad{color:var(--bad);background:var(--badb)}.mute{color:var(--mute);background:var(--mb)}
.new{animation:flash 2.5s}@keyframes flash{0%{background:#fff7c2}100%{background:transparent}}
.empty{padding:8px 12px;color:var(--mute);font-size:13px}
</style></head><body><header><b>Stripe</b><span class="tm">TEST MODE</span><p>${title ? title.replace(/</g, "&lt;") + " · " : ""}read live from Stripe's API with the test key (a local viewer, not the Stripe Dashboard)</p></header><main id="m"><div class="empty">Loading…</div></main>
<script>
const seen=new Set();let first=true;
const t=(s)=>s?new Date(s*1000).toLocaleTimeString([], {hour:"numeric",minute:"2-digit",second:"2-digit"}):"";
const esc=(s)=>String(s??"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
function row(key,html){const n=!first&&!seen.has(key);seen.add(key);return '<div class="row'+(n?' new':'')+'" data-key="'+esc(key)+'">'+html+'</div>';}
async function draw(){
  let d;try{d=await (await fetch("/data"+location.search)).json();}catch(e){return;}
  let h="";
  if(d.dev){h+='<section><h2>Payments · '+esc(d.dev.name)+(d.dev.customer?' · '+esc(d.dev.customer):' · no Stripe customer yet')+'</h2>';
    if(d.card)h+='<div class="row d">Card on file: <b>'+esc(d.card)+'</b></div>';
    h+=d.payments.length?d.payments.map(p=>row(p.id+p.w,'<div class="top"><span class="amt">'+p.amount+'</span><span>'+esc(p.description||"")+'</span><span class="pill '+p.c+'">'+p.w+'</span></div><div class="id">'+p.id+' · '+t(p.created)+(p.card?' · '+esc(p.card):'')+'</div>'+((p.manual||p.decline||p.destination||p.tds)?'<div class="d">'+[p.manual?'capture: manual'+(p.captured?' · captured '+p.captured:''):'',p.decline?'declined: '+esc(p.decline):'',p.tds?'3D Secure: '+esc(p.tds):'',p.destination?'to '+esc(p.destination)+(p.fee?' · platform fee '+p.fee:''):''].filter(Boolean).join(' · ')+'</div>':''))).join(""):'<div class="empty">No payments yet</div>';
    h+='</section>';
    if(d.disputes.length)h+='<section><h2>Disputes</h2>'+d.disputes.map(x=>row(x.id+x.status,'<div class="top"><span class="amt">'+x.amount+'</span><span>'+esc(x.reason)+'</span><span class="pill bad">'+esc(x.status.replace(/_/g," "))+'</span></div><div class="id">'+x.id+' · on '+esc(x.pi)+'</div>')).join("")+'</section>';
    if(d.subscriptions.length)h+='<section><h2>Subscriptions</h2>'+d.subscriptions.map(s=>row(s.id+s.status+(s.invoice&&s.invoice.id),'<div class="top"><span class="amt">'+esc(s.amount)+'</span><span>'+esc(s.id)+'</span><span class="pill '+(s.status==="active"?"ok":"warn")+'">'+esc(s.status)+'</span></div>'+(s.invoice?'<div class="d">Latest invoice '+esc(s.invoice.id)+' · '+esc(s.invoice.status)+' · '+s.invoice.amount+' · '+t(s.invoice.created)+'</div>':'')+(s.periodEnd?'<div class="d">Current period ends '+new Date(s.periodEnd*1000).toLocaleString()+'</div>':''))).join("")+'</section>';
  }
  if(d.accounts.length){h+='<section><h2>Connected accounts (testers)</h2>'+d.accounts.map(a=>row(a.account+a.payouts+a.transfers,'<div class="top"><span>'+esc(a.name)+'</span><span class="pill '+(a.payouts&&a.transfers==="active"?"ok":"warn")+'">'+(a.account?(a.payouts&&a.transfers==="active"?"Payouts enabled":a.details?"Restricted":"Onboarding not finished"):"Not created")+'</span></div><div class="id">'+esc(a.account||a.note)+(a.account?' · transfers '+esc(a.transfers)+(a.due?' · '+a.due+' items due':''):'')+'</div>')).join("")+'</section>';
    h+='<section><h2>Transfers to testers</h2>'+(d.transfers.length?d.transfers.map(x=>row(x.id,'<div class="top"><span class="amt">'+x.amount+'</span><span>to '+esc(x.to)+'</span><span class="pill ok">Paid</span></div><div class="id">'+x.id+' · '+t(x.created)+(x.source?' · from '+esc(x.source):'')+'</div>')).join(""):'<div class="empty">No transfers yet</div>')+'</section>';}
  document.getElementById("m").innerHTML=h;first=false;
}
draw();setInterval(draw,1500);
</script></body></html>`;
const EMAIL_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Resend status</title>
<style>body{margin:0;background:#f6f8fb;color:#1a2233;font:14px/1.4 system-ui,Segoe UI,Arial,sans-serif}header{background:#111;color:#fff;padding:10px 14px}header p{margin:4px 0 0;font-size:12px;color:#bbb}
.row{background:#fff;margin:10px;border:1px solid #e3e8ef;border-radius:8px;padding:8px 12px}.id{font:12px ui-monospace,Consolas,monospace;color:#6b7385}.pill{float:right;font-size:12px;font-weight:600;padding:1px 8px;border-radius:10px;background:#d9f5e3;color:#0e7a3a}</style></head>
<body><header><b>Resend</b> · email status<p>read from Resend's API (GET /emails/{id}) for each email the app sent; the key stays on the server</p></header><main id="m">Loading…</main>
<script>const esc=(s)=>String(s??"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
async function draw(){const d=await (await fetch("/emails-data"+location.search)).json();document.getElementById("m").innerHTML=d.map(e=>'<div class="row"><span class="pill">'+esc(e.last_event)+'</span><b>'+esc(e.subject)+'</b><div>to '+esc(e.to)+'</div><div class="id">'+esc(e.id)+' · '+esc(e.created)+'</div></div>').join("")}
draw();setInterval(draw,3000);</script></body></html>`;
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  try {
    if (u.pathname === "/panel") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(PAGE(u.searchParams.get("title") || "")); }
    if (u.pathname === "/data") { const d = await data(u.searchParams); res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(d)); }
    if (u.pathname === "/emails") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(EMAIL_PAGE); }
    if (u.pathname === "/email") {
      // One email as Resend stored it (GET /emails/{id}): its header and its body, for the recording.
      const { RESEND_API_KEY: k } = parse();
      const r = await fetch(`https://api.resend.com/emails/${encodeURIComponent(u.searchParams.get("id") || "")}`, { headers: { Authorization: `Bearer ${k}` } });
      const j = await r.json().catch(() => ({}));
      const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
      const body = j.html ? `<iframe sandbox srcdoc="${esc(j.html)}" style="width:100%;height:640px;border:0;background:#fff"></iframe>` : `<pre style="white-space:pre-wrap;font:14px/1.5 system-ui,Segoe UI,Arial,sans-serif;margin:0;padding:16px;background:#fff">${esc(j.text || "")}</pre>`;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Email from Resend</title></head><body style="margin:0;background:#eef1f5;font:14px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#1a2233">
<div style="background:#111;color:#fff;padding:10px 14px"><b>Resend</b> · the email as sent, read back from Resend's API (GET /emails/{id})</div>
<div style="background:#fff;margin:12px;border:1px solid #dde3ea;border-radius:8px;padding:10px 14px"><div><b>${esc(j.subject)}</b> <span style="float:right;background:#d9f5e3;color:#0e7a3a;font-weight:600;font-size:12px;padding:1px 8px;border-radius:10px">${esc(j.last_event || (r.ok ? "" : "error " + r.status))}</span></div>
<div>From ${esc(j.from)} · to ${esc((j.to || []).join(", "))}</div><div style="font:12px ui-monospace,Consolas,monospace;color:#6b7385">${esc(j.id)} · ${esc(j.created_at)}</div></div>
<div style="margin:12px;border:1px solid #dde3ea;border-radius:8px;overflow:hidden">${body}</div></body></html>`);
    }
    if (u.pathname === "/emails-data") { const d = await emails((u.searchParams.get("ids") || "").split(",").filter(Boolean)); res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(d)); }
    res.writeHead(404); res.end("not found");
  } catch (e) {
    console.error("[viewer]", (e && e.message || "").replace(/(sk|rk|pk)_(test|live)_\w+/g, "[key]"));
    res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "viewer error" }));
  }
}).listen(PORT, "127.0.0.1", () => console.log("viewer on", PORT));
