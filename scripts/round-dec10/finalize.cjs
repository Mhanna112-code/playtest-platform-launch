// Dec 10 media round: writes the report's NEW section (docs/media/report-manifest.json), the captions (docs/media/captions.json) and
// docs/media/round-dec10/INDEX.md from round-dec10/scenes.json (each video's steps, recorded by rec.cjs) and notes.cjs (Same for / Found / not reachable).
// Older sections and captions are left exactly as they are.
/* eslint-disable */
const fs = require("fs");
const path = require("path");
const MEDIA = path.join(__dirname, "..", "..", "docs", "media");
const OUT = path.join(MEDIA, "round-dec10");
const SECTION = "Overnight Dec 10: one-line stops, invites, two copies, offline";
const EXPLAIN = "The one blue line under a stopped button (the session page, the join page, the test page) with its changes in the top box, the refusals for good and the red mistakes, the two block lines; invites and applications kept open by pauses, fills and edits; two copies of one page; offline presses; Switch / Keep with the newest offer; the pages that keep their full box (account pages, Edit's Save, Home). Nora (developer) and Ana (tester) side by side.";
const scenes = JSON.parse(fs.readFileSync(path.join(OUT, "scenes.json"), "utf8"));
const NOTES = require("./notes.cjs");
const ORDER = NOTES.order;
const list = ORDER.filter((n) => scenes[n] && fs.existsSync(path.join(OUT, `${n}.webm`)));
const missing = ORDER.filter((n) => !list.includes(n));
if (missing.length) console.log("not recorded:", missing.join(", "));
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// captions.json: a new entry per video (the older ones untouched).
const capFile = path.join(MEDIA, "captions.json");
const caps = JSON.parse(fs.readFileSync(capFile, "utf8"));
list.forEach((n, i) => {
  const s = scenes[n], note = NOTES.videos[n] || {};
  caps[`round-dec10/${n}.webm`] = { caption: note.caption || s.title, kind: "video", title: note.title || s.title, section: SECTION, group: "dec10", order: 900000 + i + 1, size: "desktop" };
});
fs.writeFileSync(capFile, JSON.stringify(caps, null, 2));

// report-manifest.json: the new section added (or replaced) at the end; every other section exactly as it was.
const manFile = path.join(MEDIA, "report-manifest.json");
const man = JSON.parse(fs.readFileSync(manFile, "utf8"));
const section = {
  title: SECTION, explanation: EXPLAIN,
  cases: list.map((n) => { const s = scenes[n], note = NOTES.videos[n] || {}; return { title: note.title || s.title, explanation: note.caption || s.title, kind: "video", desktop: `round-dec10/${n}.webm`, phone: null }; }),
};
const at = man.sections.findIndex((x) => x.title === SECTION);
if (at >= 0) man.sections[at] = section;
else man.sections.push(section);
fs.writeFileSync(manFile, JSON.stringify(man, null, 2));

// INDEX.md
const md = [
  "# Overnight Dec 10: one-line stops, invites, two copies, offline",
  "",
  "Desktop recordings (1280x900 windows), Nora (developer) on the left and Ana (tester) on the right unless the video says otherwise (two tabs or two browsers of one person).",
  "Each video has a caption band at the bottom; the steps below are the captions with their time in the video. Every video is here as `.webm` (in the report) and `.mp4`.",
  "Recorded against the media server (fake Stripe, dev outbox) with throwaway accounts. Where a step was set up directly in the database or by an admin off camera, the caption says so.",
  "",
  NOTES.preface || "",
  "",
];
for (const n of list) {
  const s = scenes[n], note = NOTES.videos[n] || {};
  md.push(`## ${note.title || s.title}`, "", `File: \`${n}.webm\` (also \`${n}.mp4\`) · ${fmt(s.secs || 0)}`, "");
  if (note.caption) md.push(note.caption, "");
  md.push("Steps:", "", ...s.steps.map((x) => `- ${x}`), "");
  if (note.sameFor?.length) md.push("Same for:", "", ...note.sameFor.map((x) => `- ${x}`), "");
  if (note.found?.length) md.push("Found:", "", ...note.found.map((x) => `- ${x}`), "");
  if (note.notReachable?.length) md.push("Not reachable (and why):", "", ...note.notReachable.map((x) => `- ${x}`), "");
  if (note.notes?.length) md.push("Notes:", "", ...note.notes.map((x) => `- ${x}`), "");
}
if (NOTES.notReachableGeneral?.length) md.push("## Not reachable now (any page)", "", ...NOTES.notReachableGeneral.map((x) => `- ${x}`), "");
if (NOTES.notRecorded?.length) md.push("## Not recorded", "", ...NOTES.notRecorded.map((x) => `- ${x}`), "");
// Every Found in one list at the end.
const found = list.flatMap((n) => (NOTES.videos[n]?.found ?? []).map((f) => `- ${NOTES.videos[n].title}: ${f}`));
if (found.length) md.push("## All Found", "", ...found, "");
fs.writeFileSync(path.join(OUT, "INDEX.md"), md.join("\n"));
console.log("section", SECTION, "with", list.length, "videos; INDEX.md written");
