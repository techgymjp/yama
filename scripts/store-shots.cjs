// Google Play 用の画像を撮影する（Web 版を Playwright で自動操作）
//   npm run build && npx vite preview --port 4173 --outDir www   を別に起動しておき、
//   node scripts/store-shots.cjs   を実行すると docs/store/ に保存される
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const URL = process.env.SHOT_URL || 'http://localhost:4173/';
const OUT = path.join(__dirname, '..', 'docs', 'store');
fs.mkdirSync(OUT, { recursive: true });

// 撮影用: トーストの表示時間を延ばさない・ログを止めるなど、画面の状態だけを整える
async function openGame(browser, lang, { geo } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 960, height: 540 }, deviceScaleFactor: 2, locale: lang === 'en' ? 'en-US' : 'ja-JP',
    ...(geo ? { geolocation: geo, permissions: ['geolocation'] } : {}),
  });
  await ctx.addInitScript((l) => { try { localStorage.setItem('yama.lang', l); localStorage.setItem('yama.difficulty', 'normal'); } catch (e) {} }, lang);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('pageerror:', e.message));
  await p.goto(URL);
  await p.waitForTimeout(400);
  return p;
}
async function startFrom(p, search) {
  await p.click('#btn-start-place');
  await p.fill('#search', search); await p.dispatchEvent('#search', 'change');
  await p.click('#btn-picker-ok');
  await p.waitForFunction(() => window.__yama && window.__yama.game.target, null, { timeout: 150000 });
  await p.waitForTimeout(4800); // 開始時のお知らせが消えるまで
}
async function startDeck(p, index) {
  await p.click('#btn-start-place');
  await p.selectOption('#deck-select', { index });
  await p.click('#btn-picker-ok');
  await p.waitForFunction(() => window.__yama && window.__yama.game.target, null, { timeout: 150000 });
  await p.waitForTimeout(4800);
}
// お題をその山にして、山が見える向きにする
async function questFor(p, name, { dh = 0, fov, at = 0.56 } = {}) {
  await p.evaluate(({ name, dh, fov, at }) => {
    const s = window.__yama;
    const t = s.peaks.find((x) => x.name === name && x.visible);
    s.game.target = t; s.game.misses = 0; s.game.hinted = false; s.game.revealed = false;
    if (fov) s.fov = fov;
    s.heading = (t.az + dh + 360) % 360;
    const f = innerWidth / (s.fov * Math.PI / 180);
    // 山頂を画面の上から at の位置に
    s.pitch = Math.atan(t.tanAlt + (at - 0.5) * innerHeight / f) * 180 / Math.PI;
    window.dispatchEvent(new Event('resize'));
  }, { name, dh, fov, at });
  await p.waitForTimeout(3500);
}
async function setQuestText(p, lang, { name, nameEn, sub, subEn, n }) {
  await p.evaluate(({ lang, name, nameEn, sub, subEn, n }) => {
    const $ = (id) => document.getElementById(id);
    $('quest-prefix').textContent = lang === 'en' ? 'Find ' : '';
    $('quest-name').textContent = lang === 'en' ? nameEn : name;
    $('quest-suffix').textContent = lang === 'en' ? `! (Q${n})` : `を探して！（第${n}問）`;
    $('quest-sub').textContent = lang === 'en' ? subEn : sub;
  }, { lang, name, nameEn, sub, subEn, n });
}
async function tapTarget(p) {
  const pos = await p.evaluate(() => {
    const s = window.__yama, t = s.game.target, f = innerWidth / (s.fov * Math.PI / 180);
    return {
      x: innerWidth / 2 + ((((t.az - s.heading) + 540) % 360) - 180) * Math.PI / 180 * f,
      y: innerHeight / 2 - f * (t.tanAlt - Math.tan(s.pitch * Math.PI / 180)) + 8,
    };
  });
  await p.mouse.click(pos.x, pos.y);
  await p.waitForTimeout(450);
}
const shot = (p, file) => p.screenshot({ path: path.join(OUT, file) });

(async () => {
  const browser = await chromium.launch();
  for (const lang of ['ja', 'en']) {
    // 1. トップ画面
    {
      const p = await openGame(browser, lang);
      await shot(p, `${lang}-1-top.png`);
      await p.context().close();
    }
    // 2. 三ツ峠山から富士山を探して正解
    {
      const p = await openGame(browser, lang);
      await startFrom(p, '三ツ峠山');
      await p.evaluate(() => { const g = window.__yama.game; g.round = 3; g.points = 180; g.correct = 2; g.totalMs = 21000; g.qStart = performance.now() - 6400; });
      await questFor(p, '富士山', { dh: 9, fov: 44, at: 0.42 });
      await setQuestText(p, lang, { name: '富士山', nameEn: 'Mt. Fuji', sub: 'ふじさん・山梨県・静岡県・標高3776m・日本百名山', subEn: 'Yamanashi / Shizuoka · 3776 m · 100 Famous Mountains', n: 3 });
      await tapTarget(p);
      await shot(p, `${lang}-2-fuji.png`);
      await p.context().close();
    }
    // 3. 木曽駒ヶ岳から南アルプスと富士山（山名表示）
    {
      const p = await openGame(browser, lang);
      await startFrom(p, '木曽駒ヶ岳');
      await p.evaluate(() => { const g = window.__yama.game; g.round = 5; g.points = 380; g.correct = 4; g.totalMs = 52000; g.qStart = performance.now() - 3200; });
      await questFor(p, '北岳', { dh: 10, fov: 34 });
      await setQuestText(p, lang, { name: '北岳', nameEn: 'Kitadake', sub: 'きただけ・山梨県・標高3193m・日本百名山', subEn: 'Yamanashi · 3193 m · 100 Famous Mountains', n: 5 });
      await p.click('#btn-labels'); await p.waitForTimeout(800);
      await shot(p, `${lang}-3-alps.png`);
      await p.context().close();
    }
    // 4. 東京スカイツリー天望回廊から富士山の方角（展望台から見る）
    {
      const p = await openGame(browser, lang);
      await startDeck(p, 1);
      await p.evaluate(() => { const g = window.__yama.game; g.round = 2; g.points = 100; g.correct = 1; g.totalMs = 9800; g.qStart = performance.now() - 4100; });
      await questFor(p, '富士山', { dh: 3, fov: 16, at: 0.5 });
      await setQuestText(p, lang, { name: '富士山', nameEn: 'Mt. Fuji', sub: 'ふじさん・山梨県・静岡県・標高3776m・日本百名山', subEn: 'Yamanashi / Shizuoka · 3776 m · 100 Famous Mountains', n: 2 });
      await p.click('#btn-labels'); await p.waitForTimeout(800);
      await shot(p, `${lang}-4-skytree.png`);
      await p.context().close();
    }
    // 5. 結果画面（点数は撮影用の値）
    {
      const p = await openGame(browser, lang);
      await startFrom(p, '三ツ峠山');
      const names = lang === 'en'
        ? ['Mt. Fuji', 'Kitadake', 'Mt. Tanzawa', 'Ainotake', 'Yarigatake', 'Mt. Kinpu', 'Mt. Tateshina', 'Akadake', 'Mt. Daibosatsu', 'Mt. Kumotori']
        : ['富士山', '北岳', '丹沢山', '間ノ岳', '槍ヶ岳', '金峰山', '蓼科山', '赤岳', '大菩薩嶺', '雲取山'];
      const pts = [100, 100, 80, 100, 60, 100, 100, 0, 100, 100];
      const ms = [4200, 7900, 11200, 6100, 15800, 5300, 8800, 21000, 6900, 9400];
      await p.evaluate(({ names, pts, ms }) => {
        const g = window.__yama.game;
        g.history = names.slice(0, 9).map((n, i) => ({ name: n, ok: pts[i] > 0, pts: pts[i], ms: ms[i] }));
        g.round = 10; g.points = pts.slice(0, 9).reduce((a, b) => a + b, 0); g.correct = 8; g.totalMs = ms.slice(0, 9).reduce((a, b) => a + b, 0);
      }, { names, pts, ms });
      // 最後の問題に正解して結果へ
      await questFor(p, '雲取山', { dh: 0 });
      await p.evaluate((ms9) => { window.__yama.game.qStart = performance.now() - ms9; }, ms[9]);
      await tapTarget(p);
      await p.waitForSelector('#result:not(.hidden)', { timeout: 15000 });
      await p.addStyleTag({ content: '#result-list{margin:6px 0!important}#result-list li{padding:0 2px!important;font-size:12.5px!important}#result-score{font-size:38px!important}#result-title{font-size:22px!important}.result-row{display:none!important}' });
      await p.waitForTimeout(600);
      await shot(p, `${lang}-5-result.png`);
      await p.context().close();
    }
    console.log(`${lang}: screenshots done`);
  }

  // フィーチャー グラフィック（1024 × 500）: 三ツ峠山からの富士山の景色にタイトルを重ねる
  {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { try { localStorage.setItem('yama.lang', 'ja'); } catch (e) {} });
    const p = await ctx.newPage();
    await p.goto(URL); await p.waitForTimeout(300);
    await startFrom(p, '三ツ峠山');
    await questFor(p, '富士山', { dh: -7, fov: 36, at: 0.36 });
    await p.addStyleTag({ content: '#topbar,#compass,#height-ctrl,#toolbar,#toast,#overlay{display:none!important}' });
    await p.waitForTimeout(500);
    const bg = path.join(OUT, '.fg-bg.png');
    await p.screenshot({ path: bg });
    const icon = fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon-only.png')).toString('base64');
    const bgData = fs.readFileSync(bg).toString('base64');
    for (const [file, title, sub, font] of [
      ['feature-graphic.png', '山探し', '景色から山を当てる 山座同定クイズ', "'Noto Sans CJK JP', sans-serif"],
      ['feature-graphic-en.png', 'Peak Finder', 'Spot the mountains of Japan', "'Inter', 'Noto Sans', sans-serif"],
    ]) {
      await p.setContent(`<html><body style="margin:0;width:1024px;height:500px;position:relative;overflow:hidden;font-family:${font}">
        <img src="data:image/png;base64,${bgData}" style="position:absolute;inset:0;width:1024px;height:500px">
        <div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(10,20,40,0.82) 0%,rgba(10,20,40,0.55) 42%,rgba(10,20,40,0) 70%)"></div>
        <div style="position:absolute;left:56px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;color:#fff">
          <img src="data:image/png;base64,${icon}" style="width:110px;height:110px;border-radius:24px;box-shadow:0 4px 18px rgba(0,0,0,.4)">
          <div style="font-size:${title.length > 4 ? 64 : 84}px;font-weight:800;letter-spacing:${title.length > 4 ? '0.01em' : '0.08em'};margin-top:18px;text-shadow:0 2px 10px rgba(0,0,0,.5)">${title}</div>
          <div style="font-size:26px;font-weight:700;color:#ffd166;margin-top:6px;text-shadow:0 2px 8px rgba(0,0,0,.6)">${sub}</div>
        </div></body></html>`);
      await p.waitForTimeout(300);
      await p.screenshot({ path: path.join(OUT, file) });
    }
    fs.unlinkSync(bg);
    // アイコン（512 × 512）
    await p.setViewportSize({ width: 512, height: 512 });
    await p.setContent(`<html><body style="margin:0"><img src="data:image/png;base64,${icon}" style="width:512px;height:512px;display:block"></body></html>`);
    await p.screenshot({ path: path.join(OUT, 'icon-512.png') });
    await ctx.close();
    console.log('feature graphics and icon done');
  }
  await browser.close();
})();
