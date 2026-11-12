// 手入力の山頂座標を DEM（AWS Terrain Tiles / terrarium）で検証・補正し mountains.json を出力する
// usage: node scripts/validate-mountains.mjs
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import raw from '../src/data/mountains.raw.js';

const Z = 13, R_SEARCH = 4500; // 探索半径[m]
const cacheDir = path.resolve('.cache/terrarium');
fs.mkdirSync(cacheDir, { recursive: true });
const tiles = new Map();
async function tile(x, y) {
  const k = `${x}/${y}`;
  if (tiles.has(k)) return tiles.get(k);
  const f = path.join(cacheDir, `${Z}_${x}_${y}.png`);
  if (!fs.existsSync(f)) {
    const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`);
    if (!r.ok) throw new Error(`tile ${k} ${r.status}`);
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  const png = PNG.sync.read(fs.readFileSync(f));
  const h = new Float32Array(256 * 256);
  for (let i = 0; i < h.length; i++) h[i] = png.data[i*4]*256 + png.data[i*4+1] + png.data[i*4+2]/256 - 32768;
  tiles.set(k, h);
  return h;
}
const N = 256 * 2 ** Z;
const px = (lon) => (lon + 180) / 360 * N;
const py = (lat) => (1 - Math.log(Math.tan(Math.PI/4 + lat*Math.PI/360)) / Math.PI) / 2 * N;
const lonOf = (x) => x / N * 360 - 180;
const latOf = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2*y/N))) * 180 / Math.PI;
async function elevAt(gx, gy) {
  const t = await tile(Math.floor(gx/256), Math.floor(gy/256));
  return t[(gy % 256) * 256 + (gx % 256)];
}
const out = [];
let bad = 0;
for (const [name, yomi, elev, lat, lon, cls] of raw) {
  const cx = Math.floor(px(lon)), cy = Math.floor(py(lat));
  const mpp = 40075016 * Math.cos(lat*Math.PI/180) / N;
  // 半径内の局所最大点のうち「距離 + 標高差×30」が最小の点を山頂とみなす
  const r = Math.ceil(R_SEARCH / mpp);
  const grid = new Float32Array((2*r+1)**2);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
    grid[(dy+r)*(2*r+1) + dx+r] = await elevAt(cx+dx, cy+dy);
  const W = 2*r+1, w = 3;
  let best = 1e18, bx = cx, by = cy;
  for (let j = w; j < W-w; j++) for (let i = w; i < W-w; i++) {
    const e = grid[j*W+i];
    let isMax = true;
    for (let v = -w; v <= w && isMax; v++) for (let u = -w; u <= w; u++)
      if (grid[(j+v)*W+i+u] > e) { isMax = false; break; }
    if (!isMax) continue;
    const plat = latOf(cy+j-r+0.5), plon = lonOf(cx+i-r+0.5);
    if (out.some((o) => Math.hypot((o.lat-plat)*111000, (o.lon-plon)*111000*Math.cos(plat*Math.PI/180)) < 800)) continue;
    const cost = Math.hypot(i-r, j-r) * mpp + 30 * Math.abs(e - elev);
    if (cost < best) { best = cost; bx = cx+i-r; by = cy+j-r; }
  }
  const demE = await elevAt(bx, by);
  const shift = Math.hypot(bx-cx, by-cy) * mpp;
  const diff = demE - elev;
  const flag = Math.abs(diff) > 80 ? ' <<<' : '';
  if (flag) bad++;
  console.log(`${name.padEnd(10,'　')} ${elev}m dem=${demE.toFixed(0)} diff=${diff.toFixed(0)} shift=${shift.toFixed(0)}m${flag}`);
  out.push({ name, yomi, elev, lat: +latOf(by+0.5).toFixed(5), lon: +lonOf(bx+0.5).toFixed(5), hyakumeizan: cls === 100 });
}
fs.writeFileSync('src/data/mountains.json', JSON.stringify(out, null, 0).replace(/\},\{/g, '},\n{') + '\n');
console.log(`total ${out.length}, flagged ${bad}`);
