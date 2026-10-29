const fs = require("fs");
const F = __dirname + "/parts/b2122.js";
let s = fs.readFileSync(F, "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("missing " + a.slice(0, 70)); s = s.split(a).join(b); };
rep(`  const rgroup = (id, fn, opts) => group(id, async () => {
    for (let n = 0; ; n++) {`, `  /** (The media server answers slowly tonight: every page these groups open waits longer than the harness's usual 15 / 45 seconds.) */
  let patient = false;
  const bePatient = async () => {
    if (patient) return;
    const tmp = await browser.newContext();
    const proto = Object.getPrototypeOf(tmp);
    await tmp.close();
    const [t0, n0] = [proto.setDefaultTimeout, proto.setDefaultNavigationTimeout];
    proto.setDefaultTimeout = function (ms) { return t0.call(this, Math.max(ms, 60000)); };
    proto.setDefaultNavigationTimeout = function (ms) { return n0.call(this, Math.max(ms, 150000)); };
    patient = true;
  };
  const rgroup = (id, fn, opts) => group(id, async () => {
    await bePatient();
    for (let n = 0; ; n++) {`);
fs.writeFileSync(F, s);
console.log("ok");
