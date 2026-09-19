// 実際に音が出ているかを見る。ヘッドレスWebKitはAudioContextのresumeが不安定なためChromiumのみ。
import { test, expect } from '@playwright/test';
import { installAudioProbe, maxPeakOver, installScheduleProbe, takeStarts, gridFit } from './helpers/audio.js';

test.beforeEach(async ({ page }) => {
  await installAudioProbe(page);
  await page.goto('/index.html');
});

test('再生するとドラムが鳴る', async ({ page }) => {
  await page.locator('#play').click();
  const { peak } = await maxPeakOver(page, 6000);
  expect(peak).toBeGreaterThan(0.02);
});

test('一時停止すると無音になる', async ({ page }) => {
  await page.locator('#play').click();
  await page.waitForTimeout(3000);
  await page.locator('#pause').click();
  // 鳴っている音の残りが消えるのを待つ
  await page.waitForTimeout(2500);
  const { peak } = await maxPeakOver(page, 2000);
  expect(peak).toBeLessThan(0.01);
});

test('音量を0にすると無音になる', async ({ page }) => {
  await page.locator('#play').click();
  await page.waitForTimeout(1500);
  await page.locator('#s_volume').fill('0');
  await page.waitForTimeout(2000);
  const { peak } = await maxPeakOver(page, 2000);
  expect(peak).toBeLessThan(0.01);
});

test('キックの音量を0にするとキックが鳴らなくなる', async ({ page }) => {
  test.setTimeout(60000);
  // two:D-54。バスドラムは正弦波の音程を 34〜50Hz へ指数で落とす。
  // 他の指数ランプは 60 以上 (ベースのフィルタなど) か 1 未満 (音量) なので、この帯域を数えればキックが取れる。
  // ただしタムも 37Hz 前後まで落ちることがあるので、後半はタムも 0 にしておく
  await page.addInitScript(() => {
    window.__kicks = 0;
    const orig = AudioParam.prototype.exponentialRampToValueAtTime;
    AudioParam.prototype.exponentialRampToValueAtTime = function (v, t) {
      if (v >= 30 && v <= 55) window.__kicks++;
      return orig.call(this, v, t);
    };
  });
  await page.goto('/index.html');
  await page.locator('.scenebtn').nth(11).click();   // 曙 daybreak。4つ打ち
  await page.locator('#play').click();
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => window.__kicks)).toBeGreaterThan(0);

  await page.locator('#s_mix_kick').fill('0');
  await page.locator('#s_mix_tom').fill('0');
  await page.waitForTimeout(500);                    // 先読みで予約済みのぶんを流す
  await page.evaluate(() => { window.__kicks = 0; });
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => window.__kicks)).toBe(0);
});

test('スネアを SOLO するとキックが鳴らなくなる', async ({ page }) => {
  test.setTimeout(60000);
  // two:D-59。計測は「キックの音量を0に」と同じ。SOLO はタムも黙らせるので、帯域の重なりは気にしなくてよい
  await page.addInitScript(() => {
    window.__kicks = 0;
    const orig = AudioParam.prototype.exponentialRampToValueAtTime;
    AudioParam.prototype.exponentialRampToValueAtTime = function (v, t) {
      if (v >= 30 && v <= 55) window.__kicks++;
      return orig.call(this, v, t);
    };
  });
  await page.goto('/index.html');
  await page.locator('.scenebtn').nth(11).click();   // 曙 daybreak。4つ打ち
  await page.locator('#play').click();
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => window.__kicks)).toBeGreaterThan(0);

  await page.locator('#solo_snare').click();
  await page.waitForTimeout(500);                    // 先読みで予約済みのぶんを流す
  await page.evaluate(() => { window.__kicks = 0; });
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => window.__kicks)).toBe(0);
});

test('発音インジケーターは鳴っている間だけ灯り、MUTE すると灯らない', async ({ page }) => {
  test.setTimeout(90000);
  /* two:D-82 (#17)。曙は4つ打ちなので kick は必ず鳴り、snare も2拍4拍に来る。
     bass は量をバス側で絞る音源の代表 (MUTE しても音自体は作られるので、記録の側で lv を見ている)。
     一定時間のうちに一度でも灯ったかを数える */
  await page.locator('.scenebtn').nth(11).click();   // 曙 daybreak
  await page.locator('#play').click();
  const litCount = (key, ms) => page.evaluate(async ({ key, ms }) => {
    const el = document.getElementById('led_' + key);
    let n = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      if (el.classList.contains('on')) n++;
      await new Promise(r => setTimeout(r, 20));
    }
    return n;
  }, { key, ms });

  expect(await litCount('kick', 3000)).toBeGreaterThan(0);
  expect(await litCount('bass', 4000)).toBeGreaterThan(0);

  /* ドラム系は発音の頭だけ光る。kick は4つ打ちなので、灯りっぱなしにならず拍ごとに点き直す。
     126BPM の3秒で約6拍。節目の変形 (抜きなど) で減っても3回は下らない */
  const riseCount = (key, ms) => page.evaluate(async ({ key, ms }) => {
    const el = document.getElementById('led_' + key);
    let n = 0, prev = false;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const v = el.classList.contains('on');
      if (v && !prev) n++;
      prev = v;
      await new Promise(r => setTimeout(r, 15));
    }
    return n;
  }, { key, ms });
  expect(await riseCount('kick', 3000)).toBeGreaterThanOrEqual(3);

  await page.locator('#mute_kick').click();
  await page.locator('#mute_bass').click();
  // MUTE の前に予約済みだった音 (先読み 0.12 秒と、長いベースの音価) が鳴り終わるのを待つ
  await page.waitForTimeout(2500);
  expect(await litCount('kick', 3000)).toBe(0);
  expect(await litCount('bass', 3000)).toBe(0);
  // 黙らせていない音源は灯り続ける
  expect(await litCount('snare', 4000)).toBeGreaterThan(0);
});

test('音の予約が16分のグリッドに乗る', async ({ page }) => {
  test.setTimeout(60000);
  await installScheduleProbe(page);
  await page.goto('/index.html');
  // 曙 (daybreak) は素直な4つ打ちのシーン。
  // グリッチは32分に置き直す仕掛けなので、定義からしてこの格子には乗らない。切っておく
  await page.locator('.scenebtn').nth(11).click();
  await page.locator('#s_glitch').fill('0');
  await page.locator('#play').click();
  await page.waitForTimeout(1500);
  const bpm = parseInt(await page.locator('#rbpm').textContent(), 10);

  await takeStarts(page);            // 立ち上がりぶんは捨てる
  await page.waitForTimeout(9000);
  const starts = await takeStarts(page);
  expect(starts.length).toBeGreaterThan(80);

  // ハットには打点ごとに ±3ms ほどの揺らぎを乗せてある (16分のおよそ2.5%)。
  // なお、クラップの連射・エレピの分散・グリッチの32分は設計上わざと格子から外している。
  // 曙 (warm キット、スネア) を選び、グリッチを切っているのはそれらを避けるため。
  // ハットとオカズにはときどき32分が入る (two:D-47) ので、16分の格子からはそのぶん外れる
  const step = (60 / bpm) / 4;
  expect(gridFit(starts, step, 0.05)).toBeGreaterThan(0.8);
  // 32分まで含めればほぼ全部が乗る
  expect(gridFit(starts, step / 2, 0.05)).toBeGreaterThan(0.95);
});

test('Ladder フィルタが AudioWorklet で動く', async ({ page }) => {
  // 代替の BiquadFilter に落ちていないことを見る (two:D-10)
  await page.addInitScript(() => {
    window.__workletNodes = [];
    const Orig = window.AudioWorkletNode;
    window.AudioWorkletNode = function (ctx, name, opts) {
      window.__workletNodes.push(name);
      return new Orig(ctx, name, opts);
    };
    window.AudioWorkletNode.prototype = Orig.prototype;
  });
  await page.goto('/index.html');
  await page.locator('#play').click();
  await expect.poll(() => page.evaluate(() => window.__workletNodes), { timeout: 8000 })
    .toContain('ladder');
});

test('重さを上げると低域が増える', async ({ page }) => {
  test.setTimeout(120000);
  // 曙 (daybreak) はベースが16分で動くシーン。
  // 「押し出し」の効きはマスターのコンプに均されて測りにくいので、
  // ベースとキックの量そのものを動かす「重さ」で見る
  await page.locator('.scenebtn').nth(11).click();
  // スライダーの値は推移時間をかけて効く。最短 (3) にしておくと時定数1秒で届く
  await page.locator('#s_glide').fill('3');
  await page.locator('#play').click();
  await page.waitForTimeout(2000);

  const lowBand = async () => page.evaluate(async () => {
    const a = window.__audioProbe;
    a.fftSize = 4096;
    const buf = new Uint8Array(a.frequencyBinCount);
    /* 1回の測定で2秒ぶん均す。ベースの並びは小節ごとに変わるので、
       1小節ぶんしか見ないと差が並びの揺らぎに埋もれる */
    let lo = 0, n = 0;
    for (let k = 0; k < 80; k++) {
      a.getByteFrequencyData(buf);
      for (let i = 3; i < 13; i++) lo += buf[i];   // 約30〜140Hz
      n++;
      await new Promise(r => setTimeout(r, 25));
    }
    return lo / n / 10;
  });

  /* 軽い側と重い側を続けて測って「対」にする。
     判定の余裕は2%しかないのに、測定のあいだにシーンもフレーズも進むので、
     別々に測った平均どうしを比べるとその揺れのほうが大きい。
     対にすればゆっくりした揺れは分子と分母で打ち消える */
  const ratio = [];
  for (let round = 0; round < 5; round++) {
    await page.locator('#s_weight').fill('0');
    await page.waitForTimeout(2500);      // 時定数1秒なので2.5秒で9割方届く
    const light = await lowBand();
    await page.locator('#s_weight').fill('1');
    await page.waitForTimeout(2500);
    const heavy = await lowBand();
    ratio.push(heavy / light);
  }
  ratio.sort((a, b) => a - b);
  // 中央値で見る。外れ値1つで落ちないように
  expect(ratio[2]).toBeGreaterThan(1.02);
  // 5往復のうち4往復以上で重い側が上回る
  expect(ratio.filter(r => r > 1).length).toBeGreaterThanOrEqual(4);
});

test('ベースが和音のルート音を基本にする', async ({ page }) => {
  test.setTimeout(60000);
  // two:D-17。ベースの矩形波は鋸波2本の差で作られるので、低い sawtooth を数えれば
  // どの音を鳴らしているかが分かる
  await page.addInitScript(() => {
    window.__bass = [];
    const orig = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const o = orig.call(this);
      const start = o.start.bind(o);
      o.start = function (when) {
        if (o.type === 'sawtooth' && o.frequency.value < 120) window.__bass.push(o.frequency.value);
        return start(when);
      };
      return o;
    };
  });
  await page.goto('/index.html');
  // 曙 (daybreak) は和音が8小節ごとに動くシーン。観測の間は同じ和音が続く
  await page.locator('.scenebtn').nth(11).click();
  await page.locator('#play').click();
  await page.waitForTimeout(1200);

  const chord = (await page.locator('#pchord').textContent()).trim();
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const rootPc = NAMES.indexOf(chord.match(/^([A-G]#?)/)[1]);
  expect(rootPc).toBeGreaterThanOrEqual(0);

  await page.evaluate(() => { window.__bass.length = 0; });
  await page.waitForTimeout(7000);
  const freqs = await page.evaluate(() => window.__bass);
  expect(freqs.length).toBeGreaterThan(20);

  const counts = {};
  for (const f of freqs) {
    const midi = Math.round(69 + 12 * Math.log2(f / 440));
    const pc = ((midi % 12) + 12) % 12;
    counts[pc] = (counts[pc] || 0) + 1;
  }
  // ルート音が最も多く鳴っていること。逸脱は認めるが基本はルート (two:D-17)
  const share = (counts[rootPc] || 0) / freqs.length;
  expect(share).toBeGreaterThan(0.4);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  expect(Number(top)).toBe(rootPc);
});

test('並びが切り替わる前の小節にオカズが入る', async ({ page }) => {
  test.setTimeout(150000);
  // two:D-20。タムは正弦波のピッチ落ちで作るので、予約された周波数を見れば拾える。
  // バスドラムとスネアも正弦なので、そちらの決まった値は除く
  await page.addInitScript(() => {
    window.__sine = [];
    const orig = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const o = orig.call(this);
      const sv = o.frequency.setValueAtTime.bind(o.frequency);
      o.frequency.setValueAtTime = function (v, t) {
        if (o.type === 'sine') window.__sine.push([Math.round(v), t]);
        return sv(v, t);
      };
      return o;
    };
  });
  // ?fill=tom でオカズの主役をタムに固定する。素のままだと55%の抽選待ちになり、
  // 出るまでの実時間でテストが伸びる。置き場所は素のままなのでここで見る性質は変わらない
  await page.goto('/index.html?fill=tom');
  await page.locator('.scenebtn').nth(11).click();   // 曙 daybreak
  await page.locator('#s_bpm').fill('140');
  await page.locator('#play').click();
  await page.waitForTimeout(1200);
  const bpm = parseInt(await page.locator('#rbpm').textContent(), 10);

  // 最頻の2〜3個はバスドラムとスネアの決まった値。残りがタム
  const pickToms = (sine) => {
    const hist = {};
    for (const [v] of sine) hist[v] = (hist[v] || 0) + 1;
    const common = Object.entries(hist).filter(([, c]) => c > sine.length * 0.1).map(([v]) => Number(v));
    return sine.filter(([v]) => !common.includes(v)).map(([, t]) => t);
  };

  // オカズは8小節に一度。140BPM で 8小節 ≒ 13.7秒なので、20個集まるのは2〜3回ぶん。
  // 実測では1分でおよそ18〜23個しか出ず、60秒で打ち切ると変更の有無によらず落ちうる。
  // 集まった時点で抜けるので、上限を延ばしても普段の実行時間は変わらない
  await page.evaluate(() => { window.__sine.length = 0; });
  let sine = [];
  for (let waited = 0; waited < 100000; waited += 5000) {
    await page.waitForTimeout(5000);
    sine = await page.evaluate(() => window.__sine);
    if (pickToms(sine).length >= 20) break;
  }
  const toms = pickToms(sine);
  expect(toms.length).toBeGreaterThanOrEqual(20);

  // オカズは小節の後ろ半分に置かれる。はみ出したぶんだけが次の小節の頭に来る (two:D-20)。
  // つまり打点は「後ろ半分」か「頭のすぐ近く」のどちらかに集まる
  const bar = (60 / bpm) * 4;
  const base = Math.floor(Math.min(...toms) / bar) * bar;
  const inBar = toms.map(t => ((t - base) / bar) % 1);
  const late = inBar.filter(u => u > 0.5).length;
  const head = inBar.filter(u => u < 0.15).length;
  expect((late + head) / inBar.length).toBeGreaterThan(0.8);
  // 主役は後ろ半分。はみ出しはそれより少ない
  expect(late).toBeGreaterThan(head);
});

test('リフは置き場所の型どおりに並ぶ', async ({ page }) => {
  test.setTimeout(150000);
  /* two:D-74。置き場所の型を ?sparkrhythm= で固定して、打点の間隔だけを見る。
     three (16分3つ歩き) を使うのは、間隔が必ず3で、しかも小節の中で完結するので
     はみ出しの例外を判定に混ぜずに済むため。素の抽選では6型のどれが来るか分からず、
     リフ自体も毎分1〜2回しか出ないので ?spark と併せて待ちを消す。
     引くところを固定するだけで、置く規則は素のままなのでここで見る性質は変わらない。
     リフの音は sparkNote 固有の署名で拾う: 鋸で |detune| が 13〜24
     (leadNote の鋸は ±6、padPluck は 0)。1音につき鋸2基なので同時刻は畳む */
  await page.addInitScript(() => {
    window.__riff = [];
    const orig = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const o = orig.call(this);
      const start = o.start.bind(o);
      o.start = function (when, ...rest) {
        const d = Math.abs(o.detune.value);
        if (o.type === 'sawtooth' && d >= 13 && d <= 24 && typeof when === 'number') {
          window.__riff.push(when);
        }
        return start(when, ...rest);
      };
      return o;
    };
  });
  await page.goto('/index.html?spark&sparkrhythm=three&dub=0');
  await page.locator('.scenebtn').nth(11).click();   // 曙 daybreak
  await page.locator('#s_glitch').fill('0');         // グリッチは32分に置き直すので切る
  await page.locator('#s_bpm').fill('140');
  await page.locator('#play').click();
  await page.waitForTimeout(1200);
  const bpm = parseInt(await page.locator('#rbpm').textContent(), 10);

  const dedup = ts => [...new Set(ts.map(t => t.toFixed(4)))].map(Number).sort((a, b) => a - b);
  await page.evaluate(() => { window.__riff.length = 0; });
  let hits = [];
  for (let waited = 0; waited < 100000; waited += 5000) {
    await page.waitForTimeout(5000);
    hits = dedup(await page.evaluate(() => window.__riff));
    if (hits.length >= 15) break;
  }
  expect(hits.length).toBeGreaterThanOrEqual(15);

  // 16分に直し、同じリフの中で隣り合う音の間隔を見る。
  // 6ステップより空いたら別のリフとみなす (1回の置き場所は20ステップに収まる)
  const step = 60 / bpm / 4;
  const nums = hits.map(t => Math.round((t - hits[0]) / step));
  const gaps = [];
  for (let i = 1; i < nums.length; i++) {
    const d = nums[i] - nums[i - 1];
    if (d > 0 && d <= 6) gaps.push(d);
  }
  expect(gaps.length).toBeGreaterThanOrEqual(8);
  expect(gaps.filter(d => d === 3).length / gaps.length).toBeGreaterThan(0.8);
});

test('16分のシーケンスが鳴る', async ({ page }) => {
  test.setTimeout(60000);
  // two:D-21。潜行はスタブ回路のシーンなので、持続回路の層 (アルペジオと高域リフ) は出ない。
  // 300Hz より上の非正弦オシレータは、実質このシーケンスだけになる
  await page.addInitScript(() => {
    window.__lead = [];
    const orig = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const o = orig.call(this);
      const start = o.start.bind(o);
      o.start = function (when) {
        if (o.type !== 'sine' && o.frequency.value > 300 && o.frequency.value < 1200) {
          window.__lead.push(when);
        }
        return start(when);
      };
      return o;
    };
  });
  await page.goto('/index.html');
  await page.locator('.scenebtn').nth(0).click();    // 潜行 submerge
  await page.locator('#s_bpm').fill('140');
  await page.locator('#play').click();
  await page.waitForTimeout(1200);
  const bpm = parseInt(await page.locator('#rbpm').textContent(), 10);

  await page.evaluate(() => { window.__lead.length = 0; });
  await page.waitForTimeout(10000);
  const lead = await page.evaluate(() => window.__lead);
  expect(lead.length).toBeGreaterThan(25);

  // 16分の格子に乗っていること
  const step = (60 / bpm) / 4;
  expect(gridFit(lead, step, 0.05)).toBeGreaterThan(0.95);
  // 8分より細かい位置にも置かれていること (16分のシーケンスである証拠)
  const base = Math.min(...lead);
  const odd = lead.filter(t => Math.round((t - base) / step) % 2 === 1).length;
  expect(odd).toBeGreaterThan(3);
});

test('コード弾きに連打のバリエーションがある', async ({ page }) => {
  test.setTimeout(60000);
  // two:D-34。火花 (spark) は必ず連打になるシーン。
  // 短い和音なので、鋸波が同じ時刻にまとまって立ち、すぐ止まる
  await page.addInitScript(() => {
    window.__chop = [];
    const orig = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const o = orig.call(this);
      const start = o.start.bind(o);
      const stop = o.stop.bind(o);
      let began = null;
      o.start = function (when) { began = when; return start(when); };
      o.stop = function (when) {
        // 和音の連打は 160ms で切れる。持続音は切らないので混ざらない
        if (o.type === 'sawtooth' && began !== null && when - began > 0.15 && when - began < 0.17) {
          window.__chop.push(began);
        }
        return stop(when);
      };
      return o;
    };
  });
  await page.goto('/index.html');
  await page.locator('.scenebtn').nth(10).click();   // 火花 spark
  await expect(page.locator('#pchord')).toContainText(' chop');

  await page.locator('#s_bpm').fill('140');
  await page.locator('#play').click();
  await page.waitForTimeout(1500);
  const bpm = parseInt(await page.locator('#rbpm').textContent(), 10);

  await page.evaluate(() => { window.__chop.length = 0; });
  await page.waitForTimeout(9000);
  const hits = [...new Set(await page.evaluate(() => window.__chop))].sort((a, b) => a - b);
  expect(hits.length).toBeGreaterThan(5);

  // 8分を基本に、たまに16分の返しが入る。隣り合う打点はそのどちらかが大半を占める。
  // 密度は「密度」スライダーとフレーズ型で動くので、割合には幅を見ておく
  const step = (60 / bpm) / 4;
  const gaps = [];
  for (let i = 1; i < hits.length; i++) gaps.push(Math.round((hits[i] - hits[i - 1]) / step));
  expect(gaps.filter(g => g <= 2).length / gaps.length).toBeGreaterThan(0.5);
  // すべて16分の格子の上にある
  expect(gaps.every(g => g >= 1)).toBe(true);
});

test('持続のシーンでは連打にならない', async ({ page }) => {
  // 祝祭 (jubilee) は chop を持たないので、必ず持続音になる (two:D-34)
  await page.goto('/index.html');
  await page.locator('.scenebtn').nth(13).click();
  await expect(page.locator('#pchord')).toContainText('[sustain');
  await expect(page.locator('#pchord')).not.toContainText(' chop');
});

test('monitor に波形が出る', async ({ page }) => {
  // two:D-36。出力から分岐した AnalyserNode を作り、その波形を canvas に描く
  await page.addInitScript(() => {
    window.__analysers = 0;
    const orig = AudioContext.prototype.createAnalyser;
    AudioContext.prototype.createAnalyser = function () {
      window.__analysers++;
      return orig.call(this);
    };
  });
  await page.goto('/index.html');
  expect(await page.evaluate(() => window.__analysers)).toBe(0);

  await page.locator('#play').click();
  await expect.poll(() => page.evaluate(() => window.__analysers), { timeout: 8000 })
    .toBeGreaterThan(0);

  // 描いている中身が時間とともに変わる。止めると変わらなくなる
  const strip = () => page.evaluate(() => {
    const cv = document.getElementById('cv');
    const g = cv.getContext('2d');
    const d = g.getImageData(0, 0, cv.width, 1).data;   // 上端1行では波形は動かない
    const mid = g.getImageData(0, cv.height >> 1, cv.width, 1).data;
    let sum = 0;
    for (let i = 0; i < mid.length; i += 4) sum += mid[i] + mid[i + 1] + mid[i + 2];
    return sum;
  });
  await page.waitForTimeout(1200);
  const a = await strip();
  await page.waitForTimeout(700);
  const b = await strip();
  expect(a).not.toBe(b);
});

test('lush を上げると、strings の持続音が開いた配置になる', async ({ page }) => {
  test.setTimeout(60000);
  // two:D-66。持続音の鋸波は detune がちょうど ±6。立ち上げた時刻ごとに組にして、音の並びを調べる
  await page.addInitScript(() => {
    window.__pad = {};
    const orig = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const o = orig.call(this);
      const start = o.start.bind(o);
      o.start = function (when) {
        if (o.type === 'sawtooth' && o.detune.value === -6) {
          const m = Math.round(69 + 12 * Math.log2(o.frequency.value / 440));
          (window.__pad[when.toFixed(3)] ||= []).push(m);
        }
        return start(when);
      };
      return o;
    };
  });
  await page.goto('/index.html');
  await page.locator('#s_glide').fill('3');
  await page.locator('#s_lush').fill('1');
  await page.waitForTimeout(6000);
  await page.locator('.scenebtn').nth(11).click();   // 曙 daybreak (sustain)
  await expect(page.locator('#pchord')).toContainText('[sustain lush');
  await page.locator('#play').click();
  await expect.poll(() => page.evaluate(() => Object.keys(window.__pad).length), { timeout: 15000 })
    .toBeGreaterThan(0);

  const groups = Object.values(await page.evaluate(() => window.__pad));
  for (const g of groups) {
    const notes = [...g].sort((a, b) => a - b);
    // 低い音域では隣り合う音を3半音以上離す
    for (let k = 1; k < notes.length; k++) {
      if (notes[k] < 60) expect(notes[k] - notes[k - 1]).toBeGreaterThanOrEqual(3);
    }
    // 同じ音名を重ねない (根音も重ねない)
    expect(new Set(notes.map(n => n % 12)).size).toBe(notes.length);
  }
});

test('e.piano は正弦波を同じ周波数の正弦波で変調して鳴る', async ({ page }) => {
  test.setTimeout(60000);
  // two:D-68。発振器 → 増幅 → 別の発振器の周波数、というつなぎを追い、
  // 変調する側とされる側がどちらも正弦波で、周波数が同じ組 (1:1 の FM) を数える。
  // FM を使う他の音 (リフのベルは非整数比、打鍵のカチッは14倍) はこの条件に入らない
  await page.addInitScript(() => {
    window.__fm11 = 0;
    const freqOwner = new WeakMap();   // 周波数の AudioParam → その発振器
    const gainSource = new WeakMap();  // 増幅 → そこへつないだ発振器
    const origOsc = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const o = origOsc.call(this);
      freqOwner.set(o.frequency, o);
      return o;
    };
    const origConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dest, ...rest) {
      if (this instanceof OscillatorNode && dest instanceof GainNode) gainSource.set(dest, this);
      if (this instanceof GainNode && dest instanceof AudioParam && freqOwner.has(dest)) {
        const src = gainSource.get(this), car = freqOwner.get(dest);
        if (src && src.type === 'sine' && car.type === 'sine' && src.frequency.value === car.frequency.value) {
          window.__fm11++;
        }
      }
      return origConnect.call(this, dest, ...rest);
    };
  });
  await page.goto('/index.html');
  await page.locator('.scenebtn').nth(5).click();   // 硝子 glass (jazz)。e.piano が主役
  await page.locator('#play').click();
  await expect.poll(() => page.evaluate(() => window.__fm11), { timeout: 20000 }).toBeGreaterThan(0);
});
