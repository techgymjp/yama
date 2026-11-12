import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import MOUNTAINS from './data/mountains.json';

const DEG = Math.PI / 180;
const $ = (id) => document.getElementById(id);
const wrap180 = (a) => ((a % 360) + 540) % 360 - 180;
const DIRS = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
const dirName = (az) => DIRS[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
const fmtDist = (m) => (m < 10000 ? (m / 1000).toFixed(1) : Math.round(m / 1000)) + 'km';
const HEIGHTS = [1.6, 5, 10, 20, 30, 50, 100, 150, 200, 300, 500, 700, 1000, 1500, 2000, 3000, 5000];

// ---------------- 状態 ----------------
const state = {
  obs: null,            // { lat, lon, ground, name }
  hIdx: 0,              // HEIGHTS のインデックス（地上からの視点の高さ）
  heading: 0, pitch: 2, fov: 60,
  peaks: [],            // 見える/見えない判定付き
  showLabels: false,
  game: { target: null, misses: 0, hinted: false, revealed: false, score: 0, asked: 0, recent: [] },
  found: null,          // { peak, until }
  tapMark: null,
};
const eyeHeight = () => HEIGHTS[state.hIdx];
const h0 = () => (state.obs ? state.obs.ground + eyeHeight() : 0);

function snowline() {
  const v = $('opt-snow').value;
  if (v !== 'auto') return +v;
  const m = new Date().getMonth() + 1;
  return { 1: 1500, 2: 1500, 3: 1600, 4: 1900, 5: 2300, 6: 2700, 7: 0, 8: 0, 9: 0, 10: 2900, 11: 2500, 12: 1700 }[m];
}

// ---------------- Worker ----------------
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let reqId = 0;
const pending = new Map();
function call(msg) {
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id });
  });
}
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'progress') { $('loading-bar').style.width = `${Math.round(m.p * 100)}%`; return; }
  if (m.type === 'rendered') { onRendered(m); return; }
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m);
};
function initWorker() {
  worker.postMessage({ type: 'init', peaks: MOUNTAINS, source: $('opt-source').value });
}

// ---------------- 描画 ----------------
const scene = $('scene'), overlay = $('overlay');
const sctx = scene.getContext('2d'), octx = overlay.getContext('2d');
const imgCanvas = document.createElement('canvas');
const ictx = imgCanvas.getContext('2d');
let imgParams = null;
let rendering = false, dirty = false, interacting = false, idleTimer = 0;
let cssW = 0, cssH = 0, dpr = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cssW = window.innerWidth; cssH = window.innerHeight;
  for (const c of [scene, overlay]) { c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr); }
  requestRender();
}
window.addEventListener('resize', resize);

const focal = () => cssW / (state.fov * DEG); // CSS px / rad

function project(az, tanAlt) {
  const f = focal();
  return { x: cssW / 2 + wrap180(az - state.heading) * DEG * f, y: cssH / 2 - f * (tanAlt - Math.tan(state.pitch * DEG)) };
}
function unproject(x, y) {
  const f = focal();
  return { az: (state.heading + (x - cssW / 2) / f / DEG + 360) % 360, tanAlt: (cssH / 2 - y) / f + Math.tan(state.pitch * DEG) };
}

function requestRender() {
  dirty = true;
  if (!rendering) sendRender();
  draw();
}
function sendRender() {
  if (!state.obs || !cssW) return;
  dirty = false;
  rendering = true;
  // 操作中は低解像度、止まったら高解像度
  const q = interacting ? Math.min(dpr, 1) * 0.55 : Math.min(dpr, 1.5);
  worker.postMessage({
    type: 'render', id: ++reqId,
    heading: state.heading, pitch: state.pitch, fov: state.fov * 1.15, // 余白を少し付けて描く
    width: Math.round(cssW * 1.15 * q), height: Math.round(cssH * 1.15 * q),
    h0: h0(), snowline: snowline(),
  });
}
function onRendered(m) {
  window.__lastRenderMs = m.ms;
  rendering = false;
  imgCanvas.width = m.img.width; imgCanvas.height = m.img.height;
  ictx.putImageData(m.img, 0, 0);
  imgParams = m.params;
  draw();
  if (dirty) sendRender();
  else if (!interacting && m.params.width < cssW * 1.15 * Math.min(dpr, 1.5) - 2) { dirty = true; sendRender(); }
}

function draw() {
  const W = scene.width, H = scene.height;
  if (imgParams) {
    const p = imgParams;
    const fNow = W / (state.fov * DEG);
    const fImg = p.width / (p.fov * DEG);
    const s = fNow / fImg;
    const xc = W / 2 + wrap180(p.heading - state.heading) * DEG * fNow;
    const yc = H / 2 - fNow * (Math.tan(p.pitch * DEG) - Math.tan(state.pitch * DEG));
    sctx.fillStyle = '#9fb7cf';
    sctx.fillRect(0, 0, W, H);
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(imgCanvas, xc - p.width * s / 2, yc - p.height * s / 2, p.width * s, p.height * s);
  }
  drawOverlay();
  updateCompass();
}

function drawOverlay() {
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, cssW, cssH);
  const now = performance.now();
  const g = state.game;

  // 山名ラベル
  if (state.showLabels) drawLabels(state.peaks.filter((p) => p.visible && !p.here), '#fff');

  // 正解した山
  if (state.found && state.found.until > now) drawLabels([state.found.peak], '#7CFFB2', true);
  // パスで答えを表示
  if (g.revealed && g.target) drawLabels([g.target], '#ffd166', true);

  // ヒント: 画面外なら方向を矢印で示す
  if (g.hinted && g.target && !g.revealed) {
    const pt = project(g.target.az, g.target.tanAlt);
    if (pt.x < 0 || pt.x > cssW) {
      const left = pt.x < 0;
      const x = left ? 26 : cssW - 70, y = cssH * 0.45;
      octx.fillStyle = 'rgba(255,209,102,0.95)';
      octx.beginPath();
      if (left) { octx.moveTo(x - 14, y); octx.lineTo(x + 6, y - 16); octx.lineTo(x + 6, y + 16); }
      else { octx.moveTo(x + 14, y); octx.lineTo(x - 6, y - 16); octx.lineTo(x - 6, y + 16); }
      octx.fill();
    } else {
      // 画面内なら大まかな範囲を示す
      octx.strokeStyle = 'rgba(255,209,102,0.8)';
      octx.setLineDash([6, 6]); octx.lineWidth = 2;
      octx.strokeRect(pt.x - 60, 0, 120, cssH);
      octx.setLineDash([]);
    }
  }

  // タップ位置の表示
  if (state.tapMark && state.tapMark.until > now) {
    const t = state.tapMark;
    const pt = project(t.az, t.tanAlt);
    octx.strokeStyle = t.ok ? '#7CFFB2' : '#ff6b6b';
    octx.lineWidth = 3;
    octx.beginPath(); octx.arc(pt.x, pt.y, 16, 0, Math.PI * 2); octx.stroke();
  }
}

function drawLabels(list, color, big = false) {
  const placed = [];
  const items = list
    .map((p) => ({ p, ...project(p.az, p.tanAlt) }))
    .filter((o) => o.x > -50 && o.x < cssW + 50 && o.y > -20 && o.y < cssH + 20)
    .sort((a, b) => (b.p.hyakumeizan - a.p.hyakumeizan) || (b.p.elev - a.p.elev));
  octx.font = `${big ? 'bold 16px' : 'bold 12px'} system-ui, sans-serif`;
  octx.textAlign = 'center';
  for (const o of items) {
    const label = big ? `${o.p.name}（${fmtDist(o.p.dist)}）` : o.p.name;
    const w = octx.measureText(label).width + 8, hgt = big ? 20 : 16;
    let ly = null;
    for (let k = 0; k < 6; k++) {
      const yy = o.y - 26 - k * (hgt + 2);
      const box = { x0: o.x - w / 2, x1: o.x + w / 2, y0: yy - hgt, y1: yy };
      if (yy - hgt < 70) break;
      if (!placed.some((b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) { placed.push(box); ly = yy; break; }
    }
    if (ly === null) continue;
    octx.strokeStyle = color; octx.lineWidth = 1;
    octx.beginPath(); octx.moveTo(o.x, o.y - 3); octx.lineTo(o.x, ly); octx.stroke();
    octx.fillStyle = color;
    octx.beginPath(); octx.moveTo(o.x, o.y); octx.lineTo(o.x - 4, o.y - 7); octx.lineTo(o.x + 4, o.y - 7); octx.fill();
    octx.fillStyle = 'rgba(0,0,0,0.55)';
    octx.fillRect(o.x - w / 2, ly - hgt, w, hgt);
    octx.fillStyle = color;
    octx.fillText(label, o.x, ly - (big ? 5 : 4));
  }
}

function updateCompass() {
  $('compass-dial').setAttribute('transform', `rotate(${-state.heading})`);
  const half = Math.min(state.fov / 2, 80) * DEG, r = 40;
  $('compass-fov').setAttribute('d', `M0,0 L${-r * Math.sin(half)},${-r * Math.cos(half)} A${r},${r} 0 0 1 ${r * Math.sin(half)},${-r * Math.cos(half)} Z`);
  const hd = ((Math.round(state.heading) % 360) + 360) % 360;
  $('compass-label').textContent = `${dirName(hd)} ${hd}°`;
  const total = state.obs ? Math.round(h0()) : 0;
  $('height-label').innerHTML = `地上${eyeHeight()}m<br>標高${total}m`;
}

// ---------------- 操作（タップ・ドラッグ・2本指） ----------------
const pointers = new Map();
let gesture = null;
const view = $('view');

function setInteracting(on) {
  clearTimeout(idleTimer);
  if (on) interacting = true;
  else idleTimer = setTimeout(() => { interacting = false; requestRender(); }, 180);
}
function clampView() {
  state.fov = Math.max(5, Math.min(100, state.fov));
  state.pitch = Math.max(-40, Math.min(40, state.pitch));
  state.heading = (state.heading + 360) % 360;
}

view.addEventListener('pointerdown', (e) => {
  view.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
  gesture = snapshotGesture();
});
view.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  if (!gesture) return;
  const pts = [...pointers.values()];
  const f = focal();
  if (pts.length >= 2) {
    // 2本指: 中点の移動で方角・角度、ピンチでズーム
    const [a, b] = pts;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    state.fov = gesture.fov * gesture.dist / Math.max(dist, 1);
    clampView();
    const f2 = focal();
    state.heading = gesture.heading - (mx - gesture.mx) / f2 / DEG;
    state.pitch = Math.atan(Math.tan(gesture.pitch * DEG) + (my - gesture.my) / f2) / DEG;
    gesture.moved = true;
  } else if (pts.length === 1) {
    // 1本指（マウス）ドラッグでも視点移動
    if (Math.hypot(p.x - p.x0, p.y - p.y0) > 8 || gesture.moved) {
      gesture.moved = true;
      state.heading = gesture.heading - (p.x - gesture.mx) / f / DEG;
      state.pitch = Math.atan(Math.tan(gesture.pitch * DEG) + (p.y - gesture.my) / f) / DEG;
    }
  }
  if (gesture.moved) { clampView(); setInteracting(true); requestRender(); }
});
function endPointer(e) {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  pointers.delete(e.pointerId);
  const wasMulti = gesture && gesture.count > 1;
  if (gesture && !gesture.moved && !wasMulti && pointers.size === 0 && performance.now() - p.t0 < 600) onTap(p.x, p.y);
  gesture = pointers.size ? snapshotGesture() : null;
  if (gesture && wasMulti) gesture.count = 2; // 指を1本離しただけではタップにしない
  setInteracting(false);
}
view.addEventListener('pointerup', endPointer);
view.addEventListener('pointercancel', endPointer);
function snapshotGesture() {
  const pts = [...pointers.values()];
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 1;
  return { mx, my, dist, fov: state.fov, heading: state.heading, pitch: state.pitch, moved: false, count: pts.length };
}
view.addEventListener('wheel', (e) => {
  e.preventDefault();
  state.fov *= Math.exp(e.deltaY * 0.0015);
  clampView(); setInteracting(true); requestRender(); setInteracting(false);
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (!state.obs || e.target.tagName === 'INPUT') return;
  const k = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 2], ArrowDown: [0, -2] }[e.key];
  if (!k) return;
  state.heading += k[0] * state.fov / 60; state.pitch += k[1];
  clampView(); requestRender();
});
// iOS Safari のページ拡大を抑止
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ---------------- 高さ ▲▼ ----------------
function bindRepeat(btn, fn) {
  let t = 0;
  const stop = () => { clearTimeout(t); t = 0; };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    fn();
    const rep = (delay) => { t = setTimeout(() => { fn(); rep(Math.max(120, delay * 0.8)); }, delay); };
    rep(450);
  });
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointerleave', stop);
  btn.addEventListener('pointercancel', stop);
}
let peaksTimer = 0;
function changeHeight(dir) {
  const n = Math.max(0, Math.min(HEIGHTS.length - 1, state.hIdx + dir));
  if (n === state.hIdx) return;
  state.hIdx = n;
  requestRender();
  clearTimeout(peaksTimer);
  peaksTimer = setTimeout(refreshPeaks, 250);
}
bindRepeat($('btn-up'), () => changeHeight(1));
bindRepeat($('btn-down'), () => changeHeight(-1));

async function refreshPeaks() {
  const r = await call({ type: 'peaks', h0: h0() });
  const old = state.game.target;
  state.peaks = r.peaks;
  if (old) state.game.target = state.peaks.find((p) => p.name === old.name && p.lat === old.lat) || old;
  if (!state.game.target) nextQuest();
  draw();
}

// ---------------- ゲーム ----------------
function toast(msg, cls = '', ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.className = `show ${cls}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = ''; }, ms);
}

function nextQuest() {
  const g = state.game;
  const cands = state.peaks.filter((p) => p.visible && !p.here && p.dist > 800 && p.dist < 260000);
  const pool = cands.filter((p) => !g.recent.includes(p.name));
  const list = pool.length ? pool : cands;
  Object.assign(g, { misses: 0, hinted: false, revealed: false, target: null });
  if (!list.length) {
    $('quest-name').textContent = '見える山がありません';
    $('quest-suffix').textContent = '';
    $('quest-sub').textContent = '▲で視点を高くするか、「地点」から場所を変えてみてください';
    draw();
    return;
  }
  // 百名山・富士山・目立つ山を出やすく
  const weight = (p) => (p.name === '富士山' ? 6 : 1) * (p.hyakumeizan ? 3 : 1) * (1 + Math.min(3, Math.max(0, p.tanAlt + 0.05) * 40));
  let r = Math.random() * list.reduce((s, p) => s + weight(p), 0);
  let pick = list[0];
  for (const p of list) { r -= weight(p); if (r <= 0) { pick = p; break; } }
  g.target = pick;
  g.asked++;
  g.recent = [pick.name, ...g.recent].slice(0, Math.min(8, Math.floor(cands.length / 2)));
  $('quest-name').textContent = pick.name;
  $('quest-suffix').textContent = 'を探して！';
  $('quest-sub').textContent = `${pick.yomi}・標高${pick.elev}m${pick.hyakumeizan ? '・日本百名山' : ''}`;
  draw();
}

function onTap(x, y) {
  const g = state.game;
  if (!g.target || g.revealed) return;
  const { az, tanAlt } = unproject(x, y);
  const t = project(g.target.az, g.target.tanAlt);
  const tolX = Math.max(26, focal() * 1.0 * DEG);
  const hit = Math.abs(x - t.x) <= tolX && y >= t.y - 45 && y <= t.y + Math.max(60, focal() * 2 * DEG);
  state.tapMark = { az, tanAlt, ok: hit, until: performance.now() + 1200 };
  if (hit) {
    const pts = Math.max(10, 100 - g.misses * 20 - (g.hinted ? 30 : 0));
    g.score++;
    $('score').textContent = `正解 ${g.score}`;
    toast(`正解！ ${g.target.name}（${fmtDist(g.target.dist)}先） +${pts}点`, 'good', 2500);
    state.found = { peak: g.target, until: performance.now() + 3000 };
    g.target = null;
    setTimeout(nextQuest, 1600);
    setTimeout(draw, 3100);
  } else {
    g.misses++;
    // タップした場所にある山を教える
    let best = null, bd = 50;
    for (const p of state.peaks) {
      if (!p.visible || p.here) continue;
      const q = project(p.az, p.tanAlt);
      const d = Math.hypot(q.x - x, Math.max(0, q.y - y - 10) * 0.5 + Math.max(0, y - q.y - 60));
      if (Math.abs(q.x - x) < bd && d < bd) { bd = d; best = p; }
    }
    toast(best ? `そこは ${best.name}（${best.yomi}）です` : 'ちがいます…', 'bad');
    if (g.misses >= 3 && !g.hinted) showHint();
  }
  draw();
  setTimeout(draw, 1300);
}

function showHint() {
  const g = state.game;
  if (!g.target) return;
  g.hinted = true;
  $('quest-sub').textContent = `ヒント: ${dirName(g.target.az)}の方角（${Math.round(g.target.az)}°）・${fmtDist(g.target.dist)}先`;
  draw();
}
$('btn-hint').addEventListener('click', showHint);
$('btn-skip').addEventListener('click', () => {
  const g = state.game;
  if (!g.target || g.revealed) { nextQuest(); return; }
  g.revealed = true;
  toast(`正解は ${g.target.name}（${dirName(g.target.az)}・${fmtDist(g.target.dist)}先）`, '', 3000);
  animateTo(g.target.az, Math.atan(g.target.tanAlt) / DEG + 3);
  setTimeout(nextQuest, 3200);
});
$('btn-labels').addEventListener('click', () => {
  state.showLabels = !state.showLabels;
  $('btn-labels').classList.toggle('on', state.showLabels);
  draw();
});
$('btn-place').addEventListener('click', () => openPicker());

function animateTo(az, pitch) {
  const h0 = state.heading, p0 = state.pitch, dh = wrap180(az - h0), dp = pitch - p0;
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 700), e = k * k * (3 - 2 * k);
    state.heading = h0 + dh * e; state.pitch = p0 + dp * e;
    clampView(); interacting = k < 1; requestRender();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------- コンパス（端末の向き） ----------------
let deviceHeading = null;
function onOrientation(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
  else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha;
  if (h === null) return;
  const so = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  deviceHeading = (h + so + 360) % 360;
}
async function enableCompass() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') return;
    }
  } catch { return; }
  window.addEventListener('deviceorientationabsolute', onOrientation);
  window.addEventListener('deviceorientation', onOrientation);
}
async function readHeading() {
  for (let i = 0; i < 10 && deviceHeading === null; i++) await new Promise((r) => setTimeout(r, 100));
  return deviceHeading;
}

// ---------------- 開始・地点の読み込み ----------------
async function startAt(lat, lon, { name = '', summit = false } = {}) {
  $('start').classList.add('hidden');
  $('picker').classList.add('hidden');
  $('loading').classList.remove('hidden');
  $('loading-bar').style.width = '0%';
  $('loading-text').textContent = `${name ? name + ' の' : ''}地形データを読み込み中…`;
  try {
    const r = await call({ type: 'load', lat, lon });
    let ground = r.ground;
    if (summit) {
      const pk = MOUNTAINS.find((m) => m.name === name);
      if (pk) ground = Math.max(ground, pk.elev);
    }
    state.obs = { lat, lon, ground, name };
    state.hIdx = 0;
    const h = await readHeading();
    state.heading = h ?? 0;
    state.pitch = 2;
    state.fov = window.innerWidth < window.innerHeight ? 40 : 60;
    ['topbar', 'compass', 'height-ctrl', 'toolbar'].forEach((id) => $(id).classList.remove('hidden'));
    $('loading-text').textContent = '見える山を計算中…';
    const pk = await call({ type: 'peaks', h0: h0() });
    state.peaks = pk.peaks;
    state.game.target = null;
    state.game.recent = [];
    $('loading').classList.add('hidden');
    resize();
    nextQuest();
    if (h === null) toast('コンパスが使えないため北向きで表示しています', '', 3000);
  } catch (err) {
    $('loading').classList.add('hidden');
    toast(`読み込みに失敗しました: ${err.message}`, 'bad', 4000);
    if (!state.obs) $('start').classList.remove('hidden');
  }
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('位置情報が使えません')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject(e), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
}

const inJapan = (lat, lon) => lat > 20 && lat < 46.5 && lon > 122 && lon < 154.5;

$('btn-start').addEventListener('click', async () => {
  initWorker();
  enableCompass();
  try {
    const { lat, lon } = await getPosition();
    if (!inJapan(lat, lon)) { toast('現在地が日本国外のため、地点を選んでください', 'bad', 3500); openPicker(); return; }
    startAt(lat, lon, { name: '現在地' });
  } catch {
    toast('現在地を取得できませんでした。地点を選んでください', 'bad', 3500);
    openPicker();
  }
});
$('btn-start-place').addEventListener('click', () => { initWorker(); enableCompass(); openPicker(); });

// ---------------- 地点選択（地図） ----------------
let map = null, marker = null, picked = null;
function openPicker() {
  $('picker').classList.remove('hidden');
  if (!map) {
    map = L.map('map', { zoomControl: true, attributionControl: true }).setView([36.2, 138.2], 6);
    L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>',
    }).addTo(map);
    const icon = L.divIcon({ className: '', html: '<div style="width:16px;height:16px;border-radius:50%;background:#e76f51;border:3px solid #fff;box-shadow:0 1px 4px #0008"></div>', iconSize: [16, 16] });
    marker = L.marker([0, 0], { icon });
    for (const m of MOUNTAINS) {
      L.circleMarker([m.lat, m.lon], { radius: m.hyakumeizan ? 4 : 3, color: '#2a6f97', weight: 1, fillOpacity: 0.8 })
        .bindTooltip(`${m.name} ${m.elev}m`).on('click', () => pick(m.lat, m.lon, m.name, true)).addTo(map);
    }
    map.on('click', (e) => pick(e.latlng.lat, e.latlng.lng, '', false));
    if (state.obs) pick(state.obs.lat, state.obs.lon, state.obs.name, false);
  }
  setTimeout(() => map.invalidateSize(), 50);
}
function pick(lat, lon, name, summit) {
  picked = { lat, lon, name, summit };
  marker.setLatLng([lat, lon]).addTo(map);
  $('picker-info').textContent = `${name ? name + (summit ? ' 山頂' : '') + ' ' : ''}(${lat.toFixed(4)}, ${lon.toFixed(4)})`;
  $('btn-picker-ok').disabled = false;
}
$('btn-picker-ok').addEventListener('click', () => {
  if (!picked) return;
  enableCompass();
  startAt(picked.lat, picked.lon, { name: picked.name || '選択地点', summit: picked.summit });
});
$('btn-picker-cancel').addEventListener('click', () => {
  $('picker').classList.add('hidden');
  if (!state.obs) $('start').classList.remove('hidden');
});
$('btn-here').addEventListener('click', async () => {
  try {
    const { lat, lon } = await getPosition();
    map.setView([lat, lon], 12);
    pick(lat, lon, '現在地', false);
  } catch { toast('現在地を取得できませんでした', 'bad'); }
});
$('search').addEventListener('change', (e) => {
  const m = MOUNTAINS.find((x) => x.name === e.target.value.trim() || x.yomi === e.target.value.trim());
  if (!m) return;
  map.setView([m.lat, m.lon], 12);
  pick(m.lat, m.lon, m.name, true);
  e.target.blur();
});

// datalist
$('peak-list').innerHTML = MOUNTAINS.map((m) => `<option value="${m.name}">${m.yomi} ${m.elev}m</option>`).join('');
$('peak-count').textContent = MOUNTAINS.length;
$('opt-source').addEventListener('change', () => initWorker());
$('opt-snow').addEventListener('change', () => requestRender());
resize();
window.__yama = state; // デバッグ用
