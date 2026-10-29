const fs = require("fs");
const F = "C:/Users/march/Projects/playtest-lite/scripts/media.cjs";
let s = fs.readFileSync(F, "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("missing: " + a.slice(0, 80)); s = s.replace(a, () => b); };

// 1. recording contexts: a guarded screenshot
rep(`  await hideDevBadge(c);
  const p = await c.newPage();
  return safeGoto(p);
}`, `  await hideDevBadge(c);
  const p = await c.newPage();
  if (video) guardRecording(p);
  return safeGoto(p);
}`);
rep(`  await hideDevBadge(c);
  return safeGoto(await c.newPage());
}`, `  await hideDevBadge(c);
  const p = await c.newPage();
  if (video) guardRecording(p);
  return safeGoto(p);
}
/**
 * (Oct 29 media run) A video's frame size never changes part-way. Chromium takes a full-page (or taller-than-the-screen) screenshot by growing the page beyond the
 * screen for a moment, and the recording shows that as a shrunken page with grey bars. So on a page that is recording, a screenshot never reaches beyond the screen:
 * a whole page or a tall element is taken from a separate page that isn't recording (same sign-in, same address), and an element that fits on the screen is scrolled
 * into view and taken from the screen as it is (then the scroll goes back). page._raw is the plain screenshot.
 */
function guardRecording(p) {
  const raw = p.screenshot.bind(p);
  p._raw = raw;
  p.screenshot = async (o = {}) => {
    if (!o.fullPage) return raw(o);
    if (o.clip) return capture(p, o.clip, null, o.path);
    return mirrorShot(p, o.path, null);
  };
}
/** The height the sticky header (and any fixed bar at the top) covers. */
const topCover = (page) => page.evaluate(() => {
  let m = 0;
  for (const el of document.querySelectorAll("body *")) {
    const st = getComputedStyle(el);
    if (st.position !== "fixed" && st.position !== "sticky") continue;
    const r = el.getBoundingClientRect();
    if (r.top <= 1 && r.bottom > 0 && r.height < innerHeight / 3 && r.width > innerWidth / 2) m = Math.max(m, r.bottom);
  }
  return Math.ceil(m);
});
/**
 * One clip of the page (document coordinates) saved to \`file\`. Not recording: the usual full-page clip. Recording: from the screen when it fits under the header;
 * otherwise from a separate page (\`remeasure\` finds the same elements there and measures the clip again); if they aren't on that page (a box that only exists
 * after a press), the clip is taken in screen-high strips from the recording page and joined.
 */
async function capture(page, clip, remeasure, file) {
  if (!page.video()) return page.screenshot({ path: file, fullPage: true, clip });
  const raw = page._raw;
  const vp = page.viewportSize();
  const sy0 = await page.evaluate(() => window.scrollY);
  const cover = await topCover(page);
  try {
    if (clip.height <= vp.height - cover) {
      await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, clip.y - cover));
      await page.waitForTimeout(250);
      const sy = await page.evaluate(() => window.scrollY);
      const vy = clip.y - sy;
      if (vy >= (sy > 0 ? cover : 0) - 1 && vy + clip.height <= vp.height + 1) return await raw({ path: file, clip: { ...clip, y: Math.max(0, vy), height: Math.min(clip.height, vp.height - Math.max(0, vy)) } });
    }
    if (remeasure) {
      const done = await mirrorShot(page, file, remeasure);
      if (done) return done;
    }
    return await stitch(page, clip, cover, file);
  } finally {
    await page.evaluate((y) => window.scrollTo(0, y), sy0).catch(() => {});
  }
}
/** A separate page that isn't recording, same sign-in and address: the whole page, or (with \`remeasure\`) the clip measured again there. False when it isn't there. */
async function mirrorShot(page, file, remeasure) {
  const m = await same(page, { viewport: page.viewportSize(), ...(phone() ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}) });
  try {
    await m.goto(page.url());
    await m.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await m.waitForTimeout(1200);
    await closeTimerPopups(m);
    if (!remeasure) return await m.screenshot({ path: file, fullPage: true });
    const clip = await remeasure(m).catch(() => null);
    if (!clip) { console.log("   (the tall picture isn't on a fresh page: taken in strips from the recording page)"); return false; }
    return await m.screenshot({ path: file, fullPage: true, clip });
  } finally {
    await m.context().close().catch(() => {});
  }
}
/** The clip in screen-high strips (scrolling the recording page, never resizing it), joined top to bottom with ffmpeg. */
async function stitch(page, clip, cover, file) {
  const vp = page.viewportSize();
  const parts = [];
  let y = clip.y, left = clip.height, i = 0;
  while (left > 0.5) {
    await page.evaluate((t) => window.scrollTo(0, t), Math.max(0, y - cover));
    await page.waitForTimeout(250);
    const sy = await page.evaluate(() => window.scrollY);
    let vy = y - sy;
    const minTop = sy > 0 ? cover : 0;
    if (vy < minTop) vy = minTop;
    const h = Math.min(left, vp.height - vy);
    if (h < 1) break;
    const part = path.join(VTMP, \`stitch-\${Date.now()}-\${i++}.png\`);
    await page._raw({ path: part, clip: { x: clip.x, y: vy, width: clip.width, height: h } });
    parts.push(part);
    y += h;
    left -= h;
  }
  if (parts.length === 1) fs.copyFileSync(parts[0], file);
  else execFileSync(FFMPEG, ["-y", "-loglevel", "error", ...parts.flatMap((p) => ["-i", p]), "-filter_complex", \`vstack=inputs=\${parts.length}\`, file]);
  return true;
}`);

// 2. shot(): the element clip through capture()
rep(`    const x = phone() ? 0 : Math.max(0, b.x - pad), width = phone() ? page.viewportSize().width : Math.min(page.viewportSize().width - x, b.width + 2 * pad);
    await page.screenshot({ path: path.join(OUT, file), fullPage: true, clip: { x, y, width, height: b.height + 2 * pad } });`, `    const x = phone() ? 0 : Math.max(0, b.x - pad), width = phone() ? page.viewportSize().width : Math.min(page.viewportSize().width - x, b.width + 2 * pad);
    const sel = typeof target === "string" ? target : loc._selector;
    // (a fresh page measures the same element again, from the top of the page, when the picture is taller than the screen)
    const remeasure = after ? null : async (m) => {
      const l = m.locator(sel).first();
      await l.waitFor({ state: "visible", timeout: 8000 });
      await m.evaluate(() => window.scrollTo(0, 0));
      await innerScroll(l);
      const bb = await l.boundingBox();
      const my = await m.evaluate(() => window.scrollY);
      const mx = phone() ? 0 : Math.max(0, bb.x - pad);
      return { x: mx, y: Math.max(0, bb.y + my - pad), width: phone() ? m.viewportSize().width : Math.min(m.viewportSize().width - mx, bb.width + 2 * pad), height: bb.height + 2 * pad };
    };
    await capture(page, { x, y, width, height: b.height + 2 * pad }, remeasure, path.join(OUT, file));`);

// 3. shotFull(): a recording page's whole page comes from a separate page
rep(`  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  record(file, caption, "image");
  return file;
}`, `  if (page.video()) await mirrorShot(page, path.join(OUT, file), null);
  else await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  record(file, caption, "image");
  return file;
}`);

// 4. shotSpan(): through capture()
rep(`  await page.screenshot({ path: path.join(OUT, file), fullPage: true, clip: { x, y, width: Math.min(page.viewportSize().width - x, right - x), height: bottom - y } });
  record(file, caption, "image");`, `  const [sa, sb] = [a._selector, b._selector];
  const remeasure = async (m) => {
    const [la, lb] = [m.locator(sa).first(), m.locator(sb).first()];
    await la.waitFor({ state: "visible", timeout: 8000 });
    await lb.waitFor({ state: "visible", timeout: 8000 });
    await m.evaluate(() => window.scrollTo(0, 0));
    const [qa, qb] = [await la.boundingBox(), await lb.boundingBox()];
    const my = await m.evaluate(() => window.scrollY);
    const mx = phone() ? 0 : Math.max(0, Math.min(qa.x, qb.x) - 12), mr = phone() ? m.viewportSize().width : Math.max(qa.x + qa.width, qb.x + qb.width) + 12;
    const t = Math.max(0, Math.min(qa.y, qb.y) + my - padTop), bt = Math.max(qa.y + qa.height, qb.y + qb.height) + my + padBottom;
    return { x: mx, y: t, width: Math.min(m.viewportSize().width - mx, mr - mx), height: bt - t };
  };
  await capture(page, { x, y, width: Math.min(page.viewportSize().width - x, right - x), height: bottom - y }, remeasure, path.join(OUT, file));
  record(file, caption, "image");`);

// 5. the browser: fake camera and microphone (batch 21's call room), allowed without a prompt
rep(`browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge" });`, `browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });`);
fs.writeFileSync(F, s);
console.log("patched");
