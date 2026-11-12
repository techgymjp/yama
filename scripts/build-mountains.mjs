// 国土地理院「日本の主な山岳標高」(data/gsi-1003zan-*.csv) を基本データとし、
// 手入力リスト（data/manual-snapped.json: 百名山・二百名山・三百名山の区分つき）を突き合わせて
// src/data/mountains.json を生成する。
// usage: node scripts/build-mountains.mjs
import fs from 'node:fs';

const CSV = 'data/gsi-1003zan-20260331.csv';
const manual = JSON.parse(fs.readFileSync('data/manual-snapped.json', 'utf8'));

// 元データで Shift_JIS に無い文字が "?" になっているものを補正
const FIX = { '薬?山': '薬萊山', '?風岳': '屛風岳', '?差岳': '杁差岳', '?風山': '屛風山' };
const stripAlt = (s) => s.replace(/（[^）]*）/g, '').trim();
const fixName = (s) => { for (const [k, v] of Object.entries(FIX)) s = s.split(k).join(v); return s; };

const rows = fs.readFileSync(CSV, 'utf8').trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
const groupSize = {};
for (const r of rows) { const g = r[1].split('-')[0]; groupSize[g] = (groupSize[g] || 0) + 1; }

const gsi = rows.map((r) => {
  const [, idx, nameRaw, yomiRaw, elev, kind, pref, lat, lon] = r;
  const m = fixName(nameRaw).match(/^(.*?)(?:＜(.*)＞)?$/);
  const y = yomiRaw.match(/^(.*?)(?:＜(.*)＞)?$/);
  const base = stripAlt(m[1]), peak = m[2] ? stripAlt(m[2]) : '';
  const yBase = stripAlt(y[1]), yPeak = y[2] ? stripAlt(y[2]) : '';
  const multi = groupSize[idx.split('-')[0]] > 1;
  // 複数ピークがある山は山頂名で、単独の山は山名で呼ぶ（例: 富士山＜剣ヶ峯＞ → 富士山）
  const usePeak = peak && multi;
  return {
    name: usePeak ? peak : base,
    yomi: usePeak ? yPeak : yBase,
    group: usePeak ? base : '',
    elev: Math.round(+elev),
    lat: +(+lat).toFixed(5),
    lon: +(+lon).toFixed(5),
    pref: pref.replace(/ /g, '・'),
    alias: '',
    cls: 0,
    _names: [base, peak].filter(Boolean),
  };
});

const distM = (a, b) => Math.hypot((a.lat - b.lat) * 111000, (a.lon - b.lon) * 111000 * Math.cos(a.lat * Math.PI / 180));
const nameMatch = (n, g) => g._names.some((x) => x === n || x.includes(n) || n.includes(x)) || g.name === n;

let matched = 0;
const unclassified = [];
const extra = [];
for (const m of manual) {
  let best = null, bestScore = Infinity;
  for (const g of gsi) {
    const d = distM(m, g);
    // 名前と標高が完全に一致すれば、手入力の座標が大きくずれていても採用する
    const exact = g._names.includes(m.name) && Math.abs(g.elev - m.elev) <= 20 && d < 60000;
    if (d > 8000 && !exact) continue;
    const byName = nameMatch(m.name, g);
    const byElev = Math.abs(g.elev - m.elev) <= 15 && d < 2500;
    if (!byName && !byElev) continue;
    const score = (exact ? 0 : d) + (byName ? 0 : 3000) + Math.abs(g.elev - m.elev) * 20;
    if (score < bestScore) { bestScore = score; best = g; }
  }
  if (best) {
    matched++;
    if (m.cls && (!best.cls || m.cls < best.cls)) best.cls = m.cls;
    else if (m.cls && best.cls !== m.cls) unclassified.push(`${m.name}(${m.cls}→${best.name}は${best.cls})`);
    // 百名山などで山域名の方が通りがよい場合は手入力の名前を優先（例: 八幡平）
    // 名山の区分がある山は一般に通りのよい手入力の名前を使い、地理院の名前は別名として残す
    // （例: 駒ヶ岳 → 木曽駒ヶ岳、東岳 → 悪沢岳）
    if (m.cls && m.name !== best.name && best.cls === m.cls) {
      if (m.name !== best.group) best.alias = best.name;
      if (m.name === best.group) best.group = '';
      best.name = m.name; best.yomi = m.yomi;
    }
  } else {
    extra.push({ name: m.name, yomi: m.yomi, group: '', alias: '', elev: m.elev, lat: m.lat, lon: m.lon, pref: '', cls: m.cls || 0 });
  }
}

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => !k.startsWith('_') && v !== ''));
const out = [...gsi, ...extra].map(clean);
fs.writeFileSync('src/data/mountains.json', '[\n' + out.map((o) => JSON.stringify(o)).join(',\n') + '\n]\n');
const c = {};
for (const o of out) c[o.cls] = (c[o.cls] || 0) + 1;
console.log(`GSI ${gsi.length} + 手入力のみ ${extra.length} = ${out.length}  (手入力 ${manual.length} 件中 ${matched} 件が一致)`);
console.log('区分別:', c);
console.log('手入力のみ:', extra.map((e) => e.name).join(' '));
if (unclassified.length) console.log('区分が重なった山:', unclassified.join(' '));
