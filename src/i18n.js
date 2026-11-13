// 日本語 / 英語の切り替え
// - 言語は端末（ブラウザ）の言語から決め、トップ画面で切り替えられる（保存する）
// - HTML は data-i18n（文字）/ data-i18n-html（HTML）/ data-i18n-placeholder / data-i18n-aria / data-i18n-title で指定する
// - 山の名前は英語ではよみがなをローマ字にして「Mt. Fuji」「Yarigatake」のように表す

const DICT = {
  ja: {
    'app.title': '山探し',
    'start.tagline': '景色の中から<br class="br-land">お題の山を探してタップ！',
    'start.current': '現在地でスタート',
    'start.place': '地点を選ぶ',
    'start.deck': '展望台から',
    'start.howto': 'あそびかた',
    'start.privacy': 'プライバシーポリシー',
    'start.adPrivacy': '広告の設定',
    'start.data': '地図・標高データ：国土地理院',
    'start.lang': 'English',
    'level.easy': 'かんたん', 'level.normal': 'ふつう', 'level.hard': 'むずかしい',
    'level.aria': '難易度',
    'howto.title': 'あそびかた',
    'howto.1': '「現在地でスタート」で、いまいる場所から見える景色が表示されます。押した時にスマホが向いている方角から始まります。「地点を選ぶ」「展望台から」で好きな場所からも遊べます。',
    'howto.2': '「<b>富士山</b>を探して！」のようにお題が出ます。景色の中からその山を探してタップ。1問100点、全10問です。',
    'howto.3': 'はずすと減点。違う山をタップすると「そこは〇〇です」と教えてくれます。ヒントで方角と距離、パスで答えがわかります。',
    'howto.controls': '操作',
    'howto.c1': '左右・上下にドラッグ：見る方角・角度を変える',
    'howto.c2': '2本指で広げる・つまむ：拡大・縮小',
    'howto.c3': '右下の ▲▼：その場で視点の高さを上下',
    'howto.c4': '🧭 コンパス：スマホを向けた方角の景色になる（左右にドラッグするとオフ）',
    'howto.c5': '⏸：一時停止',
    'howto.levels': '難易度',
    'howto.l1': '<b>かんたん</b>：有名な山だけ。向きの案内つき',
    'howto.l2': '<b>ふつう</b>：百名山を中心にいろいろな山',
    'howto.l3': '<b>むずかしい</b>：無名の山や遠い山。当たりの範囲がせまい',
    'howto.settings': '設定',
    'set.source': '標高データ', 'set.source.gsi': '国土地理院 標高タイル',
    'set.sfx': '効果音', 'set.buildings': '街並み（建物）',
    'set.snow': '積雪', 'set.snow.auto': '季節に合わせる', 'set.snow.none': 'なし', 'set.snow.top': '山頂付近', 'set.snow.winter': '冬山',
    'howto.credits': 'データの出典',
    'howto.creditsText': '標高・地図・空中写真：国土地理院（地理院タイル）／山の一覧：国土地理院「日本の主な山岳標高」を加工して作成。景色はこれらのデータから計算して描いたもので、建物は空中写真から推定した架空のものです。',
    'common.backTop': 'トップに戻る',
    'pause.title': '一時停止', 'pause.resume': '再開', 'pause.aria': '一時停止',
    'retry.text': '広告を見て、この問題に<b>もう一度挑戦</b>しますか？',
    'retry.left': '（このゲームであと {n} 回）',
    'retry.watch': '広告を見て挑戦', 'retry.skip': '次へ',
    'retry.toast': 'もう一度挑戦！（やり直し {n}回目）',
    'tb.hint': 'ヒント', 'tb.skip': 'パス', 'tb.labels': '山名', 'tb.follow': '🧭 コンパス', 'tb.bgmOn': '♪ BGM', 'tb.bgmOff': '♪ オフ',
    'tb.up': '上へ', 'tb.down': '下へ', 'compass.title': '方角',
    'score': '{q}/{total}問・{pts}点・⏱{sec}秒',
    'quest.prefix': '', 'quest.suffix': 'を探して！（第{n}問）',
    'quest.none': '見える山がありません', 'quest.noneSub': '▲で視点を高くするか、場所を変えてみてください',
    'quest.result': '結果発表',
    'hint': 'ヒント: {dir}の方角（{deg}°）・{dist}先',
    'answer': '正解は {name}（{dir}・{dist}先）',
    'correct': '正解！ {name}（{dist}先）\n+{pts}点・{time}',
    'wrongAt': 'そこは {name}（{yomi}）です', 'wrong': 'ちがいます…',
    'badge': '{side}へ {deg}°', 'badge.right': '右', 'badge.left': '左',
    'height.ground': '地上{h}m', 'height.total': '標高{h}m',
    'desc.elev': '標高{h}m', 'desc.structure': '{yomi}・高さ{h}m の構造物', 'desc.structureDeck': '{yomi}・高さ{h}m・展望台：{decks}',
    'class.100': '日本百名山', 'class.200': '日本二百名山', 'class.300': '日本三百名山',
    'result.label': '結果', 'result.pts': '{pts}点',
    'result.detail': '難易度「{level}」・{total}問中 {correct}問正解（{max}点満点）',
    'result.time': 'タイム {time}', 'result.retries': '・やり直し {n}回',
    'result.newBest': 'ベスト更新！（{level}）', 'best': 'ベスト（{level}）：{pts}点・{time}',
    'result.q': '第{n}問 {name}', 'result.ok': '○ {pts}点', 'result.pass': '× パス',
    'title.0': '山の達人', 'title.1': '山の上級者', 'title.2': '山好き', 'title.3': 'ハイカー', 'title.4': '山歩きビギナー',
    'result.share': '結果をシェア', 'result.shareX': 'Xでシェア', 'result.shareLine': 'LINEで送る', 'result.copy': 'コピー',
    'result.again': 'もう一度（同じ場所）', 'result.place': '場所を変える', 'result.view': '景色を見る', 'result.top': 'トップへ',
    'share.text': '山探し【{level}】で{pts}点（{title}）！{place}{total}問中{correct}問正解・タイム{time}{retries} #山探し',
    'share.place': '{name}から', 'share.retries': '・やり直し{n}回', 'share.dialog': '結果をシェア', 'share.copied': '結果をコピーしました',
    'time.s': '{s}秒', 'time.ms': '{m}分{s}秒',
    'follow.on': 'コンパス追従オン：スマホを向けた方角の景色になります', 'follow.off': 'コンパス追従をオフにしました',
    'follow.none': 'この端末ではコンパスが使えません',
    'load.terrain': '地形データを読み込み中…', 'load.terrainAt': '{name} の地形データを読み込み中…', 'load.peaks': '見える山を計算中…',
    'load.failed': '読み込みに失敗しました: {msg}',
    'note.summit': '{name} 山頂（標高{h}m）から見ています', 'note.deck': '{name}（地上{h}m）から見ています',
    'note.urban': '市街地のため、ビルの屋上（地上30m）から見ています。▼で地上に降りられます',
    'note.noCompass': 'コンパスが使えないため北向きで表示しています',
    'geo.outside': '現在地が日本国外のため、地点を選んでください',
    'geo.failed': '現在地を取得できませんでした。地点を選んでください', 'geo.failedShort': '現在地を取得できませんでした',
    'geo.nearSummit': '{name} 山頂の近くにいます', 'geo.unavailable': '位置情報が使えません',
    'place.current': '現在地', 'place.selected': '選択地点', 'place.summit': '山頂',
    'picker.deckSelect': '展望台から見る…', 'picker.deckAria': '展望台から見る',
    'picker.search': '山の名前で山頂へ（例: 富士山）', 'picker.here': '現在地', 'picker.info': '地図をタップして地点を選択',
    'picker.cancel': '戻る', 'picker.ok': 'この地点で見る', 'picker.deckInfo': '{name}（地上{h}m）',
    'map.deckTitle': '展望台から見る', 'map.deckHeight': '地上{h}m',
    'map.legend': '<span><i style="background:#c1121f"></i>百名山</span><span><i style="background:#2a6f97"></i>二百名山</span><span><i style="background:#52796f"></i>三百名山</span><span><i style="background:#6c757d"></i>その他</span><span><i class="lg-deck"></i>展望台</span>',
    'error': 'エラー: {msg}',
    'dirs': '北,北北東,北東,東北東,東,東南東,南東,南南東,南,南南西,南西,西南西,西,西北西,北西,北北西',
  },
  en: {
    'app.title': 'Yama Sagashi',
    'start.tagline': 'Find the mountain<br class="br-land"> in the view and tap it!',
    'start.current': 'Start here',
    'start.place': 'Pick a place',
    'start.deck': 'Observation deck',
    'start.howto': 'How to play',
    'start.privacy': 'Privacy policy',
    'start.adPrivacy': 'Ad settings',
    'start.data': 'Map & elevation data: GSI Japan',
    'start.lang': '日本語',
    'level.easy': 'Easy', 'level.normal': 'Normal', 'level.hard': 'Hard',
    'level.aria': 'Difficulty',
    'howto.title': 'How to play',
    'howto.1': '"Start here" shows the view from where you are now, facing the direction your phone points when you press it. "Pick a place" and "Observation deck" let you play from anywhere in Japan.',
    'howto.2': 'You get a quest like "Find <b>Mt. Fuji</b>!". Find that mountain in the view and tap it. 100 points per question, 10 questions per game.',
    'howto.3': 'A wrong tap costs points, and tells you which mountain you tapped. "Hint" shows the direction and distance; "Pass" shows the answer.',
    'howto.controls': 'Controls',
    'howto.c1': 'Drag left/right or up/down: change the direction or angle of view',
    'howto.c2': 'Pinch with two fingers: zoom in and out',
    'howto.c3': '▲▼ at the bottom right: raise or lower your viewpoint',
    'howto.c4': '🧭 Compass: the view follows the direction your phone points (drag left/right to turn it off)',
    'howto.c5': '⏸: pause',
    'howto.levels': 'Difficulty',
    'howto.l1': '<b>Easy</b>: famous mountains only, with a direction guide',
    'howto.l2': '<b>Normal</b>: all kinds of mountains, mostly well-known ones',
    'howto.l3': '<b>Hard</b>: lesser-known and far-away mountains, with a smaller tap area',
    'howto.settings': 'Settings',
    'set.source': 'Elevation data', 'set.source.gsi': 'GSI Japan elevation tiles',
    'set.sfx': 'Sound effects', 'set.buildings': 'Buildings',
    'set.snow': 'Snow', 'set.snow.auto': 'Match the season', 'set.snow.none': 'None', 'set.snow.top': 'Near summits', 'set.snow.winter': 'Winter',
    'howto.credits': 'Data sources',
    'howto.creditsText': 'Elevation, maps and aerial photos: Geospatial Information Authority of Japan (GSI Tiles). Mountain list: processed from GSI "Major mountain elevations of Japan". The view is computed from this data; buildings are imaginary, estimated from aerial photos.',
    'common.backTop': 'Back to top',
    'pause.title': 'Paused', 'pause.resume': 'Resume', 'pause.aria': 'Pause',
    'retry.text': 'Watch an ad to <b>try this question again</b>?',
    'retry.left': '({n} left in this game)',
    'retry.watch': 'Watch ad & retry', 'retry.skip': 'Next',
    'retry.toast': 'Try again! (retry #{n})',
    'tb.hint': 'Hint', 'tb.skip': 'Pass', 'tb.labels': 'Names', 'tb.follow': '🧭 Compass', 'tb.bgmOn': '♪ Music', 'tb.bgmOff': '♪ Off',
    'tb.up': 'Up', 'tb.down': 'Down', 'compass.title': 'Direction',
    'score': 'Q{q}/{total} · {pts} pts · ⏱{sec}s',
    'quest.prefix': 'Find ', 'quest.suffix': '! (Q{n})',
    'quest.none': 'No mountains in view', 'quest.noneSub': 'Raise your viewpoint with ▲, or try another place',
    'quest.result': 'Results',
    'hint': 'Hint: to the {dir} ({deg}°), {dist} away',
    'answer': 'The answer is {name} ({dir}, {dist} away)',
    'correct': 'Correct! {name} ({dist} away)\n+{pts} pts · {time}',
    'wrongAt': 'That is {name}', 'wrong': 'Not quite…',
    'badge': 'Turn {side} {deg}°', 'badge.right': 'right', 'badge.left': 'left',
    'height.ground': 'Height {h} m', 'height.total': 'Elev. {h} m',
    'desc.elev': '{h} m', 'desc.structure': '{h} m tall structure', 'desc.structureDeck': '{h} m tall · Observation deck: {decks}',
    'class.100': '100 Famous Mountains', 'class.200': '200 Famous Mountains', 'class.300': '300 Famous Mountains',
    'result.label': 'RESULTS', 'result.pts': '{pts} pts',
    'result.detail': '{level} · {correct} of {total} correct (max {max} pts)',
    'result.time': 'Time {time}', 'result.retries': ' · {n} retries',
    'result.newBest': 'New best! ({level})', 'best': 'Best ({level}): {pts} pts · {time}',
    'result.q': 'Q{n} {name}', 'result.ok': '○ {pts} pts', 'result.pass': '× Pass',
    'title.0': 'Mountain Master', 'title.1': 'Mountain Expert', 'title.2': 'Mountain Lover', 'title.3': 'Hiker', 'title.4': 'Beginner Hiker',
    'result.share': 'Share result', 'result.shareX': 'Share on X', 'result.shareLine': 'Send with LINE', 'result.copy': 'Copy',
    'result.again': 'Play again (same place)', 'result.place': 'New place', 'result.view': 'See the view', 'result.top': 'Top',
    'share.text': 'I scored {pts} pts ({title}) on Yama Sagashi [{level}]! {correct}/{total} correct{place}, time {time}{retries} #YamaSagashi',
    'share.place': ' from {name}', 'share.retries': ', {n} retries', 'share.dialog': 'Share result', 'share.copied': 'Result copied',
    'time.s': '{s}s', 'time.ms': '{m}m {s}s',
    'follow.on': 'Compass on: the view follows the direction your phone points', 'follow.off': 'Compass off',
    'follow.none': 'No compass on this device',
    'load.terrain': 'Loading terrain data…', 'load.terrainAt': 'Loading terrain data for {name}…', 'load.peaks': 'Finding visible mountains…',
    'load.failed': 'Failed to load: {msg}',
    'note.summit': 'Viewing from the summit of {name} ({h} m)', 'note.deck': 'Viewing from {name} ({h} m above ground)',
    'note.urban': 'In a city, so you are on a rooftop (30 m). Press ▼ to go down to the street',
    'note.noCompass': 'No compass, so the view starts facing north',
    'geo.outside': 'You are outside Japan. Please pick a place',
    'geo.failed': 'Could not get your location. Please pick a place', 'geo.failedShort': 'Could not get your location',
    'geo.nearSummit': 'You are near the summit of {name}', 'geo.unavailable': 'Location is not available',
    'place.current': 'Your location', 'place.selected': 'Selected place', 'place.summit': 'summit',
    'picker.deckSelect': 'View from an observation deck…', 'picker.deckAria': 'Observation deck',
    'picker.search': 'Go to a summit (e.g. Mt. Fuji)', 'picker.here': 'My location', 'picker.info': 'Tap the map to pick a place',
    'picker.cancel': 'Back', 'picker.ok': 'View from here', 'picker.deckInfo': '{name} ({h} m above ground)',
    'map.deckTitle': 'View from an observation deck', 'map.deckHeight': '{h} m',
    'map.legend': '<span><i style="background:#c1121f"></i>100 Famous</span><span><i style="background:#2a6f97"></i>200 Famous</span><span><i style="background:#52796f"></i>300 Famous</span><span><i style="background:#6c757d"></i>Other</span><span><i class="lg-deck"></i>Deck</span>',
    'error': 'Error: {msg}',
    'dirs': 'N,NNE,NE,ENE,E,ESE,SE,SSE,S,SSW,SW,WSW,W,WNW,NW,NNW',
  },
};

function detect() {
  try { const v = localStorage.getItem('yama.lang'); if (v === 'ja' || v === 'en') return v; } catch { /* 保存できない環境 */ }
  const l = (navigator.languages && navigator.languages[0]) || navigator.language || 'ja';
  return /^ja/i.test(l) ? 'ja' : 'en';
}
export let lang = detect();
export const isEn = () => lang === 'en';

export function t(key, vars = {}) {
  let s = DICT[lang][key] ?? DICT.ja[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function setLang(l) {
  lang = l;
  try { localStorage.setItem('yama.lang', l); } catch { /* 保存できない環境 */ }
  applyI18n();
}

export function applyI18n(root = document) {
  document.documentElement.lang = lang;
  document.title = t('app.title');
  root.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach((e) => { e.innerHTML = t(e.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((e) => { e.placeholder = t(e.dataset.i18nPlaceholder); });
  root.querySelectorAll('[data-i18n-aria]').forEach((e) => { e.setAttribute('aria-label', t(e.dataset.i18nAria)); });
  root.querySelectorAll('[data-i18n-title]').forEach((e) => { e.title = t(e.dataset.i18nTitle); });
}

// ---- 山の名前のローマ字（ヘボン式・長音は省略） ----
const KANA = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo', しゃ: 'sha', しゅ: 'shu', しょ: 'sho', ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo', ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo', みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo', ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo', じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo', ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo', ぢゃ: 'ja', ぢゅ: 'ju', ぢょ: 'jo',
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so', た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no', は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo', や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do', ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po', ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o', ゔ: 'vu',
};
const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
export function romaji(kana) {
  const s = toHira(kana);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (s[i] === 'っ') { const nx = KANA[s.slice(i + 1, i + 3)] || KANA[s[i + 1]] || ''; out += nx.startsWith('ch') ? 't' : (nx[0] || ''); continue; }
    if (s[i] === 'ー') continue;
    if (KANA[two]) { out += KANA[two]; i++; continue; }
    out += KANA[s[i]] ?? s[i];
  }
  // 長音を省略（とうきょう → tokyo、おおやま → oyama）
  return out.replace(/ou/g, 'o').replace(/oo/g, 'o').replace(/uu/g, 'u');
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// 「〜さん・〜ざん・〜やま」は「Mt. 〜」、それ以外（〜だけ・〜みね など）はそのままローマ字
// 英語で定着している呼び方（自動のローマ字化ではうまくいかないもの）
const NAME_EN = {
  立山: 'Tateyama', 丹沢大山: 'Tanzawa-Oyama', 鳳凰山: 'Mt. Hoo', 月山: 'Gassan', 大山: 'Daisen',
  富士山: 'Mt. Fuji', 大雪山: 'Daisetsuzan', 八ヶ岳: 'Yatsugatake',
};
export function mountainEn(yomi, name = '') {
  if (NAME_EN[name] && !(name === '大山' && yomi !== 'だいせん')) return NAME_EN[name];
  if (!yomi) return name;
  const y = toHira(yomi);
  const m = y.match(/^(.+?)(さん|ざん|やま)$/);
  // 「山」の前が短い（3 文字以下）ときは、ひとつの言葉としてローマ字にする（大山 → Oyama、月山 → Gassan）
  if (m && romaji(m[1]).length > 3 && !/おお$/.test(m[1])) return `Mt. ${cap(romaji(m[1]))}`;
  return cap(romaji(y));
}

// ---- 都道府県・地域 ----
const PREF = {
  北海道: 'Hokkaido', 青森県: 'Aomori', 岩手県: 'Iwate', 宮城県: 'Miyagi', 秋田県: 'Akita', 山形県: 'Yamagata', 福島県: 'Fukushima',
  茨城県: 'Ibaraki', 栃木県: 'Tochigi', 群馬県: 'Gunma', 埼玉県: 'Saitama', 千葉県: 'Chiba', 東京都: 'Tokyo', 神奈川県: 'Kanagawa',
  新潟県: 'Niigata', 富山県: 'Toyama', 石川県: 'Ishikawa', 福井県: 'Fukui', 山梨県: 'Yamanashi', 長野県: 'Nagano', 岐阜県: 'Gifu',
  静岡県: 'Shizuoka', 愛知県: 'Aichi', 三重県: 'Mie', 滋賀県: 'Shiga', 京都府: 'Kyoto', 大阪府: 'Osaka', 兵庫県: 'Hyogo', 奈良県: 'Nara',
  和歌山県: 'Wakayama', 鳥取県: 'Tottori', 島根県: 'Shimane', 岡山県: 'Okayama', 広島県: 'Hiroshima', 山口県: 'Yamaguchi',
  徳島県: 'Tokushima', 香川県: 'Kagawa', 愛媛県: 'Ehime', 高知県: 'Kochi', 福岡県: 'Fukuoka', 佐賀県: 'Saga', 長崎県: 'Nagasaki',
  熊本県: 'Kumamoto', 大分県: 'Oita', 宮崎県: 'Miyazaki', 鹿児島県: 'Kagoshima', 沖縄県: 'Okinawa',
};
export const prefEn = (p) => (p || '').split('・').map((x) => PREF[x] || x).join(' / ');
export const AREA_EN = { 東京: 'Tokyo', '神奈川・千葉': 'Kanagawa / Chiba', 東海: 'Tokai', 関西: 'Kansai', 九州: 'Kyushu', 北海道: 'Hokkaido' };
