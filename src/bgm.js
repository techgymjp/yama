// スイス風ヨーデルの BGM を Web Audio で合成する（音源ファイル不要のオリジナル曲）
// 3/4 拍子のレントラー: ベース（ウン）＋アコーディオン（パッパ）＋ヨーデルの声＋カウベル＋山びこ

const TEMPO = 116; // 4分音符/分
const BEAT = 60 / TEMPO;
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

// 音名 → MIDI
const N = (s) => {
  const m = s.match(/^([A-G])(#|b)?(\d)$/);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  return base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (+m[3] + 1) * 12;
};

// 母音のフォルマント（F1, F2, F3）
const VOWELS = {
  o: [450, 800, 2830], u: [325, 700, 2530], a: [700, 1220, 2600],
  i: [300, 2300, 3000], e: [400, 2000, 2550],
};

// 和音（ルート, 構成音）
const CHORDS = {
  G: { root: 'G2', fifth: 'D3', notes: ['G3', 'B3', 'D4'] },
  C: { root: 'C3', fifth: 'G2', notes: ['C4', 'E4', 'G4'] },
  D7: { root: 'D3', fifth: 'A2', notes: ['C4', 'D4', 'F#4'] },
};

// A: ヨーデル（声） / B: アコーディオンの間奏
// 各音: [音名, 拍数, 母音]  母音 o/u/a = 地声、i/e = 裏声
const PART_A = [
  { chord: 'G', mel: [['D4', 1, 'o'], ['G4', 0.5, 'o'], ['B4', 0.5, 'i'], ['D5', 1, 'i']] },
  { chord: 'G', mel: [['B4', 0.5, 'e'], ['G4', 0.5, 'o'], ['D4', 1, 'u'], ['G4', 1, 'o']] },
  { chord: 'D7', mel: [['C5', 1, 'i'], ['A4', 0.5, 'a'], ['F#4', 0.5, 'o'], ['D4', 1, 'u']] },
  { chord: 'D7', mel: [['A4', 0.5, 'o'], ['C5', 0.5, 'e'], ['F#5', 1, 'i'], ['D5', 1, 'i']] },
  { chord: 'D7', mel: [['C5', 0.5, 'i'], ['A4', 0.5, 'o'], ['F#4', 1, 'u'], ['A4', 1, 'o']] },
  { chord: 'D7', mel: [['D5', 1, 'i'], ['C5', 0.5, 'e'], ['A4', 0.5, 'o'], ['F#4', 1, 'u']] },
  { chord: 'G', mel: [['G4', 0.5, 'o'], ['B4', 0.5, 'i'], ['D5', 0.5, 'i'], ['G5', 0.5, 'i'], ['D5', 1, 'e']] },
  { chord: 'G', mel: [['B4', 0.5, 'i'], ['D4', 0.5, 'o'], ['G4', 2, 'u']] },
];
const PART_B = [
  { chord: 'C', mel: [['E5', 1], ['C5', 1], ['G4', 1]] },
  { chord: 'C', mel: [['A4', 0.5], ['C5', 0.5], ['E5', 2]] },
  { chord: 'G', mel: [['D5', 1], ['B4', 1], ['G4', 1]] },
  { chord: 'G', mel: [['B4', 0.5], ['D5', 0.5], ['G5', 2]] },
  { chord: 'D7', mel: [['F#5', 1], ['E5', 0.5], ['D5', 0.5], ['C5', 1]] },
  { chord: 'D7', mel: [['A4', 1], ['F#4', 1], ['A4', 1]] },
  { chord: 'G', mel: [['G4', 0.5], ['B4', 0.5], ['D5', 1], ['B4', 1]] },
  { chord: 'G', mel: [['G4', 3]] },
];
const SONG = [
  ...PART_A.map((b) => ({ ...b, voice: true })),
  ...PART_B.map((b) => ({ ...b, voice: false })),
  ...PART_A.map((b) => ({ ...b, voice: true })),
  ...PART_B.map((b, i) => ({ ...b, voice: i >= 4 })), // 後半は声とアコーディオンの掛け合い
];

export function createBgm(opts = {}) {
  let ctx = opts.context || null, master = null, timer = 0, playing = false;
  let nextBar = 0, nextTime = 0;
  let voice = null;
  let sfxOut = null;

  function setup() {
    if (master) return;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    master = ctx.createGain();
    master.gain.value = 0.32;
    // 山びこ（ディレイ）
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = BEAT * 1.5;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    master.connect(ctx.destination);
    // 効果音は BGM の音量フェードと別系統
    sfxOut = ctx.createGain(); sfxOut.gain.value = 0.5;
    sfxOut.connect(ctx.destination); sfxOut.connect(delay);
    master.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(wet); wet.connect(ctx.destination);
  }

  // ---- ヨーデルの声（1本の持続音を音程・母音・音色を切り替えて歌わせる） ----
  function makeVoice() {
    const src = ctx.createOscillator(); src.type = 'sawtooth';
    const head = ctx.createOscillator(); head.type = 'triangle'; // 裏声用の柔らかい音
    const vib = ctx.createOscillator(); vib.frequency.value = 5.6;
    const vibGain = ctx.createGain(); vibGain.gain.value = 0;
    vib.connect(vibGain); vibGain.connect(src.frequency); vibGain.connect(head.frequency);
    const chestG = ctx.createGain(), headG = ctx.createGain();
    src.connect(chestG); head.connect(headG);
    const mix = ctx.createGain();
    chestG.connect(mix); headG.connect(mix);
    const out = ctx.createGain(); out.gain.value = 0;
    const formants = [0, 1, 2].map((k) => {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = [7, 10, 12][k];
      const g = ctx.createGain(); g.gain.value = [1.6, 0.9, 0.35][k];
      mix.connect(bp); bp.connect(g); g.connect(out);
      return bp;
    });
    out.connect(master);
    src.start(); head.start(); vib.start();
    return { src, head, vibGain, chestG, headG, out, formants, lastFreq: 0 };
  }

  function sing(midi, vowel, t, dur) {
    if (!voice) voice = makeVoice();
    const v = voice, f = mtof(midi);
    const isHead = vowel === 'i' || vowel === 'e';
    // 地声⇔裏声の切り替えで音程がひっくり返る（ヨーデルの特徴）
    for (const o of [v.src, v.head]) {
      o.frequency.cancelScheduledValues(t);
      if (v.lastFreq) { o.frequency.setValueAtTime(v.lastFreq, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.035); }
      else o.frequency.setValueAtTime(f, t);
    }
    v.lastFreq = f;
    v.chestG.gain.setTargetAtTime(isHead ? 0.25 : 1, t, 0.015);
    v.headG.gain.setTargetAtTime(isHead ? 1.6 : 0.2, t, 0.015);
    const fm = VOWELS[vowel];
    v.formants.forEach((bp, k) => bp.frequency.setTargetAtTime(fm[k] * (isHead ? 1.08 : 1), t, 0.02));
    v.vibGain.gain.setValueAtTime(0, t);
    v.vibGain.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(0.35, dur * 0.6));
    // 子音（y/d/l）の短い切れ目
    const g = v.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.12, t + 0.02);
    g.linearRampToValueAtTime(0.55, t + 0.06);
    g.setValueAtTime(0.55, t + Math.max(0.07, dur - 0.08));
    g.linearRampToValueAtTime(0.35, t + dur);
  }
  function rest(t) {
    if (!voice) return;
    voice.out.gain.cancelScheduledValues(t);
    voice.out.gain.setTargetAtTime(0, t, 0.05);
  }

  // ---- アコーディオン（ミュゼット風にわずかにずらした 2 本のリード） ----
  function accordion(midis, t, dur, vol) {
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + 0.02);
    env.gain.setValueAtTime(vol * 0.85, t + dur * 0.7);
    env.gain.linearRampToValueAtTime(0, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; lp.Q.value = 0.7;
    lp.connect(env); env.connect(master);
    for (const m of midis) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        o.connect(lp);
        o.start(t); o.stop(t + dur + 0.05);
      }
    }
  }

  function bass(midi, t) {
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.01, t + BEAT * 0.9);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + BEAT);
  }

  function cowbell(t) {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    bp.connect(g); g.connect(master);
    for (const f of [562, 845]) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
      o.connect(bp); o.start(t); o.stop(t + 0.65);
    }
  }

  function scheduleBar(bar, t) {
    const b = SONG[bar % SONG.length];
    const ch = CHORDS[b.chord];
    // ウン・パッ・パッ
    bass(N(bar % 2 ? ch.fifth : ch.root), t);
    const chord = ch.notes.map(N);
    accordion(chord, t + BEAT, BEAT * 0.45, b.voice ? 0.05 : 0.04);
    accordion(chord, t + BEAT * 2, BEAT * 0.45, b.voice ? 0.05 : 0.04);
    if (bar % 8 === 0) cowbell(t);
    if (bar % 8 === 4) cowbell(t + BEAT * 2);
    // 旋律
    let at = t;
    for (const [n, beats, vowel] of b.mel) {
      const dur = beats * BEAT;
      if (b.voice) sing(N(n), vowel || 'o', at, dur);
      else accordion([N(n), N(n) + 12], at, dur * 0.92, 0.11);
      at += dur;
    }
    if (!b.voice) rest(t);
    // フレーズの終わりで息継ぎ
    if (b.voice && bar % 8 === 7) rest(t + BEAT * 2.85);
  }

  function tick() {
    while (nextTime < ctx.currentTime + 0.4) {
      scheduleBar(nextBar, nextTime);
      nextBar++;
      nextTime += BEAT * 3;
    }
  }

  // ---- 効果音 ----
  function tone(type, freq, t, dur, vol, { to, attack = 0.01 } = {}) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(sfxOut);
    o.start(t); o.stop(t + dur + 0.05);
  }
  // アルプホルン風の音（倍音を足した柔らかい金管）
  function horn(midi, t, dur, vol) {
    const f = mtof(midi);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(1800, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.08);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur);
    lp.connect(g); g.connect(sfxOut);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    o.connect(lp); o.start(t); o.stop(t + dur + 0.05);
  }
  const SFX = {
    // スタート: アルプホルンのファンファーレ＋カウベル
    start(t) {
      [['G3', 0, 0.35], ['D4', 0.3, 0.35], ['G4', 0.6, 0.35], ['B4', 0.9, 0.9]].forEach(([n, dt, d]) => horn(N(n), t + dt, d, 0.22));
      cowbellSfx(t + 0.9);
    },
    // 正解: 明るい上昇アルペジオ＋「ヨーロレイヒー」風の裏返り
    correct(t) {
      ['C5', 'E5', 'G5', 'C6'].forEach((n, i) => tone('triangle', mtof(N(n)), t + i * 0.07, 0.35, 0.28));
      tone('sine', mtof(N('G5')), t + 0.32, 0.12, 0.2, { to: mtof(N('C6')) });
      tone('sine', mtof(N('E6')), t + 0.44, 0.45, 0.22);
      cowbellSfx(t + 0.3);
    },
    // はずれ: 下がっていく「ブブー」
    wrong(t) {
      tone('square', 220, t, 0.18, 0.12, { to: 200 });
      tone('square', 180, t + 0.2, 0.32, 0.12, { to: 140 });
    },
    // 結果発表（よい成績）: アルプホルンのファンファーレ＋ヨーデルの決め＋カウベル連打
    result(t) {
      [['G3', 0, 0.3], ['B3', 0.25, 0.3], ['D4', 0.5, 0.3], ['G4', 0.75, 0.6], ['D4', 1.3, 0.25], ['G4', 1.55, 1.2]].forEach(([n, dt, d]) => horn(N(n), t + dt, d, 0.22));
      ['G5', 'B5', 'D6'].forEach((n, i) => tone('triangle', mtof(N(n)), t + 1.55 + i * 0.09, 0.9, 0.16));
      tone('sine', mtof(N('D5')), t + 2.0, 0.15, 0.2, { to: mtof(N('G5')) });
      tone('sine', mtof(N('B5')), t + 2.15, 0.6, 0.2);
      [0.75, 1.55, 1.8, 2.05].forEach((dt) => cowbellSfx(t + dt));
    },
    // 結果発表（もう一息）: やさしい下降と上昇
    resultLow(t) {
      [['D4', 0, 0.35], ['B3', 0.3, 0.35], ['G3', 0.6, 0.5], ['D4', 1.1, 0.3], ['G4', 1.4, 0.9]].forEach(([n, dt, d]) => horn(N(n), t + dt, d, 0.2));
      cowbellSfx(t + 1.4);
    },
    // ヒント・パスなどの軽い操作音
    click(t) { tone('sine', 880, t, 0.08, 0.15, { to: 660 }); },
    reveal(t) { ['G4', 'D4', 'B3'].forEach((n, i) => tone('triangle', mtof(N(n)), t + i * 0.12, 0.3, 0.2)); },
  };
  function cowbellSfx(t) {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    bp.connect(g); g.connect(sfxOut);
    for (const f of [562, 845]) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
      o.connect(bp); o.start(t); o.stop(t + 0.75);
    }
  }

  return {
    // 試聴用: OfflineAudioContext に曲と効果音をまとめて書き出す
    renderAll(seconds, sfxList = []) {
      setup();
      let t = 0.1, bar = 0;
      while (t < seconds - BEAT * 3) { scheduleBar(bar++, t); t += BEAT * 3; }
      rest(t);
      for (const [name, at] of sfxList) SFX[name](at);
    },
    sfx(name) {
      setup();
      if (!ctx || !SFX[name]) return;
      if (ctx.state === 'suspended') ctx.resume();
      SFX[name](ctx.currentTime + 0.02);
    },
    // ユーザー操作（タップ）の中で呼ぶ必要がある（ブラウザの自動再生制限）
    unlock() {
      setup();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    start() {
      setup();
      if (!ctx || playing) return;
      if (ctx.state === 'suspended') ctx.resume();
      playing = true;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(0, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0.32, ctx.currentTime + 1.5);
      nextBar = 0;
      nextTime = ctx.currentTime + 0.1;
      tick();
      timer = setInterval(tick, 100);
    },
    stop() {
      if (!ctx || !playing) return;
      playing = false;
      clearInterval(timer);
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0, t + 0.4);
      if (voice) {
        const v = voice; voice = null;
        setTimeout(() => { try { v.src.stop(); v.head.stop(); } catch { /* 停止済み */ } }, 600);
      }
    },
    suspend() { if (ctx) ctx.suspend(); },
    resume() { if (ctx && playing) ctx.resume(); },
    get playing() { return playing; },
  };
}
