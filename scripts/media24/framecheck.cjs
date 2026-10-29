// For every .webm in docs/media: does the picture change size part-way? Playwright pads a smaller screencast frame with gray (#808080) on the right/bottom,
// which is what a full-page screenshot during recording produces. Checks each recorded half's right and bottom strips for uniform gray, at 5 frames a second.
const fs = require("fs"), path = require("path");
const { execFileSync } = require("child_process");
const FF = "C:/Users/march/Projects/playtest-platform/node_modules/ffmpeg-static/ffmpeg.exe";
const DIR = process.argv[2] || "C:/Users/march/Projects/playtest-lite/docs/media";
const only = process.argv.slice(3);
function size(f) {
  const o = (() => { try { execFileSync(FF, ["-hide_banner", "-i", f], { stdio: "pipe" }); return ""; } catch (e) { return String(e.stderr); } })();
  const m = /Video: .*?, (\d+)x(\d+)/.exec(o);
  return m ? [Number(m[1]), Number(m[2])] : null;
}
function halves(w, h) {
  // side by side: two parts scaled to 720 high with an 8 px gap; widths 1024 (desktop) or 332 (phone)
  if (h === 720 && w > 1100) { const a = (w - 8) / 2; return [[0, a], [a + 8, a]]; }
  return [[0, w]];
}
function grayFrames(f, x, wid, h) {
  const sw = Math.max(8, Math.round(wid * 0.05)), sh = Math.max(8, Math.round(h * 0.05));
  const res = [];
  for (const [name, crop] of [["right", `crop=${sw}:${h}:${x + wid - sw - 2}:0`], ["bottom", `crop=${wid - 4}:${sh}:${x + 2}:${h - sh - 2}`]]) {
    let out;
    try { out = execFileSync(FF, ["-hide_banner", "-i", f, "-vf", `fps=5,${crop},signalstats,metadata=print:file=-`, "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 }).toString(); } catch (e) { out = String(e.stdout || ""); }
    let t = 0, n = 0, hits = [];
    const st = {};
    for (const line of out.split(/\r?\n/)) {
      let m = /pts_time:([\d.]+)/.exec(line); if (m) { t = Number(m[1]); continue; }
      m = /lavfi\.signalstats\.(YMIN|YMAX|YAVG|UAVG|VAVG)=([\d.]+)/.exec(line);
      if (m) { st[m[1]] = Number(m[2]); if (m[1] === "VAVG") { n++; if (st.YMAX - st.YMIN < 16 && Math.abs(st.YAVG - 126) < 12 && Math.abs(st.UAVG - 128) < 6 && Math.abs(st.VAVG - 128) < 6) hits.push(t); } }
    }
    if (hits.length) res.push({ strip: name, frames: hits.length, of: n, first: hits[0], last: hits[hits.length - 1] });
  }
  return res;
}
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".webm") && (!only.length || only.some((o) => f.includes(o))));
const bad = [];
for (const f of files) {
  const p = path.join(DIR, f);
  const s = size(p);
  if (!s) { console.log("?", f); continue; }
  const found = [];
  for (const [x, wid] of halves(...s)) for (const r of grayFrames(p, x, wid, s[1])) found.push({ part: x ? "right" : "left", ...r });
  if (found.length) { bad.push(f); console.log("CHANGE", f, JSON.stringify(found)); } else console.log("ok", f);
}
console.log("\nwith a size change:", bad.length, "\n" + bad.join("\n"));
