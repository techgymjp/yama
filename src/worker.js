// 標高タイルの読み込みと景色のレンダリングを行う Web Worker
// 投影: 横 = 方位角に比例（円筒）、縦 = f * tan(仰角)

const R = 6371000;          // 地球半径
const K_REFR = 0.13;        // 大気差（屈折）係数
const MAX_DIST = 300000;    // 描画最大距離 [m]
const H_MAX = 3800;         // 地形の最大標高（早期打ち切り用）
const DEG = Math.PI / 180;

// 解像度の異なる 3 レイヤー（近距離ほど高解像度）
const LEVELS = [
  { z: 14, radius: 2500 },
  { z: 12, radius: 10000 },
  { z: 10, radius: 80000 },
  { z: 8, radius: MAX_DIST },
];

let source = 'gsi';
let levels = [];       // { z, x0, y0, w, h, data, radius, n }
let observer = null;   // { lat, lon, ground }
let peaks = [];

// タイルの取得・デコードはメインスレッドで行う（OffscreenCanvas 非対応のブラウザ向け）
const tileCache = new Map(); // key -> Float32Array(65536) | null
const tileWaiters = new Map();
let tileReq = 0;
function getTile(z, x, y) {
  const key = `${source}/${z}/${x}/${y}`;
  if (tileCache.has(key)) return Promise.resolve(tileCache.get(key));
  return new Promise((resolve) => {
    const id = ++tileReq;
    tileWaiters.set(id, (data) => { tileCache.set(key, data); resolve(data); });
    self.postMessage({ type: 'needTile', tid: id, source, z, x, y });
  });
}

const mercX = (lon) => (lon + 180) / 360;
const mercY = (lat) => (1 - Math.atanh(Math.sin(lat * DEG)) / Math.PI) / 2;

async function load(lat, lon, onProgress) {
  const jobs = [];
  const newLevels = [];
  for (const L of LEVELS) {
    const n = 2 ** L.z;
    const dLat = (L.radius / R) / DEG;
    const dLon = dLat / Math.cos(lat * DEG);
    const tx0 = Math.floor(mercX(lon - dLon) * n), tx1 = Math.floor(mercX(lon + dLon) * n);
    const ty0 = Math.floor(mercY(lat + dLat) * n), ty1 = Math.floor(mercY(lat - dLat) * n);
    const w = (tx1 - tx0 + 1) * 256, h = (ty1 - ty0 + 1) * 256;
    const lv = { z: L.z, n: n * 256, x0: tx0 * 256, y0: ty0 * 256, w, h, data: new Float32Array(w * h), radius: L.radius };
    newLevels.push(lv);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push({ lv, tx, ty });
  }
  let done = 0;
  const queue = jobs.slice();
  const workerFn = async () => {
    while (queue.length) {
      const { lv, tx, ty } = queue.shift();
      const t = await getTile(lv.z, tx, ty);
      if (t) {
        const ox = tx * 256 - lv.x0, oy = ty * 256 - lv.y0;
        for (let r = 0; r < 256; r++) lv.data.set(t.subarray(r * 256, r * 256 + 256), (oy + r) * lv.w + ox);
      }
      done++;
      onProgress(done / jobs.length);
    }
  };
  await Promise.all(Array.from({ length: 8 }, workerFn));
  levels = newLevels;
  const ground = sampleAt(lat, lon, 0);
  observer = { lat, lon, ground };
  return ground;
}

// 指定レイヤーでの双線形補間
function sampleLevel(lv, mx, my) {
  const gx = mx * lv.n - lv.x0 - 0.5, gy = my * lv.n - lv.y0 - 0.5;
  const ix = Math.floor(gx), iy = Math.floor(gy);
  if (ix < 0 || iy < 0 || ix >= lv.w - 1 || iy >= lv.h - 1) return NaN;
  const fx = gx - ix, fy = gy - iy;
  const i = iy * lv.w + ix, d = lv.data;
  return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + lv.w] * (1 - fx) + d[i + lv.w + 1] * fx) * fy;
}

function pickLevel(dist) {
  for (let i = 0; i < levels.length; i++) if (dist <= levels[i].radius) return i;
  return levels.length - 1;
}

function sampleAt(lat, lon, dist) {
  const mx = mercX(lon), my = mercY(lat);
  for (let i = pickLevel(dist); i < levels.length; i++) {
    const h = sampleLevel(levels[i], mx, my);
    if (!Number.isNaN(h)) return h;
  }
  return 0;
}

// 観測点 A から方位 az の大円上の点を求めるための基底ベクトル
function basis(lat, lon) {
  const cl = Math.cos(lat * DEG), sl = Math.sin(lat * DEG);
  const co = Math.cos(lon * DEG), so = Math.sin(lon * DEG);
  return {
    A: [cl * co, cl * so, sl],
    E: [-so, co, 0],                  // 東向き単位ベクトル
    N: [-sl * co, -sl * so, cl],      // 北向き単位ベクトル
  };
}

// 光源（太陽）の方向: 東, 北, 上
const SUN_AZ = 210 * DEG, SUN_EL = 35 * DEG;
const SUN = [Math.sin(SUN_AZ) * Math.cos(SUN_EL), Math.cos(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL)];

function terrainColor(h, slopeLight, dist, snowline, out) {
  let r, g, b;
  if (h <= 0.5) { r = 70; g = 105; b = 140; slopeLight = 0.9; }
  else if (h < 150) { r = 104; g = 120; b = 80; }
  else if (h < 1600) { const t = h / 1600; r = 62 + 10 * t; g = 92 - 8 * t; b = 54 + 4 * t; }
  else if (h < 2500) { const t = (h - 1600) / 900; r = 72 + 50 * t; g = 84 + 26 * t; b = 58 + 34 * t; }
  else { r = 128; g = 118; b = 104; }
  if (snowline && h > snowline) {
    const t = Math.min(1, (h - snowline) / 250);
    r += (238 - r) * t; g += (242 - g) * t; b += (250 - b) * t;
  }
  const l = slopeLight;
  r *= l; g *= l; b *= l;
  // 空気遠近法（遠いほど青白く霞む）
  const f = 1 - Math.exp(-dist / 55000);
  out[0] = r + (178 - r) * f;
  out[1] = g + (196 - g) * f;
  out[2] = b + (222 - b) * f;
}

function skyColor(tanAlt, out) {
  const t = Math.max(0, Math.min(1, tanAlt / 0.6));
  out[0] = 200 - 120 * t; out[1] = 218 - 90 * t; out[2] = 238 - 30 * t;
}

function render({ heading, pitch, fov, width, height, h0, snowline }) {
  const img = new ImageData(width, height);
  const px = img.data;
  const f = width / (fov * DEG);
  const cx = width / 2, cy = height / 2;
  const tp = Math.tan(pitch * DEG);
  const { A, E, N } = basis(observer.lat, observer.lon);
  const col = [0, 0, 0];
  const Reff = R / (1 - K_REFR);

  for (let x = 0; x < width; x++) {
    const az = heading * DEG + (x + 0.5 - cx) / f;
    const sa = Math.sin(az), ca = Math.cos(az);
    const B0 = E[0] * sa + N[0] * ca, B1 = E[1] * sa + N[1] * ca, B2 = E[2] * sa + N[2] * ca;
    let ymax = height;      // これより下は描画済み
    let lastVisibleD = 0;
    let d = 15;
    while (d < MAX_DIST) {
      const drop = d * d / (2 * Reff);
      // 早期打ち切り: 最高峰でもこれ以上見えない
      const yLimit = cy - f * ((H_MAX - drop - h0) / d - tp);
      if (yLimit >= ymax) break;
      const del = d / R, cd = Math.cos(del), sd = Math.sin(del);
      const px3 = A[0] * cd + B0 * sd, py3 = A[1] * cd + B1 * sd, pz3 = A[2] * cd + B2 * sd;
      const mx = (Math.atan2(py3, px3) / Math.PI + 1) / 2;
      const my = (1 - Math.atanh(Math.max(-0.9999999, Math.min(0.9999999, pz3))) / Math.PI) / 2;
      let li = pickLevel(d), lv = levels[li], h = sampleLevel(lv, mx, my);
      while (Number.isNaN(h) && li < levels.length - 1) { lv = levels[++li]; h = sampleLevel(lv, mx, my); }
      if (Number.isNaN(h)) h = 0;
      const y = cy - f * ((h - drop - h0) / d - tp);
      if (y < ymax) {
        // 法線から陰影を計算
        // 法線（双線形補間した標高の差分）から陰影を計算
        let light = 1;
        const e = 1 / lv.n;
        const hx1 = sampleLevel(lv, mx + e, my), hx0 = sampleLevel(lv, mx - e, my);
        const hy1 = sampleLevel(lv, mx, my + e), hy0 = sampleLevel(lv, mx, my - e);
        if (!Number.isNaN(hx1 + hx0 + hy1 + hy0)) {
          const mpp = 40075016 * Math.sqrt(1 - pz3 * pz3) / lv.n;
          const dhdx = (hx1 - hx0) / (2 * mpp);
          const dhdy = -(hy1 - hy0) / (2 * mpp);
          const nl = 1 / Math.sqrt(dhdx * dhdx + dhdy * dhdy + 1);
          const dot = (-dhdx * SUN[0] - dhdy * SUN[1] + SUN[2]) * nl;
          light = 0.45 + 0.75 * Math.max(0, dot);
        }
        terrainColor(h, light, d, snowline, col);
        const yTop = Math.max(0, Math.ceil(y));
        const newRidge = lastVisibleD > 0 && d > lastVisibleD * 1.08 + 150;
        for (let yy = yTop; yy < ymax; yy++) {
          const o = (yy * width + x) * 4;
          px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 255;
        }
        if (newRidge && ymax < height) {
          // 手前の稜線の輪郭線
          const o = (Math.min(height - 1, Math.floor(ymax)) * width + x) * 4;
          const fade = Math.exp(-lastVisibleD / 60000);
          px[o] *= 1 - 0.35 * fade; px[o + 1] *= 1 - 0.35 * fade; px[o + 2] *= 1 - 0.3 * fade;
        }
        ymax = yTop;
        lastVisibleD = d;
        if (ymax <= 0) break;
      }
      d += Math.max(6, d * 0.0035);
    }
    for (let yy = 0; yy < ymax; yy++) {
      skyColor((cy - yy) / f + tp, col);
      const o = (yy * width + x) * 4;
      px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 255;
    }
  }
  return img;
}

// 各山が観測点から見えるかどうか
function computePeaks(h0) {
  const { A, E, N } = basis(observer.lat, observer.lon);
  const Reff = R / (1 - K_REFR);
  const res = [];
  for (const p of peaks) {
    // 大円距離と方位
    const lat1 = observer.lat * DEG, lat2 = p.lat * DEG, dl = (p.lon - observer.lon) * DEG;
    const c = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dl);
    const dist = R * Math.acos(Math.min(1, c));
    if (dist > MAX_DIST) continue;
    const az = Math.atan2(Math.sin(dl) * Math.cos(lat2),
      Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dl));
    if (dist < 300) { res.push({ ...p, dist, az: az / DEG, tanAlt: -1, visible: false, here: true }); continue; }
    const top = Math.max(p.elev, sampleAt(p.lat, p.lon, dist));
    const tanAlt = (top - dist * dist / (2 * Reff) - h0) / dist;
    // 山頂までの視線上の地形の最大仰角
    const sa = Math.sin(az), ca = Math.cos(az);
    const B = [E[0] * sa + N[0] * ca, E[1] * sa + N[1] * ca, E[2] * sa + N[2] * ca];
    let maxT = -Infinity;
    for (let d = 15; d < dist * 0.97; d += Math.max(6, d * 0.004)) {
      const del = d / R, cd = Math.cos(del), sd = Math.sin(del);
      const x = A[0] * cd + B[0] * sd, y = A[1] * cd + B[1] * sd, z = A[2] * cd + B[2] * sd;
      const lat = Math.asin(z) / DEG, lon = Math.atan2(y, x) / DEG;
      const t = (sampleAt(lat, lon, d) - d * d / (2 * Reff) - h0) / d;
      if (t > maxT) maxT = t;
    }
    res.push({ ...p, dist, az: (az / DEG + 360) % 360, tanAlt, visible: tanAlt >= maxT - 0.0004, here: false });
  }
  return res;
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'tile') {
      const f = tileWaiters.get(m.tid);
      tileWaiters.delete(m.tid);
      if (f) f(m.data);
      return;
    }
    if (m.type === 'init') { peaks = m.peaks; source = m.source || 'gsi'; }
    else if (m.type === 'load') {
      const ground = await load(m.lat, m.lon, (p) => self.postMessage({ type: 'progress', p }));
      self.postMessage({ type: 'loaded', id: m.id, ground });
    } else if (m.type === 'render') {
      if (!observer) return;
      const t0 = performance.now();
      const img = render(m);
      self.postMessage({ type: 'rendered', id: m.id, img, params: m, ms: performance.now() - t0 });
    } else if (m.type === 'peaks') {
      self.postMessage({ type: 'peaks', id: m.id, peaks: computePeaks(m.h0) });
    } else if (m.type === 'elev') {
      self.postMessage({ type: 'elev', id: m.id, elev: sampleAt(m.lat, m.lon, 0) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) });
  }
};
