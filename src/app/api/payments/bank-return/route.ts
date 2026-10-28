// (Batch 17 §11) Where the bank's check returns inside the page's inline frame (the return_url of a PaymentIntent or SetupIntent confirmed for a press or a "Confirm with
// your bank"): a tiny page that tells the page around it the check finished. The page then asks the server how it ended (Stripe decides; nothing here is trusted).
// next.config.ts lets only this path be framed, and only by this site.
export async function GET() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Done</title></head><body style="font:14px system-ui;color:#334155;margin:16px">Done. Checking with your bank…<script>try{window.parent.postMessage({bankCheck:"done"},window.location.origin)}catch(e){}</script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
