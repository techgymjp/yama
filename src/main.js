import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import MOUNTAINS from './data/mountains.json';
import STRUCTURES from './data/structures.json';
import OBSERVATORIES from './data/observatories.json';
import { createBgm } from './bgm.js';
import { Ads } from './ads.js';
import { t, isEn, setLang, applyI18n, mountainEn, prefEn, AREA_EN } from './i18n.js';

applyI18n(); // 端末の言語（または保存した言語）で表示する

// ---------------- サウンド（BGM・効果音） ----------------
const audio = createBgm();
const pref = (k, def) => { try { const v = localStorage.getItem(k); return v === null ? def : v === '1'; } catch { return def; } };
const savePref = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* 保存できない環境 */ } };
let bgmOn = pref('yama.bgm', true);
let difficulty = (() => { try { const v = localStorage.getItem('yama.difficulty'); return DIFFICULTY[v] ? v : 'normal'; } catch { return 'normal'; } })();
const diff = () => DIFFICULTY[difficulty];
let sfxOn = pref('yama.sfx', true);
const sfx = (name) => { if (sfxOn) audio.sfx(name); };

const DEG = Math.PI / 180;
const $ = (id) => document.getElementById(id);
const wrap180 = (a) => ((a % 360) + 540) % 360 - 180;
const dirName = (az) => t('dirs').split(',')[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
const fmtDist = (m) => (m < 10000 ? (m / 1000).toFixed(1) : Math.round(m / 1000)) + 'km';
const classLabel = (cls) => (cls === 100 || cls === 200 || cls === 300 ? t(`class.${cls}`) : '');
const RANK = { 100: 3, 200: 2, 300: 1, 0: 0 };
const rank = (p) => RANK[p.cls] || 0;
// 同名の山を区別するための表示名（例: 駒ヶ岳（北海道））
const NAME_COUNT = {};
for (const m of MOUNTAINS) NAME_COUNT[m.name] = (NAME_COUNT[m.name] || 0) + 1;
// 表示名（英語では山はローマ字、構造物・展望台は英語名）
const STRUCT_EN = Object.fromEntries(STRUCTURES.map((x) => [x.name, x.en]));
for (const m of MOUNTAINS) m.nameEn = mountainEn(m.yomi, m.name);
const dispName = (p) => (!isEn() ? p.name : (p.structure ? STRUCT_EN[p.name] || p.name : p.nameEn || mountainEn(p.yomi, p.name)));
const deckName = (o) => (isEn() ? o.en : o.name);
const prefName = (p) => (isEn() ? prefEn(p) : p);
const uniqueName = (m) => (NAME_COUNT[m.name] > 1 && m.pref ? (isEn() ? `${dispName(m)} (${prefEn(m.pref)})` : `${m.name}（${m.pref}）`) : dispName(m));
// 構造物ごとの展望台（同じ位置にある展望台）
const STRUCT_DECKS = {};
for (const st of STRUCTURES) {
  const decks = OBSERVATORIES.filter((o) => Math.hypot((o.lat - st.lat) * 111320, (o.lon - st.lon) * 111320 * Math.cos(st.lat * DEG)) < 150);
  if (decks.length) STRUCT_DECKS[st.name] = decks;
}
// 展望台の名前から建物名を除いた部分（例: 東京スカイツリー 天望回廊 → 天望回廊）
const deckShort = (d, struct) => {
  const n = d.name.replace(/（.*?）/g, '');
  const sp = n.indexOf(' ');
  // 「建物名 展望台名」の形なら展望台名だけ、それ以外（SHIBUYA SKY など）はそのまま
  return sp > 0 && struct.startsWith(n.slice(0, sp)) ? n.slice(sp + 1) : n;
};
function questSub(p) {
  return diff().noYomi && !isEn() ? describe(p).replace(`${p.yomi}・`, '') : describe(p);
}
function describe(p) {
  if (p.structure) {
    const decks = STRUCT_DECKS[p.name];
    return decks
      ? t('desc.structureDeck', { yomi: p.yomi, h: p.height, decks: decks.map((d) => `${isEn() ? d.deckEn : deckShort(d, p.name)} ${d.deck}m`).join(isEn() ? ', ' : '・') })
      : t('desc.structure', { yomi: p.yomi, h: p.height });
  }
  if (isEn()) {
    // 英語: 都道府県・標高・区分（よみや漢字の別名は出さない）
    return [prefEn(p.pref), t('desc.elev', { h: p.elev }), classLabel(p.cls)].filter(Boolean).join(' · ');
  }
  const parts = [p.yomi];
  if (p.alias || p.group) parts.push([p.alias, p.group].filter(Boolean).join('・'));
  if (p.pref) parts.push(p.pref);
  parts.push(t('desc.elev', { h: p.elev }));
  if (classLabel(p.cls)) parts.push(classLabel(p.cls));
  return parts.join('・');
}
const TOTAL_QUESTIONS = 10;
// 難易度
const DIFFICULTY = {
  easy: { key: 'easy', maxDist: 150000, tol: 1.5, miss: 10, hint: 0, guide: true, famousOnly: true },
  normal: { key: 'normal', maxDist: 260000, tol: 1.0, miss: 20, hint: 30, guide: false, famousOnly: false },
  hard: { key: 'hard', maxDist: 300000, tol: 0.7, miss: 25, hint: 50, guide: false, famousOnly: false, obscure: true, noYomi: true },
};
const HEIGHTS = [1.6, 5, 10, 20, 30, 50, 100, 150, 200, 300, 500, 700, 1000, 1500, 2000, 3000, 5000];

// ---------------- 状態 ----------------
const state = {
  obs: null,            // { lat, lon, ground, name }
  hIdx: 0,              // HEIGHTS のインデックス（地上からの視点の高さ）
  heading: 0, pitch: 2, fov: 60,
  peaks: [],            // 見える/見えない判定付き
  showLabels: false,
  paused: false, pausedAt: 0, follow: false,
  game: { target: null, misses: 0, hinted: false, revealed: false, recent: [], round: 0, points: 0, correct: 0, history: [], waiting: false, finished: false, qStart: 0, totalMs: 0 },
  found: null,          // { peak, until }
  tapMark: null,
};
// 展望台から見るときは、その展望台の高さ（HEIGHTS にない値）を使う
const eyeHeight = () => (state.hOverride != null ? state.hOverride : HEIGHTS[state.hIdx]);
const h0 = () => (state.obs ? state.obs.ground + eyeHeight() : 0);

function snowline() {
  const v = $('opt-snow').value;
  if (v !== 'auto') return +v;
  const m = new Date().getMonth() + 1;
  return { 1: 1500, 2: 1500, 3: 1600, 4: 1900, 5: 2300, 6: 2700, 7: 0, 8: 0, 9: 0, 10: 2900, 11: 2500, 12: 1700 }[m];
}

// ---------------- 画面上のエラー表示 ----------------
function showError(msg) {
  try { toast(t('error', { msg }), 'bad', 6000); } catch { alert(t('error', { msg })); }
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
  // web-only:start（撮影・テスト用のフック。アプリには入れない）
  window.__lastRenderMs = m.ms;
  // web-only:end
  // web-only:start（撮影・テスト用のフック。アプリには入れない）
  window.__renderCount = (window.__renderCount || 0) + 1;
  // web-only:end
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
  if ((g.hinted || diff().guide) && g.target && !g.revealed) {
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
  const text = t('badge', { side: t(right ? 'badge.right' : 'badge.left'), deg: Math.round(Math.abs(diff)) });
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
    const label = big ? `${dispName(o.p)}${isEn() ? ` (${fmtDist(o.p.dist)})` : `（${fmtDist(o.p.dist)}）`}` : dispName(o.p);
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
  $('height-label').innerHTML = `<span class="h-total">${t('height.total', { h: total })}</span>`;
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
      if (state.follow) setFollow(false, t('follow.off'));
      state.heading = gesture.heading - dx / f / DEG;
    } else if (gesture.axis === 'v') {
      state.pitch = Math.atan(Math.tan(gesture.pitch * DEG) + dy / f) / DEG;
    }
    if (gesture.axis) gesture.moved = true;
  } else if (pts.length === 1) {
    // 1本指（マウス）ドラッグでも視点移動
    const dx = p.x - gesture.mx, dy = p.y - gesture.my;
    if (!gesture.axis && Math.hypot(p.x - p.x0, p.y - p.y0) > 8) gesture.axis = axisOf(dx, dy);
    if (gesture.axis === 'h' && state.follow) setFollow(false, t('follow.off'));
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
  let n;
  if (state.hOverride != null) {
    // 展望台の高さから、上（下）の段へ
    const cur = state.hOverride;
    n = dir > 0 ? HEIGHTS.findIndex((v) => v > cur) : HEIGHTS.length - 1 - [...HEIGHTS].reverse().findIndex((v) => v < cur);
    if (n < 0 || n >= HEIGHTS.length) return;
    state.hOverride = null;
  } else {
    n = Math.max(0, Math.min(HEIGHTS.length - 1, state.hIdx + dir));
    if (n === state.hIdx) return;
  }
  state.hIdx = n;
  sfx(dir > 0 ? 'up' : 'down');
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
  Object.assign(state.game, { target: null, misses: 0, hinted: false, revealed: false, recent: [], round: 0, points: 0, correct: 0, history: [], waiting: false, finished: false, qStart: 0, totalMs: 0, retries: 0, preRevealView: null });
  $('result').classList.add('hidden');
  updateScore();
}
// ---- タイム（各問の出題から正解・パスまで） ----
const fmtTime = (ms) => {
  const t_ = ms / 1000;
  return t_ < 60 ? t('time.s', { s: t_.toFixed(1) }) : t('time.ms', { m: Math.floor(t_ / 60), s: (t_ % 60).toFixed(1).padStart(4, '0') });
};
const questionRunning = () => { const g = state.game; return g.target && !g.waiting && !g.finished && !g.revealed && g.qStart && !state.paused; };
function elapsedMs() {
  const g = state.game;
  const now = state.paused ? state.pausedAt : performance.now();
  const running = g.target && !g.waiting && !g.finished && !g.revealed && g.qStart;
  return g.totalMs + (running ? now - g.qStart : 0);
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
  $('score').textContent = t('score', { q: Math.max(1, g.round), total: TOTAL_QUESTIONS, pts: g.points, sec: Math.floor(elapsedMs() / 1000) });
}
setInterval(() => { if (state.obs && questionRunning()) updateScore(); }, 250);

function nextQuest() {
  const g = state.game;
  g.waiting = false;
  if (g.finished) return;
  if (g.round >= TOTAL_QUESTIONS) { showResult(); return; }
  const D = diff();
  let cands = state.peaks.filter((p) => p.visible && !p.here && p.dist > 800 && p.dist < D.maxDist);
  if (D.famousOnly) {
    // かんたん: 有名な山・展望台のある建物だけ（少なすぎる場所では、ふつうと同じ候補）
    const famous = cands.filter((p) => p.cls === 100 || p.name === '富士山' || (p.structure && STRUCT_DECKS[p.name]));
    if (famous.length >= 3) cands = famous;
  }
  const pool = cands.filter((p) => !g.recent.includes(p.name));
  const list = pool.length ? pool : cands;
  Object.assign(g, { misses: 0, hinted: false, revealed: false, target: null });
  if (!list.length) {
    $('quest-prefix').textContent = '';
    $('quest-name').textContent = t('quest.none');
    $('quest-suffix').textContent = '';
    $('quest-sub').textContent = t('quest.noneSub');
    draw();
    return;
  }
  // 百名山・富士山・目立つ山を出やすく
  const weight = (p) => (D.obscure
    // むずかしい: 無名の山・遠い山ほど出やすく
    ? (p.structure ? 2 : [4, 2.5, 1.5, 1][rank(p)]) * (1 + Math.min(2, p.dist / 100000))
    : (p.name === '富士山' ? 6 : 1) * (p.structure ? (STRUCT_DECKS[p.name] ? 12 : 8) : [1, 3, 5, 10][rank(p)]) * (1 + Math.min(3, Math.max(0, p.tanAlt + 0.05) * 40)));
  let r = Math.random() * list.reduce((s, p) => s + weight(p), 0);
  let pick = list[0];
  for (const p of list) { r -= weight(p); if (r <= 0) { pick = p; break; } }
  g.target = pick;
  g.round++;
  g.qStart = performance.now();
  updateScore();
  g.recent = [pick.name, ...g.recent].slice(0, Math.min(8, Math.floor(cands.length / 2)));
  $('quest-prefix').textContent = t('quest.prefix');
  $('quest-name').textContent = dispName(pick);
  $('quest-suffix').textContent = t('quest.suffix', { n: g.round });
  sfx('quest');
  $('quest-sub').textContent = questSub(pick);
  draw();
}

function onTap(x, y) {
  const g = state.game;
  if (!g.target || g.revealed) return;
  const { az, tanAlt } = unproject(x, y);
  const tp = project(g.target.az, g.target.tanAlt);
  const D = diff();
  const tolX = Math.max(26 * D.tol, focal() * 1.0 * DEG * D.tol);
  const hit = Math.abs(x - tp.x) <= tolX && y >= tp.y - 45 * D.tol && y <= tp.y + Math.max(60, focal() * 2 * DEG) * D.tol;
  state.tapMark = { az, tanAlt, ok: hit, until: performance.now() + 1200 };
  if (hit) {
    const pts = Math.max(10, 100 - g.misses * D.miss - (g.hinted ? D.hint : 0));
    const ms = stopQuestionTimer();
    g.correct++;
    g.points += pts;
    g.history.push({ name: dispName(g.target), ok: true, pts, ms });
    updateScore();
    sfx('correct');
    toast(t('correct', { name: dispName(g.target), dist: fmtDist(g.target.dist), pts, time: fmtTime(ms) }), 'good', 2500);
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
    toast(best ? t('wrongAt', { name: dispName(best), yomi: best.yomi }) : t('wrong'), 'bad');
    if (g.misses >= 3 && !g.hinted) showHint();
  }
  draw();
  setTimeout(draw, 1300);
}

function showHint() {
  const g = state.game;
  if (!g.target) return;
  g.hinted = true;
  $('quest-sub').textContent = t('hint', { dir: dirName(g.target.az), deg: Math.round(g.target.az), dist: fmtDist(g.target.dist) });
  draw();
}
// ---------------- 結果 ----------------
function showResult() {
  const g = state.game;
  g.finished = true;
  g.target = null;
  const max = TOTAL_QUESTIONS * 100;
  const rate = g.points / max;
  const title = t(`title.${rate >= 0.9 ? 0 : rate >= 0.7 ? 1 : rate >= 0.45 ? 2 : rate >= 0.2 ? 3 : 4}`);
  $('result-title').textContent = title;
  $('result-score').textContent = t('result.pts', { pts: g.points });
  $('result-detail').textContent = t('result.detail', { level: t(`level.${difficulty}`), total: TOTAL_QUESTIONS, correct: g.correct, max });
  $('result-time').textContent = t('result.time', { time: fmtTime(g.totalMs) }) + (g.retries ? t('result.retries', { n: g.retries }) : '');
  const isBest = saveBest(g.points, g.totalMs);
  $('result-best').textContent = isBest ? t('result.newBest', { level: t(`level.${difficulty}`) }) : bestText();
  $('result-list').innerHTML = g.history.map((h, i) =>
    `<li><span>${t('result.q', { n: i + 1, name: h.name })}</span><span class="t">${fmtTime(h.ms)}</span><span class="${h.ok ? 'ok' : 'ng'}">${h.ok ? t('result.ok', { pts: h.pts }) : t('result.pass')}</span></li>`).join('');
  updateScore();
  $('result').classList.remove('hidden');
  sfx(rate >= 0.45 ? 'result' : 'resultLow');
  $('quest-prefix').textContent = '';
  $('quest-name').textContent = t('quest.result');
  $('quest-suffix').textContent = '';
  $('quest-sub').textContent = '';
  draw();
}
// ---------------- 言語（日本語 / English） ----------------
// プライバシーポリシーは言語に合わせたページへ
function updatePrivacyLink() { $('privacy-link').href = isEn() ? 'https://techgym.jp/privacy-policy-en/' : 'https://techgym.jp/privacy-policy/'; }
updatePrivacyLink();
function refreshLanguage() {
  applyI18n();
  updatePrivacyLink();
  showBest();
  updateBgmButton();
  buildDeckSelect();
  buildPeakList();
  if (legendEl) legendEl.innerHTML = t('map.legend');
  if (!picked) $('picker-info').textContent = t('picker.info');
  updateScore();
  draw();
}
$('btn-lang').addEventListener('click', () => { setLang(isEn() ? 'ja' : 'en'); refreshLanguage(); });

// ---------------- 難易度の選択（開始画面・結果画面） ----------------
function updateDifficultyButtons() {
  document.querySelectorAll('.difficulty button').forEach((b) => b.classList.toggle('on', b.dataset.level === difficulty));
}
document.querySelectorAll('.difficulty button').forEach((b) => b.addEventListener('click', () => {
  difficulty = b.dataset.level;
  try { localStorage.setItem('yama.difficulty', difficulty); } catch { /* 保存できない環境 */ }
  updateDifficultyButtons();
}));
updateDifficultyButtons();

// ---------------- シェア ----------------
const SHARE_URL = 'https://techgym.jp/column/claude-code-game-yama/';
function shareText() {
  const g = state.game;
  const place = state.obs && state.obs.name && !state.obs.generic ? t('share.place', { name: state.obs.name }) : '';
  return t('share.text', { level: t(`level.${difficulty}`), pts: g.points, title: $('result-title').textContent, place, total: TOTAL_QUESTIONS, correct: g.correct, time: fmtTime(g.totalMs), retries: g.retries ? t('share.retries', { n: g.retries }) : '' });
}
function openShare(url) { window.open(url, '_blank', 'noopener'); }
$('btn-share').addEventListener('click', async () => {
  const text = shareText();
  const nativeShare = plugin('Share');
  if (nativeShare) {
    try { await nativeShare.share({ title: t('app.title'), text, url: SHARE_URL, dialogTitle: t('share.dialog') }); } catch { /* キャンセル */ }
    return;
  }
  if (navigator.share) {
    try { await navigator.share({ title: t('app.title'), text, url: SHARE_URL }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  openShare(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(SHARE_URL)}`);
});
$('btn-share-x').addEventListener('click', () => {
  openShare(`https://x.com/intent/post?text=${encodeURIComponent(shareText())}&url=${encodeURIComponent(SHARE_URL)}`);
});
$('btn-share-line').addEventListener('click', () => {
  openShare(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(SHARE_URL)}&text=${encodeURIComponent(shareText())}`);
});
$('btn-share-copy').addEventListener('click', async () => {
  const text = `${shareText()} ${SHARE_URL}`;
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* コピー不可 */ }
    ta.remove();
  }
  toast(t('share.copied'), 'good', 1800);
});

$('btn-again').addEventListener('click', async () => { sfx('start'); await interstitial(); resetGame(); nextQuest(); });
$('btn-result-place').addEventListener('click', () => { $('result').classList.add('hidden'); openPicker(); });
$('btn-result-top').addEventListener('click', () => goTop());
$('btn-result-view').addEventListener('click', () => { $('result').classList.add('hidden'); state.showLabels = true; $('btn-labels').classList.add('on'); draw(); });

$('btn-hint').addEventListener('click', () => { showHint(); });
$('btn-skip').addEventListener('click', () => {
  const g = state.game;
  if (g.finished) { sfx('tap'); $('result').classList.remove('hidden'); return; }
  if (g.waiting) return;
  if (!g.target) { nextQuest(); return; }
  g.revealed = true;
  g.waiting = true;
  g.preRevealView = { heading: state.heading, pitch: state.pitch };
  g.history.push({ name: dispName(g.target), ok: false, pts: 0, ms: stopQuestionTimer() });
  updateScore();
  sfx('reveal');
  // 答えは上部のお題の欄に出す（景色の山にメッセージが重ならないように）
  $('quest-sub').textContent = t('answer', { name: dispName(g.target), dir: dirName(g.target.az), dist: fmtDist(g.target.dist) });
  // 山頂が画面の中央やや下（上から55%）に来るように向ける（ズームに関係なく収まる）
  animateTo(g.target.az, Math.atan(g.target.tanAlt + 0.05 * cssH / focal()) / DEG);
  // アプリでは、答えを見届けてから「広告を見てもう一度挑戦」を提案する（1 ゲーム 3 回まで）
  if (Ads.canReward && g.retries < MAX_RETRIES) setTimeout(offerRetry, 2600);
  else setTimeout(nextQuest, 3200);
});
$('btn-labels').addEventListener('click', () => {
  state.showLabels = !state.showLabels;
  $('btn-labels').classList.toggle('on', state.showLabels);
  sfx(state.showLabels ? 'toggleOn' : 'toggleOff');
  draw();
});
// ---------------- コンパス追従（端末の向きに合わせて景色の方角が動く） ----------------
function setFollow(on, note = '') {
  state.follow = on;
  $('btn-follow').classList.toggle('on', on);
  $('btn-follow').setAttribute('aria-pressed', String(on));
  if (note) toast(note, '', 2200);
  if (on) followLoop();
}
$('btn-follow').addEventListener('click', async () => {
  if (state.follow) { sfx('toggleOff'); setFollow(false); return; }
  enableCompass();
  // 向きの値が届くまで少し待つ（届かなければコンパスのない端末）
  for (let i = 0; i < 15 && deviceHeading === null; i++) await new Promise((r) => setTimeout(r, 100));
  if (deviceHeading === null) { sfx('wrong'); toast(t('follow.none'), 'bad', 2500); return; }
  sfx('toggleOn');
  setFollow(true, t('follow.on'));
});
// 毎フレーム、端末の向きへ滑らかに近づける
let followRaf = 0;
function followLoop() {
  if (followRaf) return;
  const step = () => {
    followRaf = 0;
    if (!state.follow) { setInteracting(false); return; }
    // パスで答えを見せている間は止める（答えの方角へ向けた画面を戻さない）
    if (deviceHeading !== null && playing() && !state.paused && !state.game.revealed) {
      const d = wrap180(deviceHeading - state.heading);
      if (Math.abs(d) > 0.15) {
        state.heading = (state.heading + d * 0.25 + 360) % 360;
        setInteracting(true);
        requestRender();
        setInteracting(false);
      }
    }
    followRaf = requestAnimationFrame(step);
  };
  followRaf = requestAnimationFrame(step);
}
// BGM のオン・オフ
function updateBgmButton() {
  $('btn-bgm').classList.toggle('on', bgmOn);
  $('btn-bgm').textContent = t(bgmOn ? 'tb.bgmOn' : 'tb.bgmOff');
}
$('btn-bgm').addEventListener('click', () => {
  bgmOn = !bgmOn;
  savePref('yama.bgm', bgmOn);
  sfx(bgmOn ? 'toggleOn' : 'toggleOff');
  audio.unlock();
  if (bgmOn) audio.start(); else audio.stop();
  updateBgmButton();
});
updateBgmButton();
$('opt-sfx').checked = sfxOn;
$('opt-sfx').addEventListener('change', () => { sfxOn = $('opt-sfx').checked; savePref('yama.sfx', sfxOn); });
// すべてのボタン・地図のズーム・設定の開閉にタップ音
document.addEventListener('click', (e) => {
  const b = e.target.closest('button, .leaflet-control-zoom a, summary');
  if (!b || b.disabled || b.dataset.sfx === 'none') return;
  sfx('tap');
}, true);
// 選択欄・チェックボックス・検索欄の確定にもタップ音
document.addEventListener('change', (e) => {
  if (e.target.matches('select, input[type="checkbox"], #search')) sfx('tap');
}, true);
// ---------------- アプリ（Android）対応・画面の流れ ----------------
// Android アプリ（Capacitor）で動いているか。Web 版では Capacitor がないので何もしない
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const plugin = (name) => (NATIVE && window.Capacitor.Plugins ? window.Capacitor.Plugins[name] : null);
const MAX_RETRIES = 3;
Ads.hooks.pause = () => audio.suspend();
Ads.hooks.resume = () => { if (!document.hidden) audio.resume(); };
// 全画面広告（プレイ開始・トップに戻る・再開・もう一度 のたび）。読み込めていなければ最大 1.5 秒だけ待つ
const interstitial = () => Ads.showInterstitial(1500);
if (NATIVE) document.documentElement.classList.add('native');
// バナーを出す画面では、下のボタンが隠れないよう余白をとる
if (Ads.available) document.documentElement.style.setProperty('--banner-h', '56px');

const isShown = (id) => !$(id).classList.contains('hidden');
const playing = () => !!state.obs && !['start', 'howto', 'picker', 'result', 'loading'].some(isShown);

// バナーはトップ・あそびかた・ポーズ・結果画面だけ（プレイ中は操作ボタンと重なるので出さない）
function updateBanner() {
  Ads.setBanner(['start', 'howto', 'pause', 'result'].some(isShown) && !isShown('picker') && !isShown('loading'));
}
new MutationObserver(updateBanner).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
updateBanner();

// トップ画面へ（あそびかた・ポーズ・結果画面から）
async function goTop() {
  await interstitial();
  ['howto', 'pause', 'result', 'picker', 'retry-offer'].forEach((id) => $(id).classList.add('hidden'));
  state.paused = false;
  showBest();
  $('start').classList.remove('hidden');
}

// 一時停止
function pauseGame() {
  if (!playing() || state.paused) return;
  state.paused = true;
  state.pausedAt = performance.now();
  $('pause').classList.remove('hidden');
}
async function resumeGame() {
  if (!state.paused) return;
  await interstitial();
  const g = state.game;
  if (g.qStart) g.qStart += performance.now() - state.pausedAt; // 止めていた時間はタイムに入れない
  state.paused = false;
  $('pause').classList.add('hidden');
  updateScore();
}
$('btn-pause').addEventListener('click', () => pauseGame());
$('btn-resume').addEventListener('click', () => resumeGame());
$('btn-pause-top').addEventListener('click', () => goTop());

// あそびかた
$('btn-howto').addEventListener('click', () => { $('howto').classList.remove('hidden'); $('howto').scrollTop = 0; });
$('btn-howto-back').addEventListener('click', () => goTop());

// ベスト記録（難易度ごと。点数が高い方、同点ならタイムが短い方）
function loadBest(level = difficulty) {
  try { return JSON.parse(localStorage.getItem(`yama.best.${level}`) || 'null'); } catch { return null; }
}
function saveBest(points, ms) {
  const b = loadBest();
  if (b && (b.points > points || (b.points === points && b.ms <= ms))) return false;
  try { localStorage.setItem(`yama.best.${difficulty}`, JSON.stringify({ points, ms })); } catch { /* 保存できない環境 */ }
  return true;
}
function bestText() {
  const b = loadBest();
  return b ? t('best', { level: t(`level.${difficulty}`), pts: b.points, time: fmtTime(b.ms) }) : '';
}
function showBest() { $('best').textContent = bestText(); }
document.querySelectorAll('.difficulty button').forEach((b) => b.addEventListener('click', showBest));
showBest();

// ビルド番号・広告の設定（EU など同意が必要な地域だけ）
if (window.APP_VERSION && window.APP_VERSION !== 'dev') $('build-info').textContent = window.APP_VERSION;
Ads.initDone.then(() => { if (Ads.privacyOptionsRequired) $('ad-privacy').classList.remove('hidden'); });
$('ad-privacy').addEventListener('click', (e) => { e.preventDefault(); Ads.showPrivacyOptions(); });

// リワード広告: パスした問題にもう一度挑戦（答えを見届けてから案内し、数秒で自動的に次へ）
let retryTimer = 0;
function offerRetry() {
  const g = state.game;
  if (!g.revealed || g.finished) { nextQuest(); return; }
  $('retry-left').textContent = t('retry.left', { n: MAX_RETRIES - g.retries });
  $('retry-offer').classList.remove('hidden');
  const bar = $('retry-bar');
  bar.style.transition = 'none'; bar.style.width = '100%';
  requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transition = 'width 5s linear'; bar.style.width = '0%'; }));
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => closeRetry(false), 5000);
}
async function closeRetry(watch) {
  clearTimeout(retryTimer);
  if ($('retry-offer').classList.contains('hidden')) return;
  $('retry-offer').classList.add('hidden');
  if (watch && (await Ads.showRewarded()) === 'rewarded') { retryQuestion(); return; }
  nextQuest();
}
$('btn-retry-ad').addEventListener('click', () => closeRetry(true));
$('btn-retry-skip').addEventListener('click', () => closeRetry(false));
// パスをなかったことにして、同じ問題・同じ向きからやり直す
function retryQuestion() {
  const g = state.game;
  const last = g.history.pop();
  if (last) g.totalMs -= last.ms;
  Object.assign(g, { misses: 0, hinted: false, revealed: false, waiting: false, retries: g.retries + 1, qStart: performance.now() });
  if (g.preRevealView) animateTo(g.preRevealView.heading, g.preRevealView.pitch);
  $('quest-sub').textContent = questSub(g.target);
  updateScore();
  sfx('quest');
  toast(t('retry.toast', { n: g.retries }), 'good', 2000);
  draw();
}

// Android の戻るボタン: プレイ中は一時停止、トップや結果画面ではアプリを終了
const AppPlugin = plugin('App');
if (AppPlugin) {
  AppPlugin.addListener('backButton', () => {
    if (Ads.showing) return;
    if (isShown('retry-offer')) { closeRetry(false); return; }
    if (isShown('howto')) { goTop(); return; }
    if (isShown('picker')) { $('btn-picker-cancel').click(); return; }
    if (isShown('pause')) { resumeGame(); return; }
    if (isShown('start') || isShown('result')) { AppPlugin.exitApp(); return; }
    if (playing()) pauseGame();
  });
}

// 別のアプリに切り替えたら、自動で一時停止して音も止める
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

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
let deviceHeading = null;   // 最新の向き（度、北=0・時計回り）
let pressHeading = null;    // スタートを押した直後の向き
let capturePending = false;
let iosOffset = null;       // iOS: 相対 alpha から真北への補正
const screenAngle = () => (screen.orientation && screen.orientation.angle) || window.orientation || 0;

// alpha/beta/gamma から「画面の裏側（背面カメラ）が向いている方角」を求める。
// 端末をほぼ水平に寝かせているときは、画面の上端が向いている方角を使う。
function headingFromAngles(alpha, beta, gamma) {
  const a = alpha * DEG, b = beta * DEG, g = gamma * DEG;
  const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
  // 端末の z 軸（画面から手前へ）を地球座標（x=東, y=北, z=上）で表したもの。背面カメラはその逆向き
  const vx = -(cA * sG + sA * sB * cG), vy = -(sA * sG - cA * sB * cG), vz = -(cB * cG);
  if (Math.abs(vz) < 0.8) return (Math.atan2(vx, vy) / DEG + 360) % 360;
  // 寝かせている: 画面上端の方角（画面の回転も考慮）
  return (360 - alpha + screenAngle() + 360) % 360;
}

function onOrientation(e) {
  if (typeof e.alpha !== 'number' || typeof e.beta !== 'number' || typeof e.gamma !== 'number') return;
  let h;
  if (typeof e.webkitCompassHeading === 'number') {
    // iOS: alpha は相対値なので、webkitCompassHeading（上端の真の方角）との差で補正する
    const topRel = (360 - e.alpha + 360) % 360;
    iosOffset = (e.webkitCompassHeading - topRel + 360) % 360;
    h = (headingFromAngles(e.alpha, e.beta, e.gamma) + iosOffset) % 360;
  } else if (e.absolute || e.type === 'deviceorientationabsolute') {
    h = headingFromAngles(e.alpha, e.beta, e.gamma);
  } else return;
  deviceHeading = h;
  if (capturePending) { pressHeading = h; capturePending = false; }
}
// スタートを押した瞬間の向きを記録する（押した直後に届いた最初の値）
// web-only:start（撮影・テスト用のフック。アプリには入れない）
window.__compass = () => ({ deviceHeading, pressHeading, capturePending, listening: !!enableCompass.listening }); // デバッグ用
// web-only:end
function markStartHeading() {
  pressHeading = null;
  capturePending = true;
}
async function enableCompass() {
  // 先に受け取りを始める（許可がなければイベントが来ないだけなので害はない）。
  // requestPermission は iOS のほか新しい Chrome にもあり、"granted" 以外（"prompt" など）を返すことがあるため、
  // その結果で受け取りをやめてはいけない。
  if (!enableCompass.listening) {
    enableCompass.listening = true;
    window.addEventListener('deviceorientationabsolute', onOrientation);
    window.addEventListener('deviceorientation', onOrientation);
  }
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      await DeviceOrientationEvent.requestPermission();
    }
  } catch { /* 許可の確認ができない環境 */ }
}
async function readHeading() {
  // 押した瞬間の向きがあればそれを使う（読み込み中に端末を動かしても、押した時の方角で始まる）
  for (let i = 0; i < 15 && pressHeading === null && deviceHeading === null; i++) await new Promise((r) => setTimeout(r, 100));
  return pressHeading ?? deviceHeading;
}

// ---------------- 開始・地点の読み込み ----------------
async function startAt(lat, lon, { name = '', summit = 0, snapped = false, deck = 0, generic = false } = {}) {  // deck: 展望台の高さ  // summit: 山頂の標高
  $('start').classList.add('hidden');
  $('picker').classList.add('hidden');
  $('loading').classList.remove('hidden');
  $('loading-bar').style.width = '0%';
  $('loading-text').textContent = name ? t('load.terrainAt', { name }) : t('load.terrain');
  try {
    const r = await call({ type: 'load', lat, lon });
    let ground = r.ground;
    if (summit) ground = Math.max(ground, summit);
    state.obs = { lat, lon, ground, name, generic };
    // 市街地では建物に視界をさえぎられるので、屋上の高さ(30m)から始める
    const urbanStart = !summit && !deck && $('opt-buildings').checked && r.urban > 0.35;
    state.hIdx = urbanStart ? HEIGHTS.indexOf(30) : 0;
    state.hOverride = deck || null;
    const h = await readHeading();
    state.heading = h ?? 0;
    state.pitch = 2;
    state.fov = window.innerWidth < window.innerHeight ? 40 : 60;
    ['topbar', 'compass', 'height-ctrl', 'toolbar'].forEach((id) => $(id).classList.remove('hidden'));
    $('loading-text').textContent = t('load.peaks');
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
    if (snapped) notes.push(t('note.summit', { name, h: summit }));
    if (deck) notes.push(t('note.deck', { name, h: deck }));
    if (urbanStart) notes.push(t('note.urban'));
    if (h === null) notes.push(t('note.noCompass'));
    if (notes.length) toast(notes.join('\n'), '', 4500);
  } catch (err) {
    $('loading').classList.add('hidden');
    toast(t('load.failed', { msg: err.message }), 'bad', 4000);
    if (!state.obs) $('start').classList.remove('hidden');
  }
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error(t('geo.unavailable'))); return; }
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
  markStartHeading();
  sfx('start');
  initWorker();
  enableCompass();
  await interstitial();
  try {
    const { lat, lon } = await getPosition();
    if (!inJapan(lat, lon)) { toast(t('geo.outside'), 'bad', 3500); openPicker(); return; }
    const sm = nearbySummit(lat, lon);
    if (sm) startAt(sm.lat, sm.lon, { name: uniqueName(sm), summit: sm.elev, snapped: true });
    else startAt(lat, lon, { name: t('place.current'), generic: true });
  } catch {
    toast(t('geo.failed'), 'bad', 3500);
    openPicker();
  }
});
$('btn-start-place').addEventListener('click', () => { audio.unlock(); initWorker(); enableCompass(); openPicker(); });

// ---------------- 地点選択（地図） ----------------
let map = null, marker = null, picked = null, legendEl = null;
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
        .bindTooltip(() => `${dispName(m)} ${m.elev}m${classLabel(m.cls) ? (isEn() ? ` (${classLabel(m.cls)})` : `（${classLabel(m.cls)}）`) : ''}`).on('click', () => { sfx('tap'); pick(m.lat, m.lon, uniqueName(m), m.elev); }).addTo(map);
    }
    // 展望台（同じ建物の展望台は1つの印にまとめ、タップで選ぶ）
    const deckIcon = L.divIcon({
      className: 'deck-marker',
      html: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 2l1.2 5h-2.4zM10.6 8h2.8l.9 6h-4.6zM9.4 15h5.2l1.6 7h-2.3l-.9-4h-2l-.9 4H7.8z" fill="#1d2b3a"/></svg>',
      iconSize: [26, 26], iconAnchor: [13, 13],
    });
    const groups = new Map();
    OBSERVATORIES.forEach((o, i) => {
      const k = `${o.lat},${o.lon}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    });
    for (const idxs of groups.values()) {
      const o0 = OBSERVATORIES[idxs[0]];
      const html = () => `<div class="deck-popup"><div class="deck-popup-title">${t('map.deckTitle')}</div>${idxs.map((i) =>
        `<button data-deck="${i}">${deckName(OBSERVATORIES[i])}<span>${t('map.deckHeight', { h: OBSERVATORIES[i].deck })}</span></button>`).join('')}</div>`;
      L.marker([o0.lat, o0.lon], { icon: deckIcon, zIndexOffset: 1000, title: idxs.map((i) => OBSERVATORIES[i].name).join(' / ') })
        .bindPopup(html, { closeButton: true, autoPanPadding: [20, 20] })
        .addTo(map);
    }
    map.on('popupopen', (e) => {
      if (e.popup.getElement().querySelector('.deck-popup')) sfx('tap');
      e.popup.getElement().querySelectorAll('button[data-deck]').forEach((b) => b.addEventListener('click', () => {
        selectDeck(+b.dataset.deck);
        map.closePopup();
      }));
    });
    // 凡例
    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = () => {
      const d = L.DomUtil.create('div', 'map-legend');
      d.innerHTML = t('map.legend');
      legendEl = d;
      return d;
    };
    legend.addTo(map);
    map.on('click', (e) => { sfx('tap'); pick(e.latlng.lat, e.latlng.lng, '', false); });
    if (state.obs) pick(state.obs.lat, state.obs.lon, state.obs.name, false);
  }
  setTimeout(() => map.invalidateSize(), 50);
}
function pick(lat, lon, name, summit, deck = 0) {
  picked = { lat, lon, name, summit, deck };
  marker.setLatLng([lat, lon]).addTo(map);
  if (!deck) $('deck-select').value = '';
  $('picker-info').textContent = deck ? t('picker.deckInfo', { name, h: deck }) : `${name ? `${name}${summit ? (isEn() ? ` ${t('place.summit')}` : ` ${t('place.summit')}`) : ''} ` : ''}(${lat.toFixed(4)}, ${lon.toFixed(4)})`;
  $('btn-picker-ok').disabled = false;
}
$('btn-picker-ok').addEventListener('click', () => {
  if (!picked) return;
  audio.unlock();
  markStartHeading();
  sfx('start');
  enableCompass();
  const p = picked;
  interstitial().then(() => startAt(p.lat, p.lon, { name: p.name || t('place.selected'), generic: !p.name, summit: p.summit, deck: p.deck }));
});
$('btn-picker-cancel').addEventListener('click', () => {
  $('picker').classList.add('hidden');
  if (!state.obs) $('start').classList.remove('hidden');
});
$('btn-here').addEventListener('click', async () => {
  try {
    const { lat, lon } = await getPosition();
    const sm = nearbySummit(lat, lon);
    if (sm) { map.setView([sm.lat, sm.lon], 13); pick(sm.lat, sm.lon, uniqueName(sm), sm.elev); toast(t('geo.nearSummit', { name: uniqueName(sm) }), '', 2500); }
    else { map.setView([lat, lon], 12); pick(lat, lon, t('place.current'), false); }
  } catch { toast(t('geo.failedShort'), 'bad'); }
});
$('search').addEventListener('change', (e) => {
  const v = e.target.value.trim();
  const lv = v.toLowerCase();
  const m = MOUNTAINS.find((x) => uniqueName(x) === v) || MOUNTAINS.find((x) => x.name === v || x.yomi === v || x.alias === v || (x.nameEn && x.nameEn.toLowerCase() === lv));
  if (!m) return;
  map.setView([m.lat, m.lon], 12);
  pick(m.lat, m.lon, uniqueName(m), m.elev);
  e.target.blur();
});

// 展望台から見る
{
  const areas = [...new Set(OBSERVATORIES.map((o) => o.area))];
  buildDeckSelect();
}
function buildDeckSelect() {
  const areas = [...new Set(OBSERVATORIES.map((o) => o.area))];
  const cur = $('deck-select').value;
  $('deck-select').innerHTML = `<option value="">${t('picker.deckSelect')}</option>` + areas.map((a) =>
    `<optgroup label="${isEn() ? AREA_EN[a] || a : a}">${OBSERVATORIES.map((o, i) => (o.area === a ? `<option value="${i}">${deckName(o)}${isEn() ? ` (${o.deck} m)` : `（${o.deck}m）`}</option>` : '')).join('')}</optgroup>`).join('');
  $('deck-select').value = cur;
}
function selectDeck(i) {
  const o = OBSERVATORIES[i];
  map.setView([o.lat, o.lon], Math.max(map.getZoom(), 13));
  pick(o.lat, o.lon, deckName(o), 0, o.deck);
  $('deck-select').value = String(i);
}
$('deck-select').addEventListener('change', (e) => {
  if (e.target.value === '') return;
  selectDeck(+e.target.value);
});
$('btn-start-deck').addEventListener('click', () => {
  audio.unlock(); initWorker(); enableCompass(); openPicker();
  setTimeout(() => { $('deck-select').focus(); if ($('deck-select').showPicker) try { $('deck-select').showPicker(); } catch { /* 非対応 */ } }, 300);
});

// datalist
function buildPeakList() {
  $('peak-list').innerHTML = MOUNTAINS.map((m) => `<option value="${uniqueName(m)}">${isEn() ? '' : m.yomi + ' '}${m.elev}m</option>`).join('');
}
buildPeakList();
$('opt-source').addEventListener('change', () => initWorker());
$('opt-snow').addEventListener('change', () => invalidate());
$('opt-buildings').addEventListener('change', () => {
  worker.postMessage({ type: 'options', buildings: $('opt-buildings').checked });
  if (state.obs) { invalidate(); refreshPeaks(); }
});
resize();
// web-only:start（撮影・テスト用のフック。アプリには入れない）
window.__yama = state; // デバッグ用
// web-only:end
