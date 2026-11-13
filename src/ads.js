// Google AdMob 広告（Android アプリのときだけ動く。Web 版では何もしない）
// 構成は techgymjp/jackal の ads.js と同じ。インタースティシャル・リワード・バナーを使う
//   バナー          : トップ・あそびかた・ポーズ・結果画面の下中央だけ（プレイ中は出さない）
//   インタースティシャル: プレイ開始・トップに戻る・ポーズからの再開・結果画面からもう一度 のたびに毎回
//   リワード        : パスした問題にもう一度挑戦する（1 ゲーム 3 回まで）
const UNITS = {
  android: {
    // Google 公式のテスト用広告ユニット
    test: {
      interstitial: 'ca-app-pub-3940256099942544/1033173712',
      rewarded: 'ca-app-pub-3940256099942544/5224354917',
      banner: 'ca-app-pub-3940256099942544/6300978111',
    },
    // 本番の広告ユニット（AdMob の Android アプリ「山探し」）。
    // 空の種類は本番ビルド（Google Play 用）では出さない
    production: {
      interstitial: 'ca-app-pub-6411535997477460/5267360775',
      rewarded: 'ca-app-pub-6411535997477460/9976761975',
      banner: 'ca-app-pub-6411535997477460/5030577110',
    },
  },
};
const RETRY_MS = 20000; // 読み込みに失敗したら少し待って再挑戦する

const cap = window.Capacitor;
const native = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
let AdMob = native && cap.Plugins ? cap.Plugins.AdMob : null;
const testing = window.AD_MODE !== 'production';
const ids = UNITS.android[testing ? 'test' : 'production'];
const has = (kind) => !!ids[kind];
if (!has('interstitial') && !has('rewarded') && !has('banner')) AdMob = null;

let ready = false;           // 広告をリクエストしてよい状態（初期化と同意確認が済んだ）
let showing = false;
let privacyRequired = false; // 「広告の設定」を利用者が開けるようにする必要があるか（EU など）
const waiters = {};
// 広告を出している間は音を止める（main.js から設定）
const hooks = { pause: () => {}, resume: () => {} };

const slots = {
  inter: { unit: 'interstitial', loaded: false, pending: null, load: () => AdMob.prepareInterstitial({ adId: ids.interstitial, isTesting: testing }) },
  reward: { unit: 'rewarded', loaded: false, pending: null, load: () => AdMob.prepareRewardVideoAd({ adId: ids.rewarded, isTesting: testing }) },
};

function prepare(kind) {
  const s = slots[kind];
  if (!ready || !has(s.unit)) return Promise.resolve(false);
  if (s.loaded) return Promise.resolve(true);
  if (!s.pending) {
    s.pending = s.load()
      .then(() => { s.loaded = true; return true; })
      .catch(() => { setTimeout(() => prepare(kind), RETRY_MS); return false; })
      .finally(() => { s.pending = null; });
  }
  return s.pending;
}

function ensureLoaded(kind, timeout) {
  if (slots[kind].loaded) return Promise.resolve(true);
  return Promise.race([prepare(kind), new Promise((r) => setTimeout(() => r(false), timeout))]);
}

function finish(kind, result) {
  showing = false;
  hooks.resume();
  syncBanner();
  const w = waiters[kind];
  waiters[kind] = null;
  if (w) w(result);
}

async function init() {
  try {
    await AdMob.initialize({ initializeForTesting: testing });
  } catch (e) {
    return;
  }
  // EU・英国などで必要な広告の同意確認（必要な地域でだけフォームが出る）。
  // 確認自体が失敗した場合は、同意不要の地域とみなして続ける（ここで止まると広告が一切出なくなる）
  try {
    let consent = await AdMob.requestConsentInfo();
    if (consent.status === 'REQUIRED' && consent.isConsentFormAvailable) consent = await AdMob.showConsentForm();
    ready = consent.canRequestAds !== false;
    privacyRequired = consent.privacyOptionsRequirementStatus === 'REQUIRED';
  } catch (e) {
    ready = true;
  }
  let rewarded = false;
  AdMob.addListener('interstitialAdDismissed', () => finish('inter'));
  AdMob.addListener('interstitialAdFailedToShow', () => finish('inter'));
  AdMob.addListener('onRewardedVideoAdShowed', () => { rewarded = false; });
  AdMob.addListener('onRewardedVideoAdReward', () => { rewarded = true; });
  AdMob.addListener('onRewardedVideoAdDismissed', () => finish('reward', rewarded));
  AdMob.addListener('onRewardedVideoAdFailedToShow', () => finish('reward', false));
  prepare('inter');
  prepare('reward');
  syncBanner();
}

// 全画面広告を表示し、閉じられたら resolve する（読み込めていないときは最大 timeout ミリ秒だけ待ち、だめなら出さずに resolve）
async function showInterstitial(timeout = 0) {
  if (!AdMob || showing || !has('interstitial')) return;
  await initDone;
  if (!ready || !(await ensureLoaded('inter', timeout))) return;
  showing = true; slots.inter.loaded = false;
  hooks.pause();
  syncBanner();
  return new Promise((resolve) => {
    waiters.inter = () => { prepare('inter'); resolve(); };
    AdMob.showInterstitial().catch(() => finish('inter'));
  });
}

// リワード広告。結果は 'rewarded'（最後まで見た）/ 'skipped'（途中で閉じた）/ 'unavailable'（読み込めなかった）
async function showRewarded() {
  if (!AdMob || showing || !has('rewarded')) return 'unavailable';
  await initDone;
  if (!ready || !(await ensureLoaded('reward', 8000))) return 'unavailable';
  showing = true; slots.reward.loaded = false;
  hooks.pause();
  syncBanner();
  return new Promise((resolve) => {
    waiters.reward = (ok) => { prepare('reward'); resolve(ok ? 'rewarded' : 'skipped'); };
    AdMob.showRewardVideoAd().catch(() => finish('reward', false));
  });
}

// ---------- バナー（トップ・あそびかた・ポーズ・結果画面の下中央だけ） ----------
const banner = { want: false, state: 'none', busy: false }; // state: none | shown | hidden
function setBanner(want) {
  if (banner.want === want) return;
  banner.want = want;
  syncBanner();
}
async function syncBanner() {
  if (!AdMob || !ready || banner.busy || !has('banner')) return;
  const target = banner.want && !showing ? 'shown' : 'hidden';
  if (target === banner.state || (target === 'hidden' && banner.state === 'none')) return;
  banner.busy = true;
  try {
    if (target === 'shown') {
      if (banner.state === 'none') {
        await AdMob.showBanner({ adId: ids.banner, adSize: 'BANNER', position: 'BOTTOM_CENTER', margin: 0, isTesting: testing });
      } else {
        await AdMob.resumeBanner();
      }
      banner.state = 'shown';
    } else {
      await AdMob.hideBanner();
      banner.state = 'hidden';
    }
  } catch (e) {
    if (target === 'shown') banner.state = 'none';
  }
  banner.busy = false;
  const again = banner.want && !showing ? 'shown' : 'hidden';
  if (again !== banner.state && !(again === 'hidden' && banner.state === 'none')) syncBanner();
}

// 同意した内容をあとから変更するための Google のフォームを開く
function showPrivacyOptions() {
  if (!AdMob) return Promise.resolve();
  return AdMob.showPrivacyOptionsForm().catch(() => {});
}

const initDone = AdMob ? init() : Promise.resolve();

export const Ads = {
  get available() { return !!AdMob; },
  get canReward() { return !!AdMob && has('rewarded'); },
  get showing() { return showing; },
  get privacyOptionsRequired() { return privacyRequired; },
  initDone,
  hooks,
  showInterstitial,
  showRewarded,
  setBanner,
  showPrivacyOptions,
};
