// Caption-led replacements: original UI footage is preserved in the owner's checkout.
// Run: node scripts/build-social-reels.cjs
const fs = require("node:fs"), path = require("node:path"), { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), out = path.join(root, "launch-reels", "revised"), tmp = path.join(root, ".social-render");
const ffmpeg = process.env.FFMPEG_PATH || "C:/Users/march/Projects/playtest-platform/node_modules/ffmpeg-static/ffmpeg.exe";
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(tmp, { recursive: true });
for (const [from, to] of [["segoeuib.ttf", "bold.ttf"], ["segoeui.ttf", "regular.ttf"]]) fs.copyFileSync(path.join("C:/Windows/Fonts", from), path.join(tmp, to));
let index = 0;
const run = (args) => execFileSync(ffmpeg, ["-y", "-loglevel", "error", ...args], { cwd: tmp, stdio: "inherit" });
const text = (value, x, y, size, color = "white", bold = true) => {
  const file = `text-${index++}.txt`; fs.writeFileSync(path.join(tmp, file), value);
  return `drawtext=fontfile=${bold ? "bold" : "regular"}.ttf:textfile=${file}:expansion=none:fontsize=${size}:fontcolor=${color}:x=${x}:y=${y}`;
};
const reels = [
  { name: "reel-1-post-a-test", audience: "FOR DEVELOPERS", scenes: [
    { title: ["Where do people", "get stuck?"], body: ["Get feedback on your", "game, app or website."], chips: ["Written answers", "Screen recordings", "Live calls"] },
    { title: ["Your test.", "Your questions."], body: ["Choose what to test.", "Set a price for each part."], chips: ["Devices and languages", "Up to 10 testers", "Free to post"] },
    { title: ["Read the work.", "Then review it."], body: ["Pay per piece of feedback.", "Paying less needs a reason."], chips: ["Rules agreed before joining", "On-time listed work can be charged", "Full payment rules on the site"] },
    { title: ["Put your build", "to the test."], body: ["Post your first test.", "Start with one tester."], chips: ["playtestplatform.com"] },
  ] },
  { name: "reel-2-three-ways", audience: "THREE WAYS TO GET FEEDBACK", scenes: [
    { title: ["See what clicks.", "Find what doesn't."], body: ["Choose the kind of feedback", "your product needs."], chips: ["Games", "Apps", "Websites"] },
    { title: ["Answers.", "In their words."], body: ["Ask your own questions.", "Read feedback with attachments."], chips: ["01 / Written answers"] },
    { title: ["Watch the", "sticking points."], body: ["Testers record their screen", "or upload a recording."], chips: ["02 / Screen recordings"] },
    { title: ["Talk it", "through."], body: ["Book a live call in the browser.", "Pay for the measured call time."], chips: ["03 / Live calls", "playtestplatform.com"] },
  ] },
  { name: "reel-4-never-lose-your-work", audience: "DRAFTS THAT COME BACK WITH YOU", scenes: [
    { title: ["Close the tab.", "Keep your draft."], body: ["Your saved, unsent work", "stays with your account."], chips: ["Post a test", "Written answers"] },
    { title: ["Come back.", "Pick it up."], body: ["Return to your saved draft", "and carry on where you left off."], chips: ["Kept on your account", "Across devices"] },
    { title: ["Ready when", "you are."], body: ["Review your saved changes.", "Keep going or start empty."], chips: ["Saved drafts, less retyping"] },
    { title: ["More testing.", "Less retyping."], body: ["Meet Playtest.", "Feedback for your next build."], chips: ["playtestplatform.com"] },
  ] },
];
for (const reel of reels) {
  const segments = [];
  reel.scenes.forEach((scene, i) => {
    const filters = [
      "drawbox=x=0:y=0:w=1080:h=1920:color=0x090e19:t=fill",
      "drawbox=x=710:y=0:w=370:h=1920:color=0x111b2b:t=fill",
      "drawbox=x=64:y=310:w=952:h=1250:color=0x10192a:t=fill",
      "drawbox=x=64:y=310:w=8:h=1250:color=0xb7f65c:t=fill",
      text("PLAYTEST", 100, 180, 46, "0xb7f65c"),
      text(reel.audience, 108, 370, 27, "0xa0afc3"),
      ...scene.title.map((s, n) => text(s, 108, 530 + n * 117, Math.min(91, Math.floor(830 / (s.length * .56))))),
      ...scene.body.map((s, n) => text(s, 108, 855 + n * 68, 43, "0xc2ccda", false)),
      ...scene.chips.flatMap((s, n) => ["drawbox=x=108:y=" + (1100 + n * 93) + ":w=830:h=68:color=0x1b2a3e:t=fill", text(s, 133, 1113 + n * 93, 30, n === 0 ? "0xb7f65c" : "0xe4eaf2")]),
      text(`${String(i + 1).padStart(2, "0")} / 04`, 110, 1478, 25, "0x8ea2bc"),
      "drawbox=x=108:y=1530:w=830:h=3:color=0x31415a:t=fill",
      `drawbox=x=108:y=1530:w=${Math.round(830 * (i + 1) / 4)}:h=3:color=0xb7f65c:t=fill`,
      text("playtestplatform.com", 108, 1650, 36, "0xe4eaf2"),
      "fade=t=in:st=0:d=0.15,fade=t=out:st=3.85:d=0.15,setsar=1",
    ];
    const seg = path.join(tmp, `${reel.name}-${i}.mp4`);
    run(["-f", "lavfi", "-i", "color=c=0x090e19:s=1080x1920:r=30:d=4", "-vf", filters.join(","), "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-an", seg]);
    segments.push(seg);
  });
  const list = path.join(tmp, `${reel.name}.txt`);
  fs.writeFileSync(list, segments.map((s) => `file '${s.replace(/\\/g, "/")}'`).join("\n"));
  const video = path.join(out, `${reel.name}.mp4`);
  run(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", video]);
  run(["-ss", "1", "-i", video, "-frames:v", "1", path.join(out, `${reel.name}-cover.png`)]);
  run(["-i", video, "-vf", "select='eq(n,30)+eq(n,150)+eq(n,270)+eq(n,390)',scale=270:480,tile=4x1:padding=6", "-frames:v", "1", path.join(out, `${reel.name}-review.png`)]);
  console.log(`${reel.name}: 16 seconds, 1080x1920, 30fps`);
}
