const { chromium } = require("C:/Users/march/Projects/playtest-platform/node_modules/playwright");
(async () => {
  for (const [ch, args] of [["msedge", []], ["msedge", ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]], ["chrome", []], [undefined, []]]) {
    try { const b = await chromium.launch({ channel: ch, args }); console.log(ch, args.length, "ok"); await b.close(); } catch (e) { console.log(ch, args.length, "FAIL", String(e.message).split("\n")[0]); }
  }
})();
