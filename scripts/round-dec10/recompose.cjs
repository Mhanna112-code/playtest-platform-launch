// Composes a recording again from its saved parts: node recompose.cjs <temp dir> <name> [log file]
// Reads <name>.plan.json in the temp dir, or (older runs) the step lines and the ffmpeg inputs from the run's log.
const fs = require("fs");
const path = require("path");
const X = require("./lib.cjs");
const [dir, name, log] = process.argv.slice(2);
let plan;
const pf = path.join(dir, `${name}.plan.json`);
if (fs.existsSync(pf)) plan = JSON.parse(fs.readFileSync(pf, "utf8"));
else {
  const text = fs.readFileSync(log, "utf8");
  const m = new RegExp(`-ss ([0-9.]+) -t ([0-9.]+) -i ([^ ]+${name}-0-[0-9]+[.]webm) -ss ([0-9.]+) -t [0-9.]+ -i ([^ ]+${name}-1-[0-9]+[.]webm)`).exec(text);
  if (!m) throw new Error("no inputs in the log");
  const block = text.slice(0, m.index);
  const start = block.lastIndexOf("== ");
  const steps = [...block.slice(start).matchAll(/^   >> ([0-9.]+) s  (.*)$/gm)].map((x) => ({ t: Number(x[1]), text: x[2] }));
  steps[0].ms = 3500;
  plan = { name, title: steps[0].text, steps, end: Number(m[2]), files: [{ file: m[3], from: Number(m[1]), label: "Nora (developer)" }, { file: m[5], from: Number(m[4]), label: "Ana (tester)" }] };
  fs.writeFileSync(pf, JSON.stringify(plan));
}
const D = { name: plan.name, title: plan.title, steps: plan.steps };
X.compose(plan.files, D, plan.end);
X.noteScene(D, { page: plan.page || "" });
console.log("done", name, D.secs, "s");
