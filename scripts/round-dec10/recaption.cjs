// Changes one caption of a saved recording's plan (the step whose text contains `find`), then compose again with recompose.cjs:
//   node recaption.cjs <temp dir> <name> "<part of the old caption>" "<new caption>"
const fs = require("fs");
const path = require("path");
const [dir, name, find, text] = process.argv.slice(2);
const f = path.join(dir, `${name}.plan.json`);
const plan = JSON.parse(fs.readFileSync(f, "utf8"));
const step = plan.steps.find((s) => s.text.includes(find));
if (!step) throw new Error("no caption with: " + find);
step.text = text;
fs.writeFileSync(f, JSON.stringify(plan));
console.log("changed:", text);
