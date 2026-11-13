// Web 版（GitHub Pages）とアプリ（Android）に使うファイルを www/ に作る
//   npm run build     … Web 版
//   npm run build:app … Android アプリ用。Web 版だけの部分（デバッグ用のフックなど）を取り除く
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'www');
const app = process.argv.includes('--app');

execSync('npx vite build', { cwd: root, stdio: 'inherit', env: { ...process.env, APP_BUILD: app ? '1' : '' } });

// Google Play 用のビルドでは本番の広告を使う
const mode = process.env.ADMOB_MODE === 'production' ? 'production' : 'test';
fs.writeFileSync(path.join(out, 'ads-config.js'), `// ビルド時に生成\nwindow.AD_MODE = '${mode}';\n`);
// タイトル画面に出すバージョン（CI では VERSION_NAME / VERSION_CODE を使う）
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = process.env.VERSION_CODE
  ? `v${process.env.VERSION_NAME || pkg.version} (build ${process.env.VERSION_CODE})`
  : 'dev';
fs.writeFileSync(path.join(out, 'build-info.js'), `// ビルド時に生成\nwindow.APP_VERSION = '${version}';\n`);

// アプリ用に取り除き忘れがあればビルドを止める
if (app) {
  const banned = [/web-only/, /__yama/, /__compass/, /__lastRenderMs/, /__renderCount/];
  const problems = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const f = path.join(dir, name);
      if (fs.statSync(f).isDirectory()) { walk(f); continue; }
      if (!/\.(js|html|css)$/.test(name)) continue;
      const text = fs.readFileSync(f, 'utf8');
      for (const b of banned) if (b.test(text)) problems.push(`${path.relative(out, f)}: ${b}`);
    }
  };
  walk(out);
  if (problems.length) {
    console.error('アプリ用のビルドに Web 版だけの部分が残っています:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
}
console.log(`built web assets into www/ (${app ? 'app' : 'web'}, ads: ${mode}, version: ${version})`);
