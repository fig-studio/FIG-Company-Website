/*
 * Browser checks for the vision card lab page.
 *
 *   python3 -m http.server 8765 &        # from the repo root
 *   node tools/vision-card/check.js [out-dir] [base-url]
 *
 * Needs Playwright with Chromium. Writes screenshots to out-dir (default
 * ./vision-card-shots) and exits non-zero if any check fails.
 */
const { chromium } = require('playwright');
const fs = require('fs');

const OUT = process.argv[2] || 'vision-card-shots';
const BASE = (process.argv[3] || 'http://localhost:8765') + '/labs/vision-card.html';
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
}

function watch(page, errs) {
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(e.message));
}

async function ready(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('html[data-ready]');
  await page.evaluate(() => document.fonts.ready); // text must not reflow between compared shots
}

const frames = page => page.evaluate(() => __vc.cards.map(c => c.frames));
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: GL_ARGS });

  // ---------------------------------------------------------------- desktop
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page, errs);

  // Replay: same T twice gives the same pixels; a sequence of fixed frames.
  await ready(page, BASE + '?panel=0&replay=1.2');
  const a = await page.locator('.stage').screenshot();
  await ready(page, BASE + '?panel=0&replay=1.2');
  const b = await page.locator('.stage').screenshot();
  check('replay is deterministic at T=1.2', a.equals(b));
  for (const T of [0, 0.6, 1.2, 1.8, 2.4, 3.2, 3.8, 4.4, 5.2]) {
    await page.evaluate(t => __vc.freeze(t), T);
    await page.locator('.stage').screenshot({ path: `${OUT}/replay-${T.toFixed(1)}.png` });
  }
  const st = await page.evaluate(() => { __vc.freeze(5.9); return __vc.cards.map(c => ({ boxes: c.boxes.length, hover: c.hover })); });
  check('everything has faded 1.9 s after the path leaves', st.every(s => s.boxes === 0 && s.hover < 0.02), JSON.stringify(st));

  // Live: real mouse across card A, fast switch to B, out.
  await ready(page, BASE + '?panel=0');
  const ra = await page.locator('#card-discord').boundingBox();
  const rb = await page.locator('#card-liveblocks').boundingBox();
  let maxBoxes = 0;
  await page.mouse.move(ra.x - 20, ra.y + 120);
  for (let i = 0; i <= 40; i++) {
    await page.mouse.move(ra.x + ra.width * (0.1 + 0.8 * i / 40), ra.y + ra.height * (0.25 + 0.3 * Math.sin(i / 6)));
    await wait(16);
    maxBoxes = Math.max(maxBoxes, ...(await page.evaluate(() => __vc.cards.map(c => c.boxes.filter(b => b.a > 0.99).length))));
  }
  const midA = await page.evaluate(() => ({ hover: __vc.cards[0].hover, boxes: __vc.cards[0].boxes.length, other: __vc.cards[1].hover }));
  check('hover on A lights A only', midA.hover > 0.9 && midA.other === 0, JSON.stringify(midA));
  check('boxes appear while moving', midA.boxes > 0, 'boxes=' + midA.boxes);
  check('fully shown boxes never exceed maxBoxes (4)', maxBoxes <= 4, 'max=' + maxBoxes);
  await page.locator('.stage').screenshot({ path: `${OUT}/live-hover-a.png` });

  // Fast switch: jump straight onto B.
  await page.mouse.move(rb.x + 30, rb.y + rb.height * 0.5);
  await wait(30);
  const sw = await page.evaluate(() => {
    const [A, B] = __vc.cards;
    return { aInside: A.ptr.inside, bInside: B.ptr.inside, bSm: [Math.round(B.sm.x), Math.round(B.sm.y)], bPtr: [Math.round(B.ptr.x), Math.round(B.ptr.y)] };
  });
  check('switch: A released, B tracked', !sw.aInside && sw.bInside, JSON.stringify(sw));
  check('switch: B pointer starts where the mouse entered (no streak)', Math.abs(sw.bSm[0] - sw.bPtr[0]) < 6 && Math.abs(sw.bSm[1] - sw.bPtr[1]) < 6, JSON.stringify(sw));
  for (let i = 0; i < 6; i++) { // rapid in/out flicker
    await page.mouse.move(ra.x + ra.width - 5, ra.y + 200);
    await page.mouse.move(rb.x + 5, rb.y + 200);
  }
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height + 80); // leave
  const leave0 = await page.evaluate(() => __vc.cards[1].hover);
  await wait(150);
  const leave1 = await page.evaluate(() => __vc.cards[1].hover);
  check('leave decays gradually, not instantly', leave1 > 0.05 && leave1 < leave0, `${leave0.toFixed(2)} -> ${leave1.toFixed(2)}`);
  await wait(2500);
  const leave2 = await page.evaluate(() => __vc.cards.map(c => ({ hover: +c.hover.toFixed(3), boxes: c.boxes.length })));
  check('leave fully recovers', leave2.every(s => s.hover < 0.01 && s.boxes === 0), JSON.stringify(leave2));

  // Links stay clickable over the effect layers.
  const hit = await page.evaluate(() => {
    const a = document.querySelector('#card-discord .vcard__cta');
    const r = a.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2).closest('a') === a;
  });
  check('link is the hit target at its own centre', hit);
  await page.click('#card-liveblocks .vcard__cta');
  check('link click navigates', page.url().endsWith('#liveblocks'), page.url());

  // Idle flow keeps running; off-screen pauses it.
  const f0 = await frames(page); await wait(300); const f1 = await frames(page);
  check('idle flow animates on desktop', f1[0] > f0[0] + 3, `${f0[0]} -> ${f1[0]}`);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => { document.body.style.paddingTop = '3000px'; window.scrollTo(0, 0); });
  await wait(200);
  const g0 = await frames(page); await wait(400); const g1 = await frames(page);
  check('off-screen cards stop rendering', g1[0] === g0[0] && g1[1] === g0[1], `${g0} -> ${g1}`);
  await page.evaluate(() => { document.body.style.paddingTop = ''; });

  // Resize redraws at the new size.
  await page.setViewportSize({ width: 700, height: 800 });
  await wait(300);
  const sz = await page.evaluate(() => __vc.cards.map(c => [c.canvas.width, Math.round(c.w * c.dpr)]));
  check('canvas follows resize', sz.every(([cw, want]) => cw === want), JSON.stringify(sz));

  // Unmount releases everything.
  const gone = await page.evaluate(() => {
    __vc.cards.forEach(c => c.destroy());
    return { art: document.querySelectorAll('.vcard__art').length, lost: __vc.cards.every(c => c.gl.isContextLost()) };
  });
  check('destroy removes layers and releases the GL context', gone.art === 0 && gone.lost, JSON.stringify(gone));
  check('desktop: no console errors', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ---------------------------------------------------------------- mobile
  const merrs = [];
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  watch(mp, merrs);
  await ready(mp, BASE + '?panel=0');
  await wait(300);
  await mp.screenshot({ path: `${OUT}/mobile.png` });
  const m0 = await frames(mp); await wait(400); const m1 = await frames(mp);
  check('mobile: static pattern, no idle loop', m1[0] === m0[0], `${m0} -> ${m1}`);
  const mr = await mp.locator('#card-discord').boundingBox();
  await mp.touchscreen.tap(mr.x + mr.width * 0.5, mr.y + mr.height * 0.4);
  await wait(120);
  const tapState = await mp.evaluate(() => ({ boxes: __vc.cards[0].boxes.length, frames: __vc.cards[0].frames }));
  await mp.screenshot({ path: `${OUT}/mobile-tap.png` });
  check('mobile: tap gives a short pulse and boxes', tapState.boxes > 0, JSON.stringify(tapState));
  await wait(2200);
  const t0 = await frames(mp); await wait(300); const t1 = await frames(mp);
  check('mobile: loop stops again after the pulse', t1[0] === t0[0], `${t0} -> ${t1}`);
  const ta = await mp.evaluate(() => getComputedStyle(document.querySelector('.vcard')).touchAction);
  check('mobile: card leaves scrolling alone (touch-action)', ta === 'auto', ta);
  check('mobile: no console errors', merrs.length === 0, merrs.join(' | '));
  await mctx.close();

  // ---------------------------------------------------------------- reduced motion
  const rctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const rp = await rctx.newPage();
  await ready(rp, BASE + '?panel=0');
  await wait(200);
  const r0 = await frames(rp); await wait(400); const r1 = await frames(rp);
  check('reduced motion: no idle loop', r1[0] === r0[0], `${r0} -> ${r1}`);
  const rr = await rp.locator('#card-discord').boundingBox();
  for (let i = 0; i < 20; i++) { await rp.mouse.move(rr.x + 40 + i * 12, rr.y + 150); await wait(16); }
  const rb2 = await rp.evaluate(() => ({ boxes: __vc.cards[0].boxes.length, hover: __vc.cards[0].hover }));
  check('reduced motion: brightening only, no boxes', rb2.boxes === 0 && rb2.hover > 0.5, JSON.stringify(rb2));
  await rctx.close();

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
