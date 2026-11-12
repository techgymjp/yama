import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import MOUNTAINS from './data/mountains.json';
import STRUCTURES from './data/structures.json';
import { createBgm } from './bgm.js';

// ---------------- サウンド（BGM・効果音） ----------------
const audio = createBgm();
const pref = (k, def) => { try { const v = localStorage.getItem(k); return v === null ? def : v === '1'; } catch { return def; } };
const savePref = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* 保存できない環境 */ } };
let bgmOn = pref('yama.bgm', true);
let sfxOn = pref('yama.sfx', true);
const sfx = (name) => { if (sfxOn) audio.sfx(name); };

const DEG = Math.PI / 180;
const $ = (id) => document.getElementById(id);
const wrap180 = (a) => ((a % 360) + 540) % 360 - 180;
const DIRS = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
const dirName = (az) => DIRS[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
const fmtDist = (m) => (m < 10000 ? (m / 1000).toFixed(1) : Math.round(m / 1000)) + 'km';
const CLASS_LABEL = { 100: '日本百名山', 200: '日本二百名山', 300: '日本三百名山' };
const RANK = { 100: 3, 200: 2, 300: 1, 0: 0 };
const rank = (p) => RANK[p.cls] || 0;
// 同名の山を区別するための表示名（例: 駒ヶ岳（北海道））
const NAME_COUNT = {};
for (const m of MOUNTAINS) NAME_COUNT[m.name] = (NAME_COUNT[m.name] || 0) + 1;
const uniqueName = (m) => (NAME_COUNT[m.name] > 1 && m.pref ? `${m.name}（${m.pref}）` : m.name);
function describe(p) {
  if (p.structure) return `${p.yomi}・高さ${p.height}m の構造物`;
  const parts = [p.yomi];
  if (p.alias || p.group) parts.push([p.alias, p.group].filter(Boolean).join('・'));
  if (p.pref) parts.push(p.pref);
  parts.push(`標高${p.elev}m`);
  if (CLASS_LABEL[p.cls]) parts.push(CLASS_LABEL[p.cls]);
  return parts.join('・');
}
const TOTAL_QUESTIONS = 10;
const HEIGHTS = [1.6, 5, 10, 20, 30, 50, 100, 150, 200, 300, 500, 700, 1000, 1500, 2000, 3000, 5000];

// ---------------- 状態 ----------------
const state = {
  obs: null,            // { lat, lon, ground, name }
  hIdx: 0,              // HEIGHTS のインデックス（地上からの視点の高さ）
  heading: 0, pitch: 2, fov: 60,
  peaks: [],            // 見える/見えない判定付き
  showLabels: false,
  game: { target: null, misses: 0, hinted: false, revealed: false, recent: [], round: 0, points: 0, correct: 0, history: [], waiting: false, finished: false, qStart: 0, totalMs: 0 },
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

// ---------------- 画面上のエラー表示 ----------------
function showError(msg) {
  try { toast(`エラー: ${msg}`, 'bad', 6000); } catch { alert(`エラー: ${msg}`); }
}
window.addEventListener('error', (e) => showError(e.message || String(e.error)));
window.addEventListener('unhandledrejection', (e) => showError((e.reason && e.reason.message) || String(e.reason)));

// ---------------- 標高タイル（メインスレッドで取得・デコード） ----------------
const DEM_SOURCES = {
  gsi: {
    url: (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/dem_png/${z}/${x}/${y}.png`,
    // 地理院 標高タイル(PNG): x = R*2^16 + G*2^8 + B, 0.01m 単位, 2^23 は無効値(海など)
    decode(r, g, b) {
      const v = r * 65536 + g * 256 + b;
      if (v === 8388608) return 0;
      return (v < 8388608 ? v : v - 16777216) * 0.01;
    },
  },
  terrarium: {
    url: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
    decode: (r, g, b) => r * 256 + g + b / 256 - 32768,
  },
};
const decodeCanvas = document.createElement('canvas');
decodeCanvas.width = decodeCanvas.height = 256;
const decodeCtx = decodeCanvas.getContext('2d', { willReadFrequently: true });

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像のデコードに失敗')); };
    img.src = url;
  });
}
async function fetchTile(src, z, x, y) {
  const s = DEM_SOURCES[src];
  const res = await fetch(s.url(z, x, y), { mode: 'cors' });
  if (res.status === 404) return null; // 海など
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const img = await loadImage(await res.blob());
  decodeCtx.clearRect(0, 0, 256, 256);
  decodeCtx.drawImage(img, 0, 0);
  const px = decodeCtx.getImageData(0, 0, 256, 256).data;
  const out = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) {
    const h = s.decode(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    out[i] = h > 0 ? h : 0; // 海面下は 0 に
  }
  return out;
}
// 地理院タイル シームレス空中写真 → RGBA（a=0 はデータなし）
async function fetchPhoto(z, x, y) {
  const res = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${z}/${x}/${y}.jpg`, { mode: 'cors' });
  if (!res.ok) return null;
  const img = await loadImage(await res.blob());
  decodeCtx.clearRect(0, 0, 256, 256);
  decodeCtx.drawImage(img, 0, 0);
  return new Uint8Array(decodeCtx.getImageData(0, 0, 256, 256).data.buffer.slice(0));
}
async function provideTile(m) {
  let data = null;
  if (m.kind === 'photo') {
    try { data = await fetchPhoto(m.z, m.x, m.y); } catch { data = null; }
    worker.postMessage({ type: 'tile', tid: m.tid, data }, data ? [data.buffer] : []);
    return;
  }
  try {
    data = await fetchTile(m.source, m.z, m.x, m.y);
  } catch {
    // 地理院タイルが取得できない場合は AWS Terrain Tiles にフォールバック
    if (m.source !== 'terrarium') { try { data = await fetchTile('terrarium', m.z, m.x, m.y); } catch { data = null; } }
  }
  worker.postMessage({ type: 'tile', tid: m.tid, data }, data ? [data.buffer] : []);
}

// ---------------- Worker ----------------
// 古いブラウザでも動くよう classic worker として読み込む
const worker = new Worker(new URL('./worker.js', import.meta.url));
let reqId = 0;
const pending = new Map();
function call(msg) {
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id });
  });
}
worker.onerror = (e) => showError(`Worker: ${e.message || '読み込みに失敗しました'}`);
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'needTile') { provideTile(m); return; }
  if (m.type === 'progress') { $('loading-bar').style.width = `${Math.round(m.p * 100)}%`; return; }
  if (m.type === 'rendered') { onRendered(m); return; }
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m);
};
function initWorker() {
  worker.postMessage({ type: 'init', peaks: MOUNTAINS, structures: STRUCTURES, source: $('opt-source').value });
  worker.postMessage({ type: 'options', buildings: $('opt-buildings').checked });
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
  invalidate();
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

// 画面より広い範囲（横 2.4 倍・縦 1.6 倍）を描いておき、パン操作は描画済みの画像をずらすだけにする。
// 描画済み範囲からはみ出したとき・拡大して粗くなったとき・視点が変わったときだけ描き直す。
const MARGIN_X = 2.4, MARGIN_Y = 1.6;
let panVelocity = 0;   // 方角の変化速度 [deg/s]（先読み描画用）
let sceneVersion = 0; // 視点の高さ・積雪・建物など、景色そのものが変わったら増やす
function invalidate() { sceneVersion++; requestRender(); }
const fullQuality = () => Math.min(dpr, cssW < 700 ? 1.25 : 1.5);
const lowQuality = () => Math.min(dpr, 1) * 0.5;

function needsRender(final) {
  const p = imgParams;
  if (!p || p.version !== sceneVersion) return true;
  // 描画済み範囲に今の視野が収まっているか
  const fNow = focal(); // CSS px / rad
  if (Math.abs(wrap180(p.heading - state.heading)) + state.fov / 2 > p.fov / 2 + 0.01) return true;
  const fImg = p.width / (p.fov * DEG); // 画像 px / rad
  const tImg = Math.tan(p.pitch * DEG), tNow = Math.tan(state.pitch * DEG);
  const hImg = (p.height / 2) / fImg, hNow = (cssH / 2) / fNow;
  if (tNow + hNow > tImg + hImg + 1e-4 || tNow - hNow < tImg - hImg - 1e-4) return true;
  // 解像度: 操作中は粗すぎなければよい、止まったら本来の解像度で
  const ratio = fImg / (fNow * (final ? fullQuality() : lowQuality()));
  if (final) return ratio < 0.92 || ratio > 2.2;
  return ratio < 0.5;
}

function requestRender() {
  draw();
  if (!state.obs || !cssW) return;
  if (needsRender(!interacting)) {
    dirty = true;
    if (!rendering) sendRender();
  }
}
function sendRender() {
  if (!state.obs || !cssW) return;
  dirty = false;
  rendering = true;
  // 操作中は低解像度、止まったら高解像度
  const q = interacting ? lowQuality() : fullQuality();
  // 操作中は動いている方向へ先回りして描く（0.35 秒先、最大で視野の 0.8 倍）
  const lead = interacting ? Math.max(-state.fov * 0.8, Math.min(state.fov * 0.8, panVelocity * 0.35)) : 0;
  worker.postMessage({
    type: 'render', id: ++reqId, version: sceneVersion,
    heading: (state.heading + lead + 360) % 360, pitch: state.pitch, fov: Math.min(359, state.fov * MARGIN_X),
    width: Math.round(cssW * Math.min(359 / state.fov, MARGIN_X) * q), height: Math.round(cssH * MARGIN_Y * q),
    h0: h0(), snowline: snowline(),
  });
}
// ---- 360°の低解像度パノラマ（下絵）: 素早いフリックで描画済み範囲を越えても空白にしない ----
const PANO_W = 2048, PANO_STRIPS = 8, PANO_TAN = 0.36;
const PANO_F = PANO_W / (2 * Math.PI);            // px / rad
const PANO_H = Math.round(2 * PANO_F * PANO_TAN);
const panoCanvas = document.createElement('canvas');
panoCanvas.width = PANO_W; panoCanvas.height = PANO_H;
const pctx = panoCanvas.getContext('2d');
let panoStrips = [];      // 各帯の sceneVersion（描けていなければ -1）
let panoHasAny = false;
function resetPano() { panoStrips = new Array(PANO_STRIPS).fill(-1); }
resetPano();
function nextPanoStrip() {
  // 今見ている方角に近い帯から順に描く
  const cur = Math.floor(((state.heading % 360) + 360) % 360 / (360 / PANO_STRIPS));
  for (let k = 0; k < PANO_STRIPS; k++) {
    const i = (cur + (k % 2 ? (k + 1) / 2 : -k / 2) + PANO_STRIPS) % PANO_STRIPS;
    if (panoStrips[i] !== sceneVersion) return i;
  }
  return -1;
}
function sendPanoStrip() {
  const i = nextPanoStrip();
  if (i < 0 || !state.obs) return false;
  rendering = true;
  const sw = PANO_W / PANO_STRIPS;
  worker.postMessage({
    type: 'render', id: ++reqId, version: sceneVersion, pano: i,
    heading: (i + 0.5) * (360 / PANO_STRIPS), pitch: 0, fov: 360 / PANO_STRIPS,
    width: sw, height: PANO_H, h0: h0(), snowline: snowline(),
  });
  return true;
}

function onRendered(m) {
  if (m.params.pano !== undefined) {
    rendering = false;
    const i = m.params.pano;
    pctx.putImageData(m.img, i * (PANO_W / PANO_STRIPS), 0);
    panoStrips[i] = m.params.version;
    panoHasAny = true;
    if (dirty || needsRender(!interacting)) sendRender();
    else sendPanoStrip();
    draw();
    return;
  }
  window.__lastRenderMs = m.ms;
  window.__renderCount = (window.__renderCount || 0) + 1;
  rendering = false;
  imgCanvas.width = m.img.width; imgCanvas.height = m.img.height;
  ictx.putImageData(m.img, 0, 0);
  imgParams = m.params;
  draw();
  if (dirty || needsRender(!interacting)) sendRender();
  else if (!interacting) sendPanoStrip(); // 手が空いたら下絵を描く
}

function draw() {
  const W = scene.width, H = scene.height;
  const fNow = W / (state.fov * DEG);
  const tp = Math.tan(state.pitch * DEG);
  if (imgParams || panoHasAny) {
    // 空のグラデーションで下塗り
    const horizon = H / 2 + fNow * tp;
    const grad = sctx.createLinearGradient(0, horizon - fNow * 0.6, 0, horizon);
    grad.addColorStop(0, '#5080d0'); grad.addColorStop(1, '#c8daee');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, W, H);
    sctx.imageSmoothingEnabled = true;
  }
  if (panoHasAny) {
    // 360°パノラマを左右につないで描く
    const s = fNow / PANO_F;
    const yTop = H / 2 - fNow * (PANO_TAN - tp);
    const x0 = W / 2 - ((((state.heading % 360) + 360) % 360) * DEG) * fNow;
    const pw = PANO_W * s;
    for (let k = -1; k <= 1; k++) {
      const x = x0 + k * pw;
      if (x + pw < 0 || x > W) continue;
      sctx.drawImage(panoCanvas, x, yTop, pw, PANO_H * s);
    }
  }
  if (imgParams) {
    const p = imgParams;
    const fImg = p.width / (p.fov * DEG);
    const s = fNow / fImg;
    const xc = W / 2 + wrap180(p.heading - state.heading) * DEG * fNow;
    const yc = H / 2 - fNow * (Math.tan(p.pitch * DEG) - tp);
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

  // ヒント: 画面外なら「どちらへ何度回るか」をバッジで示す
  if (g.hinted && g.target && !g.revealed) {
    const pt = project(g.target.az, g.target.tanAlt);
    if (pt.x < 0 || pt.x > cssW) drawHintBadge(wrap180(g.target.az - state.heading));
    else {
      // 画面内なら大まかな範囲を示す
      octx.strokeStyle = 'rgba(255,209,102,0.85)';
      octx.setLineDash([6, 6]); octx.lineWidth = 2;
      octx.strokeRect(pt.x - 60, 70, 120, cssH - 150);
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

// 画面の左右端（コンパスと高さボタンの間）に、回る向きと角度を示すバッジ
function drawHintBadge(diff) {
  const right = diff > 0;
  const text = `${right ? '右' : '左'}へ ${Math.round(Math.abs(diff))}°`;
  octx.font = 'bold 17px system-ui, sans-serif';
  const tw = octx.measureText(text).width;
  const w = tw + 52, h = 44, r = h / 2;
  // 実際のボタン位置を見て、上部のお題・下部のツールバー・右下の高さボタンを避ける
  const rect = (id) => document.getElementById(id).getBoundingClientRect();
  const topLimit = rect('topbar').bottom + 10;
  const tb = rect('toolbar');
  const bottomLimit = (tb.height ? Math.min(tb.top, cssH) : cssH) - 10;
  const y = Math.max(topLimit, Math.min((topLimit + bottomLimit) / 2 - h / 2, bottomLimit - h));
  const hc = rect('height-ctrl');
  const rightEdge = Math.min(cssW - 12, hc.width ? hc.left - 14 : cssW - 12);
  const x = right ? rightEdge - w : 12;
  // 少し脈打つ
  const pulse = 1 + 0.04 * Math.sin(performance.now() / 180);
  octx.save();
  octx.translate(x + w / 2, y + h / 2); octx.scale(pulse, pulse); octx.translate(-(x + w / 2), -(y + h / 2));
  octx.shadowColor = 'rgba(0,0,0,0.45)'; octx.shadowBlur = 8;
  octx.fillStyle = 'rgba(255,209,102,0.97)';
  octx.beginPath();
  octx.moveTo(x + r, y); octx.lineTo(x + w - r, y); octx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  octx.lineTo(x + r, y + h); octx.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5); octx.fill();
  octx.shadowBlur = 0;
  // 矢印
  octx.fillStyle = '#1d2b3a';
  const ax = right ? x + w - 22 : x + 22, ay = y + h / 2, dir = right ? 1 : -1;
  octx.beginPath();
  octx.moveTo(ax + 9 * dir, ay); octx.lineTo(ax - 5 * dir, ay - 11); octx.lineTo(ax - 5 * dir, ay + 11); octx.fill();
  octx.textAlign = 'center'; octx.textBaseline = 'middle';
  octx.fillText(text, right ? x + (w - 26) / 2 + 2 : x + 26 + (w - 26) / 2 - 2, ay + 1);
  octx.restore();
  octx.textBaseline = 'alphabetic';
  // 脈打ちのアニメーション
  if (!drawHintBadge.raf) drawHintBadge.raf = requestAnimationFrame(() => { drawHintBadge.raf = 0; draw(); });
}

function drawLabels(list, color, big = false) {
  const placed = [];
  const items = list
    .map((p) => ({ p, ...project(p.az, p.tanAlt) }))
    .filter((o) => o.x > -50 && o.x < cssW + 50 && o.y > -20 && o.y < cssH + 20)
    .sort((a, b) => (rank(b.p) - rank(a.p)) || (b.p.elev - a.p.elev));
  octx.font = `${big ? 'bold 19px' : 'bold 15px'} system-ui, sans-serif`;
  octx.textAlign = 'center';
  for (const o of items) {
    const label = big ? `${o.p.name}（${fmtDist(o.p.dist)}）` : o.p.name;
    const w = octx.measureText(label).width + 10, hgt = big ? 25 : 20;
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
    octx.fillText(label, o.x, ly - (big ? 6 : 5));
  }
}

function updateCompass() {
  $('compass-dial').setAttribute('transform', `rotate(${-state.heading})`);
  const half = Math.min(state.fov / 2, 80) * DEG, r = 40;
  $('compass-fov').setAttribute('d', `M0,0 L${-r * Math.sin(half)},${-r * Math.cos(half)} A${r},${r} 0 0 1 ${r * Math.sin(half)},${-r * Math.cos(half)} Z`);
  const hd = ((Math.round(state.heading) % 360) + 360) % 360;
  $('compass-label').textContent = `${dirName(hd)} ${hd}°`;
  const total = state.obs ? Math.round(h0()) : 0;
  $('height-label').innerHTML = `<span class="h-ground">地上${eyeHeight()}m</span><span class="h-total">標高${total}m</span>`;
}

// ---------------- 操作（タップ・ドラッグ・2本指） ----------------
const pointers = new Map();
let gesture = null;
const view = $('view');

function setInteracting(on) {
  clearTimeout(idleTimer);
  if (on) interacting = true;
  else idleTimer = setTimeout(() => { interacting = false; panVelocity = 0; requestRender(); }, 180);
}
function clampView() {
  state.fov = Math.max(2, Math.min(100, state.fov));
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
  // 動きは「水平（方角）」「垂直（上下の角度）」「拡大・縮小」のどれか一つに固定する。
  // 最初の動きで決め、指を離すまで変えない（斜めには動かさない）。
  const axisOf = (dx, dy) => (Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v');
  if (pts.length >= 2) {
    const [a, b] = pts;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const dx = mx - gesture.mx, dy = my - gesture.my;
    if (!gesture.axis) {
      const pinch = Math.abs(dist - gesture.dist), pan = Math.hypot(dx, dy);
      if (pinch > 18 && pinch > pan * 0.8) gesture.axis = 'zoom';
      else if (pan > 12) gesture.axis = axisOf(dx, dy);
    }
    if (gesture.axis === 'zoom') {
      state.fov = gesture.fov * gesture.dist / Math.max(dist, 1);
    } else if (gesture.axis === 'h') {
      state.heading = gesture.heading - dx / f / DEG;
    } else if (gesture.axis === 'v') {
      state.pitch = Math.atan(Math.tan(gesture.pitch * DEG) + dy / f) / DEG;
    }
    if (gesture.axis) gesture.moved = true;
  } else if (pts.length === 1) {
    // 1本指（マウス）ドラッグでも視点移動
    const dx = p.x - gesture.mx, dy = p.y - gesture.my;
    if (!gesture.axis && Math.hypot(p.x - p.x0, p.y - p.y0) > 8) gesture.axis = axisOf(dx, dy);
    if (gesture.axis === 'h') state.heading = gesture.heading - dx / f / DEG;
    else if (gesture.axis === 'v') state.pitch = Math.atan(Math.tan(gesture.pitch * DEG) + dy / f) / DEG;
    if (gesture.axis) gesture.moved = true;
  }
  if (gesture.moved) {
    clampView();
    const now = performance.now();
    if (gesture.lastT) {
      const dt = Math.max(1, now - gesture.lastT) / 1000;
      const v = wrap180(state.heading - gesture.lastH) / dt;
      panVelocity = panVelocity * 0.6 + v * 0.4;
    }
    gesture.lastT = now; gesture.lastH = state.heading;
    setInteracting(true); requestRender();
  }
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
  return { mx, my, dist, fov: state.fov, heading: state.heading, pitch: state.pitch, moved: false, count: pts.length, axis: null };
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
  invalidate();
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
  if (!state.game.target && !state.game.waiting && !state.game.finished) nextQuest();
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

// 見えている山がちょうどよい大きさになるようにズーム（画角）と上下の角度を決める
function autoFrame() {
  const ts = state.peaks.filter((p) => p.visible && !p.here && !p.structure && p.dist > 1000).map((p) => p.tanAlt).sort((a, b) => a - b);
  if (!ts.length) return;
  const hi = ts[Math.min(ts.length - 1, Math.floor(ts.length * 0.95))];
  const lo = Math.max(Math.min(ts[0], 0), hi - 0.12);
  const amp = Math.max(hi - lo, 0.004);
  const W = window.innerWidth, H = window.innerHeight;
  // 山の高さが画面の高さの約 25% になる焦点距離
  let f = H * 0.25 / amp;
  const minFov = W < H ? 8 : 12;
  let fov = W / f / DEG;
  fov = Math.max(minFov, Math.min(60, fov));
  f = W / (fov * DEG);
  state.fov = fov;
  // 山の裾を画面の下から 40% あたりに置く
  state.pitch = Math.atan(lo + 0.1 * H / f) / DEG;
}

function resetGame() {
  Object.assign(state.game, { target: null, misses: 0, hinted: false, revealed: false, recent: [], round: 0, points: 0, correct: 0, history: [], waiting: false, finished: false, qStart: 0, totalMs: 0 });
  $('result').classList.add('hidden');
  updateScore();
}
// ---- タイム（各問の出題から正解・パスまで） ----
const fmtTime = (ms) => {
  const t = ms / 1000;
  return t < 60 ? `${t.toFixed(1)}秒` : `${Math.floor(t / 60)}分${(t % 60).toFixed(1).padStart(4, '0')}秒`;
};
const questionRunning = () => { const g = state.game; return g.target && !g.waiting && !g.finished && !g.revealed && g.qStart; };
function elapsedMs() {
  const g = state.game;
  return g.totalMs + (questionRunning() ? performance.now() - g.qStart : 0);
}
function stopQuestionTimer() {
  const g = state.game;
  const ms = g.qStart ? performance.now() - g.qStart : 0;
  g.totalMs += ms;
  g.qStart = 0;
  return ms;
}
function updateScore() {
  const g = state.game;
  $('score').textContent = `${Math.max(1, g.round)}/${TOTAL_QUESTIONS}問・${g.points}点・⏱${Math.floor(elapsedMs() / 1000)}秒`;
}
setInterval(() => { if (state.obs && questionRunning()) updateScore(); }, 250);

function nextQuest() {
  const g = state.game;
  g.waiting = false;
  if (g.finished) return;
  if (g.round >= TOTAL_QUESTIONS) { showResult(); return; }
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
  const weight = (p) => (p.name === '富士山' ? 6 : 1) * (p.structure ? 8 : [1, 3, 5, 10][rank(p)]) * (1 + Math.min(3, Math.max(0, p.tanAlt + 0.05) * 40));
  let r = Math.random() * list.reduce((s, p) => s + weight(p), 0);
  let pick = list[0];
  for (const p of list) { r -= weight(p); if (r <= 0) { pick = p; break; } }
  g.target = pick;
  g.round++;
  g.qStart = performance.now();
  updateScore();
  g.recent = [pick.name, ...g.recent].slice(0, Math.min(8, Math.floor(cands.length / 2)));
  $('quest-name').textContent = pick.name;
  $('quest-suffix').textContent = `を探して！（第${g.round}問）`;
  $('quest-sub').textContent = describe(pick);
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
    const ms = stopQuestionTimer();
    g.correct++;
    g.points += pts;
    g.history.push({ name: g.target.name, ok: true, pts, ms });
    updateScore();
    sfx('correct');
    toast(`正解！ ${g.target.name}（${fmtDist(g.target.dist)}先）\n+${pts}点・${fmtTime(ms)}`, 'good', 2500);
    state.found = { peak: g.target, until: performance.now() + 3000 };
    g.target = null;
    g.waiting = true;
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
    sfx('wrong');
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
// ---------------- 結果 ----------------
function showResult() {
  const g = state.game;
  g.finished = true;
  g.target = null;
  const max = TOTAL_QUESTIONS * 100;
  const rate = g.points / max;
  const title = rate >= 0.9 ? '山の達人' : rate >= 0.7 ? '山の上級者' : rate >= 0.45 ? '山好き' : rate >= 0.2 ? 'ハイカー' : '山歩きビギナー';
  $('result-title').textContent = title;
  $('result-score').textContent = `${g.points}点`;
  $('result-detail').textContent = `${TOTAL_QUESTIONS}問中 ${g.correct}問正解（${max}点満点）`;
  $('result-time').textContent = `タイム ${fmtTime(g.totalMs)}`;
  $('result-list').innerHTML = g.history.map((h, i) =>
    `<li><span>第${i + 1}問 ${h.name}</span><span class="t">${fmtTime(h.ms)}</span><span class="${h.ok ? 'ok' : 'ng'}">${h.ok ? `○ ${h.pts}点` : '× パス'}</span></li>`).join('');
  updateScore();
  $('result').classList.remove('hidden');
  sfx(rate >= 0.45 ? 'result' : 'resultLow');
  $('quest-name').textContent = '結果発表';
  $('quest-suffix').textContent = '';
  $('quest-sub').textContent = '';
  draw();
}
$('btn-again').addEventListener('click', () => { sfx('start'); resetGame(); nextQuest(); });
$('btn-result-place').addEventListener('click', () => { sfx('click'); $('result').classList.add('hidden'); openPicker(); });
$('btn-result-view').addEventListener('click', () => { $('result').classList.add('hidden'); state.showLabels = true; $('btn-labels').classList.add('on'); draw(); });

$('btn-hint').addEventListener('click', () => { sfx('click'); showHint(); });
$('btn-skip').addEventListener('click', () => {
  const g = state.game;
  if (g.finished) { $('result').classList.remove('hidden'); return; }
  if (g.waiting) return;
  if (!g.target) { nextQuest(); return; }
  g.revealed = true;
  g.waiting = true;
  g.history.push({ name: g.target.name, ok: false, pts: 0, ms: stopQuestionTimer() });
  updateScore();
  sfx('reveal');
  toast(`正解は ${g.target.name}（${dirName(g.target.az)}・${fmtDist(g.target.dist)}先）`, '', 3000);
  animateTo(g.target.az, Math.atan(g.target.tanAlt) / DEG + 3);
  setTimeout(nextQuest, 3200);
});
$('btn-labels').addEventListener('click', () => {
  state.showLabels = !state.showLabels;
  $('btn-labels').classList.toggle('on', state.showLabels);
  draw();
});
$('btn-place').addEventListener('click', () => { sfx('click'); openPicker(); });
// BGM のオン・オフ
function updateBgmButton() {
  $('btn-bgm').classList.toggle('on', bgmOn);
  $('btn-bgm').textContent = bgmOn ? '♪ BGM' : '♪ オフ';
}
$('btn-bgm').addEventListener('click', () => {
  bgmOn = !bgmOn;
  savePref('yama.bgm', bgmOn);
  audio.unlock();
  if (bgmOn) audio.start(); else audio.stop();
  updateBgmButton();
});
updateBgmButton();
$('opt-sfx').checked = sfxOn;
$('opt-sfx').addEventListener('change', () => { sfxOn = $('opt-sfx').checked; savePref('yama.sfx', sfxOn); });
// 画面が隠れたら音を止める
document.addEventListener('visibilitychange', () => { if (document.hidden) audio.suspend(); else audio.resume(); });

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
async function startAt(lat, lon, { name = '', summit = 0, snapped = false } = {}) {  // summit: 山頂の標高
  $('start').classList.add('hidden');
  $('picker').classList.add('hidden');
  $('loading').classList.remove('hidden');
  $('loading-bar').style.width = '0%';
  $('loading-text').textContent = `${name ? name + ' の' : ''}地形データを読み込み中…`;
  try {
    const r = await call({ type: 'load', lat, lon });
    let ground = r.ground;
    if (summit) ground = Math.max(ground, summit);
    state.obs = { lat, lon, ground, name };
    // 市街地では建物に視界をさえぎられるので、屋上の高さ(30m)から始める
    const urbanStart = !summit && $('opt-buildings').checked && r.urban > 0.35;
    state.hIdx = urbanStart ? HEIGHTS.indexOf(30) : 0;
    const h = await readHeading();
    state.heading = h ?? 0;
    state.pitch = 2;
    state.fov = window.innerWidth < window.innerHeight ? 40 : 60;
    ['topbar', 'compass', 'height-ctrl', 'toolbar'].forEach((id) => $(id).classList.remove('hidden'));
    $('loading-text').textContent = '見える山を計算中…';
    const pk = await call({ type: 'peaks', h0: h0() });
    state.peaks = pk.peaks;
    resetGame();
    // 別の場所のパノラマが見えないように消しておく
    panoHasAny = false; pctx.clearRect(0, 0, PANO_W, PANO_H); resetPano();
    autoFrame();
    if (bgmOn) audio.start();
    $('loading').classList.add('hidden');
    resize();
    nextQuest();
    const notes = [];
    if (snapped) notes.push(`${name} 山頂（標高${summit}m）から見ています`);
    if (urbanStart) notes.push('市街地のため、ビルの屋上（地上30m）から見ています。▼で地上に降りられます');
    if (h === null) notes.push('コンパスが使えないため北向きで表示しています');
    if (notes.length) toast(notes.join('\n'), '', 4500);
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

// 現在地が収録している山頂から SUMMIT_SNAP_M 以内なら、その山頂にいるとみなす
// （GPS の位置のずれで、とがった山頂の地面が低く計算されるのを防ぐ）
const SUMMIT_SNAP_M = 100;
function nearbySummit(lat, lon) {
  let best = null, bd = SUMMIT_SNAP_M;
  for (const m of MOUNTAINS) {
    const d = Math.hypot((m.lat - lat) * 111320, (m.lon - lon) * 111320 * Math.cos(lat * DEG));
    if (d <= bd) { bd = d; best = m; }
  }
  return best;
}

const inJapan = (lat, lon) => lat > 20 && lat < 46.5 && lon > 122 && lon < 154.5;

$('btn-start').addEventListener('click', async () => {
  audio.unlock();
  sfx('start');
  initWorker();
  enableCompass();
  try {
    const { lat, lon } = await getPosition();
    if (!inJapan(lat, lon)) { toast('現在地が日本国外のため、地点を選んでください', 'bad', 3500); openPicker(); return; }
    const sm = nearbySummit(lat, lon);
    if (sm) startAt(sm.lat, sm.lon, { name: uniqueName(sm), summit: sm.elev, snapped: true });
    else startAt(lat, lon, { name: '現在地' });
  } catch {
    toast('現在地を取得できませんでした。地点を選んでください', 'bad', 3500);
    openPicker();
  }
});
$('btn-start-place').addEventListener('click', () => { audio.unlock(); sfx('click'); initWorker(); enableCompass(); openPicker(); });

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
      L.circleMarker([m.lat, m.lon], { radius: 2 + rank(m) * 0.7, color: ['#6c757d', '#52796f', '#2a6f97', '#c1121f'][rank(m)], weight: 1, fillOpacity: 0.8 })
        .bindTooltip(`${m.name} ${m.elev}m${CLASS_LABEL[m.cls] ? '（' + CLASS_LABEL[m.cls] + '）' : ''}`).on('click', () => pick(m.lat, m.lon, uniqueName(m), m.elev)).addTo(map);
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
  audio.unlock();
  sfx('start');
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
    const sm = nearbySummit(lat, lon);
    if (sm) { map.setView([sm.lat, sm.lon], 13); pick(sm.lat, sm.lon, uniqueName(sm), sm.elev); toast(`${uniqueName(sm)} 山頂の近くにいます`, '', 2500); }
    else { map.setView([lat, lon], 12); pick(lat, lon, '現在地', false); }
  } catch { toast('現在地を取得できませんでした', 'bad'); }
});
$('search').addEventListener('change', (e) => {
  const v = e.target.value.trim();
  const m = MOUNTAINS.find((x) => uniqueName(x) === v) || MOUNTAINS.find((x) => x.name === v || x.yomi === v || x.alias === v);
  if (!m) return;
  map.setView([m.lat, m.lon], 12);
  pick(m.lat, m.lon, uniqueName(m), m.elev);
  e.target.blur();
});

// datalist
$('peak-list').innerHTML = MOUNTAINS.map((m) => `<option value="${uniqueName(m)}">${m.yomi} ${m.elev}m</option>`).join('');
$('peak-count').textContent = MOUNTAINS.length;
$('opt-source').addEventListener('change', () => initWorker());
$('opt-snow').addEventListener('change', () => invalidate());
$('opt-buildings').addEventListener('change', () => {
  worker.postMessage({ type: 'options', buildings: $('opt-buildings').checked });
  if (state.obs) { invalidate(); refreshPeaks(); }
});
resize();
window.__yama = state; // デバッグ用
