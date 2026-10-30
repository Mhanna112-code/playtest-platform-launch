// ---------- (Oct 29 late media run) Screenshots only: nothing records video, and every picture is cut from the screen as it is ----------
// (A full-page screenshot resizes the page for a moment, and the boxes sized to the screen (Needs you, the tester rows) lay out differently then:
// a picture of a stop box came out cut. So a clip is taken from the screen, scrolled into view, or in screen-high strips when taller.)
{
  rec = async (opts = V, from) => { const t0 = Date.now(); const page = from ? await same(from, opts) : await ctx(opts); page.t0 = t0; return page; };
  saveVideo = async (page, file) => { await page.context().close().catch(() => {}); return file; };
  finishVideo = (parts, name) => { console.log(`   (screenshots only: no video ${name})`); };
  capture = async (page, clip, remeasure, file) => {
    if (!page._raw) page._raw = page.screenshot.bind(page);
    const vp = page.viewportSize();
    const sy0 = await page.evaluate(() => window.scrollY);
    const cover = await topCover(page);
    try {
      if (clip.height <= vp.height - cover) {
        await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, clip.y - cover));
        await page.waitForTimeout(250);
        const sy = await page.evaluate(() => window.scrollY);
        const vy = clip.y - sy;
        if (vy >= (sy > 0 ? cover : 0) - 1 && vy + clip.height <= vp.height + 1) return await screenCrop(page, { ...clip, y: Math.max(0, vy), height: Math.min(clip.height, vp.height - Math.max(0, vy)) }, file);
      }
      return await stitch(page, clip, cover, file);
    } finally {
      await page.evaluate((y) => window.scrollTo(0, y), sy0).catch(() => {});
    }
  };
}
