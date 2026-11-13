import { defineConfig } from 'vite';

// アプリ（Android）用のビルドでは、Web 版だけの部分（デバッグ用のフックなど）を取り除く。
// 目印: JS は // web-only:start … // web-only:end、HTML は <!-- web-only --> … <!-- /web-only -->
// （アプリに「画面に出ない機能」を残すと、ストアの審査で問題になることがあるため）
const APP = process.env.APP_BUILD === '1';
const stripWebOnly = {
  name: 'strip-web-only',
  transform(code, id) {
    if (!APP || !/\.(js|css)$/.test(id)) return null;
    return code
      .replace(/[ \t]*\/\/ web-only:start[\s\S]*?\/\/ web-only:end[ \t]*\n?/g, '')
      .replace(/[ \t]*\/\* web-only:start \*\/[\s\S]*?\/\* web-only:end \*\/[ \t]*\n?/g, '');
  },
  transformIndexHtml(html) {
    return APP ? html.replace(/[ \t]*<!-- web-only -->[\s\S]*?<!-- \/web-only -->[ \t]*\n?/g, '') : html;
  },
};

export default defineConfig({
  base: './',
  plugins: [stripWebOnly],
  build: { outDir: 'www', emptyOutDir: true, target: ['es2019', 'safari13'] },
  worker: { format: 'iife' },
});
