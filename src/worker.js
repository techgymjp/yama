// 標高タイル・空中写真の読み込みと景色のレンダリングを行う Web Worker
// 投影: 横 = 方位角に比例（円筒）、縦 = f * tan(仰角)

const R = 6371000;          // 地球半径
const K_REFR = 0.13;        // 大気差（屈折）係数
const MAX_DIST = 300000;    // 描画最大距離 [m]
const H_MAX = 3800;         // 地形の最大標高（早期打ち切り用）
const DEG = Math.PI / 180;
const Reff = R / (1 - K_REFR);

// 標高: 解像度の異なる 4 レイヤー（近距離ほど高解像度）
const LEVELS = [
  { z: 14, radius: 2500 },
  { z: 12, radius: 10000 },
  { z: 10, radius: 80000 },
  { z: 8, radius: MAX_DIST },
];
// 空中写真（地表の色・市街地の判定に使う）
const PHOTO_LEVELS = [
  { z: 16, radius: 1200 },
  { z: 14, radius: 5000 },
  { z: 12, radius: 20000 }, // 展望台・山頂から見下ろしたときの遠めの街や森
];
const PHOTO_MAX = 20000;
const BUILDING_MAX_DIST = 2500; // 建物を立てる最大距離 [m]

let source = 'gsi';
let levels = [];       // 標高 { z, x0, y0, w, h, data, radius, n }
let photos = [];       // 写真 { z, x0, y0, w, h, rgb, radius, n }
let observer = null;   // { lat, lon, ground }
let peaks = [];
let structures = [];   // 100m 以上の構造物
let buildingsOn = true;

// タイルの取得・デコードはメインスレッドで行う（OffscreenCanvas 非対応のブラウザ向け）
const tileCache = new Map();
const tileWaiters = new Map();
let tileReq = 0;
function getTile(kind, z, x, y) {
  const key = `${kind === 'dem' ? source : kind}/${z}/${x}/${y}`;
  if (tileCache.has(key)) return Promise.resolve(tileCache.get(key));
  return new Promise((resolve) => {
    const id = ++tileReq;
    tileWaiters.set(id, (data) => {
      if (tileCache.size > 600) tileCache.delete(tileCache.keys().next().value);
      tileCache.set(key, data);
      resolve(data);
    });
    self.postMessage({ type: 'needTile', tid: id, kind, source, z, x, y });
  });
}

const mercX = (lon) => (lon + 180) / 360;
const mercY = (lat) => (1 - Math.atanh(Math.sin(lat * DEG)) / Math.PI) / 2;

function tileRange(lat, lon, z, radius) {
  const n = 2 ** z;
  const dLat = (radius / R) / DEG;
  const dLon = dLat / Math.cos(lat * DEG);
  return {
    n,
    tx0: Math.floor(mercX(lon - dLon) * n), tx1: Math.floor(mercX(lon + dLon) * n),
    ty0: Math.floor(mercY(lat + dLat) * n), ty1: Math.floor(mercY(lat - dLat) * n),
  };
}

async function load(lat, lon, onProgress) {
  const jobs = [];
  const newLevels = [], newPhotos = [];
  for (const L of LEVELS) {
    const { n, tx0, tx1, ty0, ty1 } = tileRange(lat, lon, L.z, L.radius);
    const w = (tx1 - tx0 + 1) * 256, h = (ty1 - ty0 + 1) * 256;
    const lv = { z: L.z, n: n * 256, x0: tx0 * 256, y0: ty0 * 256, w, h, data: new Float32Array(w * h), radius: L.radius };
    newLevels.push(lv);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push({ kind: 'dem', lv, tx, ty });
  }
  for (const L of PHOTO_LEVELS) {
    const { n, tx0, tx1, ty0, ty1 } = tileRange(lat, lon, L.z, L.radius);
    const w = (tx1 - tx0 + 1) * 256, h = (ty1 - ty0 + 1) * 256;
    // rgba: a=0 はデータなし
    const lv = { z: L.z, n: n * 256, x0: tx0 * 256, y0: ty0 * 256, w, h, rgb: new Uint8Array(w * h * 4), radius: L.radius };
    newPhotos.push(lv);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push({ kind: 'photo', lv, tx, ty });
  }
  let done = 0;
  const queue = jobs.slice();
  const workerFn = async () => {
    while (queue.length) {
      const { kind, lv, tx, ty } = queue.shift();
      const t = await getTile(kind, lv.z, tx, ty);
      if (t) {
        const ox = tx * 256 - lv.x0, oy = ty * 256 - lv.y0;
        if (kind === 'dem') {
          for (let r = 0; r < 256; r++) lv.data.set(t.subarray(r * 256, r * 256 + 256), (oy + r) * lv.w + ox);
        } else {
          for (let r = 0; r < 256; r++) lv.rgb.set(t.subarray(r * 1024, r * 1024 + 1024), ((oy + r) * lv.w + ox) * 4);
        }
      }
      done++;
      onProgress(done / jobs.length);
    }
  };
  await Promise.all(Array.from({ length: 8 }, workerFn));
  levels = newLevels;
  photos = newPhotos;
  const ground = sampleAt(lat, lon, 0);
  observer = { lat, lon, ground };
  // 構造物の位置（観測点からの距離・方位・地盤高）
  for (const s of structures) {
    const g = geo(s.lat, s.lon);
    s.dist = g.dist; s.az = g.az; s.base = sampleAt(s.lat, s.lon, 0);
  }
  // 標高の高い場所（山の岩場・雪）は写真が灰色でも市街地ではない（建物も 800m 以上には立てない）
  return { ground, urban: ground < 800 ? urbanRatioAround(lat, lon) : 0 };
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

// 空中写真の色（最近傍）。データがなければ false
function photoAt(mx, my, dist, out) {
  for (const lv of photos) {
    if (dist > lv.radius) continue;
    const ix = Math.floor(mx * lv.n - lv.x0), iy = Math.floor(my * lv.n - lv.y0);
    if (ix < 0 || iy < 0 || ix >= lv.w || iy >= lv.h) continue;
    const o = (iy * lv.w + ix) * 4;
    if (lv.rgb[o + 3] === 0) continue;
    out[0] = lv.rgb[o]; out[1] = lv.rgb[o + 1]; out[2] = lv.rgb[o + 2];
    return true;
  }
  return false;
}

// 写真の色が市街地（屋根・道路など灰色系）らしいか
function isUrbanColor(c) {
  const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
  if (mx < 60) return false;                              // 影・水面
  if (c[1] > c[0] + 6 && c[1] >= c[2]) return false;      // 植生（緑）
  if (c[2] > c[0] + 12 && c[2] > c[1]) return false;      // 水面（青）
  return (mx - mn) / mx < 0.28;
}

// 決定的な疑似乱数（セルごとに固定）
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const CELL = 2 ** 21; // 約 15m 四方（緯度 36°）のセル
const tmpC = [0, 0, 0];
// (mx,my) の建物の高さ。建物でなければ 0
function buildingAt(mx, my, dist, h) {
  if (!buildingsOn || dist > BUILDING_MAX_DIST || h > 800) return 0;
  const gx = mx * CELL, gy = my * CELL;
  const cx = Math.floor(gx), cy = Math.floor(gy);
  const fx = gx - cx, fy = gy - cy;
  if (fx < 0.18 || fy < 0.18 || fx > 0.92 || fy > 0.92) return 0; // 道路・敷地の隙間
  const r = hash2(cx, cy);
  if (r < 0.12) return 0; // 空き地
  // セル中心の写真の色で市街地か判定
  if (!photoAt((cx + 0.55) / CELL, (cy + 0.55) / CELL, dist, tmpC) || !isUrbanColor(tmpC)) return 0;
  const r2 = hash2(cy + 17, cx - 5);
  if (r > 0.996) return 20 + 25 * r2;   // 中層ビル
  if (r > 0.96) return 11 + 10 * r2;    // マンション
  return 5.5 + 5 * r2;                  // 戸建て
}

function urbanRatioAround(lat, lon) {
  let n = 0, u = 0;
  const mx0 = mercX(lon), my0 = mercY(lat);
  for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
    const mx = mx0 + i * 20 / 40075016 / Math.cos(lat * DEG), my = my0 + j * 20 / 40075016 / Math.cos(lat * DEG);
    if (photoAt(mx, my, 100, tmpC)) { n++; if (isUrbanColor(tmpC)) u++; }
  }
  return n ? u / n : 0;
}

// 観測点から見た距離と方位
function geo(lat, lon) {
  const lat1 = observer ? observer.lat * DEG : 0, lat2 = lat * DEG, dl = (lon - observer.lon) * DEG;
  const c = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dl);
  const dist = R * Math.acos(Math.min(1, c));
  const az = Math.atan2(Math.sin(dl) * Math.cos(lat2),
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dl));
  return { dist, az: (az / DEG + 360) % 360 };
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

function baseColor(h, snowline, out) {
  let r, g, b;
  if (h <= 0.5) { r = 70; g = 105; b = 140; }
  else if (h < 150) { r = 104; g = 120; b = 80; }
  else if (h < 1600) { const t = h / 1600; r = 62 + 10 * t; g = 92 - 8 * t; b = 54 + 4 * t; }
  else if (h < 2500) { const t = (h - 1600) / 900; r = 72 + 50 * t; g = 84 + 26 * t; b = 58 + 34 * t; }
  else { r = 128; g = 118; b = 104; }
  if (snowline && h > snowline) {
    const t = Math.min(1, (h - snowline) / 250);
    r += (238 - r) * t; g += (242 - g) * t; b += (250 - b) * t;
  }
  out[0] = r; out[1] = g; out[2] = b;
}

// 空気遠近法（遠いほど青白く霞む）
function haze(c, dist) {
  const f = 1 - Math.exp(-dist / 55000);
  c[0] += (178 - c[0]) * f; c[1] += (196 - c[1]) * f; c[2] += (222 - c[2]) * f;
}

function skyColor(tanAlt, out) {
  const t = Math.max(0, Math.min(1, tanAlt / 0.6));
  out[0] = 200 - 120 * t; out[1] = 218 - 90 * t; out[2] = 238 - 30 * t;
}

function structureColor(s, lateral, dist, out) {
  // 日の当たる側を明るく
  const side = lateral * Math.sin((SUN_AZ / DEG - s.az) * DEG) > 0 ? 1 : 0.78;
  if (s.name === '東京タワー') { out[0] = 220; out[1] = 80; out[2] = 50; }
  else if (s.type === 'tower') { out[0] = 225; out[1] = 228; out[2] = 232; }
  else { out[0] = 150; out[1] = 166; out[2] = 182; }
  out[0] *= side; out[1] *= side; out[2] *= side;
  haze(out, dist);
}

function render({ heading, pitch, fov, width, height, h0, snowline }) {
  const img = new ImageData(width, height);
  const px = img.data;
  const f = width / (fov * DEG);
  const cx = width / 2, cy = height / 2;
  const tp = Math.tan(pitch * DEG);
  const { A, E, N } = basis(observer.lat, observer.lon);
  const col = [0, 0, 0], pc = [0, 0, 0];
  const pxAngle = 1 / f;

  // 画面内にある構造物
  const visStructs = structures.filter((s) => s.dist > 20 && s.dist < MAX_DIST &&
    Math.abs(((s.az - heading + 540) % 360) - 180) < fov / 2 + 1);

  for (let x = 0; x < width; x++) {
    const azDeg = heading + (x + 0.5 - cx) / f / DEG;
    const az = azDeg * DEG;
    const sa = Math.sin(az), ca = Math.cos(az);
    const B0 = E[0] * sa + N[0] * ca, B1 = E[1] * sa + N[1] * ca, B2 = E[2] * sa + N[2] * ca;

    // この列にかかる構造物（距離順）
    const hits = [];
    for (const s of visStructs) {
      const off = (((s.az - azDeg + 540) % 360) - 180) * DEG;
      const lateral = off * s.dist;
      const halfPx = pxAngle * s.dist / 2;
      if (Math.abs(lateral) <= s.w / 2 + halfPx) hits.push({ s, lateral: Math.max(0, Math.abs(lateral) - halfPx), sign: Math.sign(lateral) });
    }
    hits.sort((a, b) => a.s.dist - b.s.dist);
    let hi = 0;

    let ymax = height;      // これより下は描画済み
    let lastVisibleD = 0;
    let prevBuilding = 0;
    let d = 15;
    while (d < MAX_DIST) {
      // 構造物を手前から描く
      while (hi < hits.length && hits[hi].s.dist <= d) {
        const { s, lateral, sign } = hits[hi++];
        let top = s.height;
        if (s.type === 'tower' && lateral > s.wTop / 2) top = s.height * Math.max(0, (s.w / 2 - lateral) / ((s.w - s.wTop) / 2));
        if (top <= 0) continue;
        const ds = s.dist, dropS = ds * ds / (2 * Reff);
        const yS = cy - f * ((s.base + top - dropS - h0) / ds - tp);
        if (yS < ymax) {
          structureColor(s, sign, ds, col);
          const yTop = Math.max(0, Math.ceil(yS));
          for (let yy = yTop; yy < ymax; yy++) {
            const o = (yy * width + x) * 4;
            px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 255;
          }
          ymax = yTop;
          lastVisibleD = ds;
        }
      }
      if (ymax <= 0) break;

      const drop = d * d / (2 * Reff);
      // 早期打ち切り: 最高峰でもこれ以上見えない
      const yLimit = cy - f * ((H_MAX - drop - h0) / d - tp);
      if (yLimit >= ymax && hi >= hits.length) break;
      const del = d / R, cd = Math.cos(del), sd = Math.sin(del);
      const px3 = A[0] * cd + B0 * sd, py3 = A[1] * cd + B1 * sd, pz3 = A[2] * cd + B2 * sd;
      const mx = (Math.atan2(py3, px3) / Math.PI + 1) / 2;
      const my = (1 - Math.atanh(Math.max(-0.9999999, Math.min(0.9999999, pz3))) / Math.PI) / 2;
      let li = pickLevel(d), lv = levels[li], h = sampleLevel(lv, mx, my);
      while (Number.isNaN(h) && li < levels.length - 1) { lv = levels[++li]; h = sampleLevel(lv, mx, my); }
      if (Number.isNaN(h)) h = 0;
      // 海抜ゼロメートル地帯でも建物を立てる（海・川は写真の色で除外される）
      const hb = buildingAt(mx, my, d, h);
      const y = cy - f * ((h + hb - drop - h0) / d - tp);
      if (y < ymax) {
        let light = 1;
        if (hb > 0) {
          // 建物: 壁面は写真の色を明るめに、屋根は写真の色
          const hasPhoto = photoAt(mx, my, d, pc);
          const v = 0.85 + 0.3 * hash2(Math.floor(mx * CELL) + 3, Math.floor(my * CELL));
          if (prevBuilding !== hb) { col[0] = 205 * v; col[1] = 198 * v; col[2] = 186 * v; }   // 壁
          else if (hasPhoto) { col[0] = pc[0] * v; col[1] = pc[1] * v; col[2] = pc[2] * v; } // 屋根
          else { col[0] = 150 * v; col[1] = 140 * v; col[2] = 130 * v; }
          // 建物の陰（太陽と反対側の面を暗く）
          light = Math.sin((SUN_AZ / DEG - azDeg) * DEG) > 0 ? 0.8 : 1.0;
          col[0] *= light; col[1] *= light; col[2] *= light;
          haze(col, d);
        } else {
          // 法線（双線形補間した標高の差分）から陰影を計算
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
          baseColor(h, snowline, col);
          // 近くは空中写真の色を使う（遠くへ行くほど通常の配色へ）
          const hasPhoto = d < PHOTO_MAX && photoAt(mx, my, d, pc);
          if (hasPhoto) {
            const t = d < PHOTO_MAX * 0.7 ? 1 : (PHOTO_MAX - d) / (PHOTO_MAX * 0.3);
            const sl = snowline && h > snowline ? 0.3 : 1;
            for (let k = 0; k < 3; k++) col[k] += (pc[k] * 0.95 - col[k]) * t * sl;
            light = 0.75 + 0.35 * (light - 0.45) / 0.75;
          }
          if (h <= 0.5 && !hasPhoto) light = 0.9;
          col[0] *= light; col[1] *= light; col[2] *= light;
          haze(col, d);
        }
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
      prevBuilding = hb;
      // 建物のある近距離は細かく進む
      d += d < BUILDING_MAX_DIST && buildingsOn ? Math.max(4, d * 0.004) : Math.max(6, d * 0.0035);
    }
    for (let yy = 0; yy < ymax; yy++) {
      skyColor((cy - yy) / f + tp, col);
      const o = (yy * width + x) * 4;
      px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 255;
    }
  }
  return img;
}

// 視線上の地形（＋建物）の最大仰角
function maxTanAlong(az, dist, h0) {
  const { A, E, N } = basis(observer.lat, observer.lon);
  const sa = Math.sin(az * DEG), ca = Math.cos(az * DEG);
  const B = [E[0] * sa + N[0] * ca, E[1] * sa + N[1] * ca, E[2] * sa + N[2] * ca];
  let maxT = -Infinity;
  for (let d = 15; d < dist * 0.97; d += d < BUILDING_MAX_DIST && buildingsOn ? Math.max(4, d * 0.004) : Math.max(6, d * 0.004)) {
    const del = d / R, cd = Math.cos(del), sd = Math.sin(del);
    const x = A[0] * cd + B[0] * sd, y = A[1] * cd + B[1] * sd, z = A[2] * cd + B[2] * sd;
    const mx = (Math.atan2(y, x) / Math.PI + 1) / 2;
    const my = (1 - Math.atanh(Math.max(-0.9999999, Math.min(0.9999999, z))) / Math.PI) / 2;
    let h = NaN;
    for (let i = pickLevel(d); i < levels.length && Number.isNaN(h); i++) h = sampleLevel(levels[i], mx, my);
    if (Number.isNaN(h)) h = 0;
    h += buildingAt(mx, my, d, h);
    const t = (h - d * d / (2 * Reff) - h0) / d;
    if (t > maxT) maxT = t;
  }
  return maxT;
}

// 各山・構造物が観測点から見えるかどうか
function computePeaks(h0) {
  const res = [];
  for (const p of peaks) {
    const { dist, az } = geo(p.lat, p.lon);
    if (dist > MAX_DIST) continue;
    if (dist < 300) { res.push({ ...p, dist, az, tanAlt: -1, visible: false, here: true }); continue; }
    const top = Math.max(p.elev, sampleAt(p.lat, p.lon, dist));
    const tanAlt = (top - dist * dist / (2 * Reff) - h0) / dist;
    res.push({ ...p, dist, az, tanAlt, visible: tanAlt >= maxTanAlong(az, dist, h0) - 0.0004, here: false });
  }
  for (const s of structures) {
    if (s.dist > 120000) continue;
    const { lat, lon, name, yomi, height } = s;
    const base = { name, yomi, lat, lon, elev: Math.round(s.base + height), height, structure: true, cls: 0, dist: s.dist, az: s.az };
    if (s.dist < 150) { res.push({ ...base, tanAlt: -1, visible: false, here: true }); continue; }
    const tanAlt = (s.base + height - s.dist * s.dist / (2 * Reff) - h0) / s.dist;
    res.push({ ...base, tanAlt, visible: tanAlt >= maxTanAlong(s.az, s.dist, h0) - 0.0002, here: false });
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
    if (m.type === 'init') {
      peaks = m.peaks; source = m.source || 'gsi';
      structures = (m.structures || []).map((s) => ({ ...s, wTop: s.wTop || s.w }));
    } else if (m.type === 'options') {
      buildingsOn = m.buildings;
    } else if (m.type === 'load') {
      const r = await load(m.lat, m.lon, (p) => self.postMessage({ type: 'progress', p }));
      self.postMessage({ type: 'loaded', id: m.id, ground: r.ground, urban: r.urban });
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
