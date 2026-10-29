// Can two separate Chrome browsers on this machine connect with WebRTC? Signalling done by the script.
const { chromium } = require("C:/Users/march/Projects/playtest-platform/node_modules/playwright");
const variants = {
  mdnsOff: ["--disable-features=WebRtcHideLocalIpsWithMdns"],
  loopback: ["--disable-features=WebRtcHideLocalIpsWithMdns", "--allow-loopback-in-peer-connection"],
  same: null,
};
(async () => {
  for (const [name, flags] of Object.entries(variants)) {
    const base = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];
    const b1 = await chromium.launch({ channel: "chrome", args: [...base, ...(flags || [])] });
    const b2 = flags ? await chromium.launch({ channel: "chrome", args: [...base, ...flags] }) : b1;
    const [p1, p2] = [await (await b1.newContext()).newPage(), await (await b2.newContext()).newPage()];
    for (const p of [p1, p2]) await p.setContent("<p>x</p>");
    const setup = (offerer) => {
      window.pc = new RTCPeerConnection({ iceServers: [] });
      window.cands = [];
      window.pc.onicecandidate = (e) => { if (e.candidate) window.cands.push(e.candidate.toJSON()); };
      window.pc.createDataChannel("x");
    };
    await p1.evaluate(setup, true);
    await p2.evaluate(setup, false);
    const offer = await p1.evaluate(async () => { await pc.setLocalDescription(await pc.createOffer()); await new Promise((r) => setTimeout(r, 1500)); return pc.localDescription.toJSON(); });
    const answer = await p2.evaluate(async (o) => { await pc.setRemoteDescription(o); await pc.setLocalDescription(await pc.createAnswer()); await new Promise((r) => setTimeout(r, 1500)); return pc.localDescription.toJSON(); }, offer);
    await p1.evaluate(async (a) => pc.setRemoteDescription(a), answer);
    const c1 = await p1.evaluate(() => cands), c2 = await p2.evaluate(() => cands);
    await p2.evaluate(async (cs) => { for (const c of cs) await pc.addIceCandidate(c).catch(() => {}); }, c1);
    await p1.evaluate(async (cs) => { for (const c of cs) await pc.addIceCandidate(c).catch(() => {}); }, c2);
    let st = "";
    for (let i = 0; i < 20; i++) { st = await p1.evaluate(() => pc.connectionState); if (st === "connected" || st === "failed") break; await new Promise((r) => setTimeout(r, 1000)); }
    console.log(name, st, "cands", c1.map((c) => c.candidate.split(" ").slice(4, 8).join(" ")).join(" | "));
    await b1.close(); if (b2 !== b1) await b2.close();
  }
  process.exit(0);
})();
