// 進行 (第1層 シーン / 第2層 フレーズ / 第3層 イベント) が回っているかを見る。
// この段階ではまだ音源が無いので、確認手段は画面の表示だけになる。
import { test, expect } from '@playwright/test';

// 「scene 12/64」のような表示から現在の小節を読む
async function sceneBar(page) {
  const txt = await page.locator('#pbarpos').textContent();
  const m = txt.match(/scene (\d+)\//);
  return m ? parseInt(m[1], 10) : -1;
}
// 「4/16 (scene ...)」の左側。フレーズ内の位置
async function phraseBar(page) {
  const txt = await page.locator('#pbarpos').textContent();
  const m = txt.match(/^(\d+)\/(\d+)/);
  return m ? parseInt(m[1], 10) : -1;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
});

test('再生すると小節とステップが進む', async ({ page }) => {
  await expect(page.locator('#rbar')).toHaveText('—');

  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveAttribute('data-on', '1');

  // 16分ステップの点灯が動く
  await expect(page.locator('#steps i.now')).toHaveCount(1, { timeout: 5000 });

  const first = await sceneBar(page);
  expect(first).toBeGreaterThan(0);
  await page.waitForTimeout(6000);
  const later = await sceneBar(page);
  expect(later).toBeGreaterThan(first);
});

test('一時停止すると進行が止まる', async ({ page }) => {
  await page.locator('#play').click();
  await page.waitForTimeout(2500);
  await page.locator('#pause').click();
  await expect(page.locator('#pause')).toHaveAttribute('data-on', '1');
  await expect(page.locator('#rbar')).toHaveText('—');

  const stopped = await sceneBar(page);
  await page.waitForTimeout(2500);
  expect(await sceneBar(page)).toBe(stopped);
  // 止めたらステップの点灯も消える
  await expect(page.locator('#steps i.now')).toHaveCount(0);
});

test('16小節でフレーズが切り替わる', async ({ page }) => {
  // 1小節はおよそ1.8秒。16小節で30秒近くかかるので、この1本だけ長めに取る
  test.setTimeout(120000);
  // BPM を上げて待ち時間を詰める
  await page.locator('#s_bpm').fill('140');
  // 「展開」を上げると8小節の折り返しでも切り替わる (two:D-11)。
  // ここで見たいのは16小節ぶんの区切りなので、切らずに走らせる
  await page.locator('#s_evolution').fill('0');
  await page.locator('#play').click();

  // フレーズの最後の小節まで進むのを待つ
  await expect.poll(() => phraseBar(page), { timeout: 60000, intervals: [500] }).toBe(16);
  const atEnd = await sceneBar(page);
  // 次の小節でフレーズ内の位置が1へ戻る。シーン側の小節は戻らず進み続ける
  await expect.poll(() => phraseBar(page), { timeout: 15000, intervals: [200] }).toBe(1);
  expect(await sceneBar(page)).toBeGreaterThan(atEnd);
  await expect(page.locator('#pphrase')).not.toHaveText('—');
});

test('4小節ごとにイベントの判定が走る', async ({ page }) => {
  test.setTimeout(120000);
  // 発火は確率なので、判定機会の数を稼がないと取りこぼす。
  // 最速のシーン (疾走) を選び、BPM も上げて4小節を6秒台まで詰める
  await page.locator('.scenebtn').nth(12).click();
  await page.locator('#s_bpm').fill('140');
  // グリッチを上げるとグリッチ系イベントの重みも上がる
  await page.locator('#s_glitch').fill('1');
  await page.locator('#play').click();

  await expect(page.locator('#pevent')).toContainText('@bar', { timeout: 90000 });
  const txt = await page.locator('#pevent').textContent();
  const bar = parseInt(txt.match(/@bar (\d+)/)[1], 10);
  // 判定は4小節の節目でのみ走る。開始直後の1小節目には出さない
  expect(bar).toBeGreaterThan(0);
  expect(bar % 4).toBe(0);
});

test('「次へ」でシーンが変わる', async ({ page }) => {
  const before = await page.locator('#scenename').textContent();
  // 直近3つを避けて引くので、数回押せば必ず別のシーンになる
  await page.locator('#next').click();
  const after = await page.locator('#scenename').textContent();
  expect(after).not.toBe(before);
});

test('一覧から選ぶとそのシーンになる', async ({ page }) => {
  const btn = page.locator('.scenebtn').nth(9);   // 鋼 steel
  const name = (await btn.textContent()).trim();
  await btn.click();
  await expect(page.locator('#scenename')).toHaveText(name);
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
});

test('スライダーを触ると (edit) が付く', async ({ page }) => {
  await expect(page.locator('#scenename')).not.toContainText('(edit)');
  await page.locator('#s_drive').fill('0.9');
  await expect(page.locator('#scenename')).toContainText('(edit)');
});

test('シーンごとに使うハーモニー回路が変わる', async ({ page }) => {
  // two:D-8 のとおり、3回路のどれを鳴らすかはシーンが決める
  const cases = [[0, '[stab'], [5, '[e.piano'], [11, '[sustain'], [7, '[sustain (thin)']];
  for (const [idx, label] of cases) {
    await page.locator('.scenebtn').nth(idx).click();
    await expect(page.locator('#pchord')).toContainText(label);
  }
});

test('和音が進行する', async ({ page }) => {
  test.setTimeout(90000);
  // 硝子 (glass) はジャズ回路のシーン。和音は4小節ごとに動く
  await page.locator('.scenebtn').nth(5).click();
  await page.locator('#s_bpm').fill('140');
  await page.locator('#play').click();
  const first = (await page.locator('#pchord').textContent()).split(' ')[0];
  await expect.poll(async () => (await page.locator('#pchord').textContent()).split(' ')[0],
    { timeout: 60000, intervals: [500] }).not.toBe(first);
});

test('スタブのシーンでは和音がほとんど動かない', async ({ page }) => {
  // スタブ回路はほとんど進行しない (two:D-9)。8小節に一度しか変わらない (two:D-67 で16から半分に)。
  // 140BPM の8小節は約13.7秒なので、その手前までは同じ和音のまま
  await page.locator('.scenebtn').nth(0).click();
  await page.locator('#s_bpm').fill('140');
  await page.locator('#play').click();
  const first = (await page.locator('#pchord').textContent()).split(' ')[0];
  await page.waitForTimeout(9000);   // 5小節ぶんほど
  expect((await page.locator('#pchord').textContent()).split(' ')[0]).toBe(first);
});

test('「次へ」はブレイクを挟んでシーンを乗り換える', async ({ page }) => {
  test.setTimeout(90000);
  // two:D-5 方式1。自動の切り替えと同じ機構を通り、ブレイクの間に行き先が表示される
  await page.locator('.scenebtn').nth(12).click();   // 疾走 dash。1小節が短い
  await page.locator('#s_bpm').fill('140');
  await page.locator('#play').click();
  await page.waitForTimeout(1500);

  const before = (await page.locator('#scenename').textContent()).replace(' (edit)', '');
  await page.locator('#next').click();

  // 行き先が矢印付きで出る。ブレイクになるのは乗り換えの直前1小節だけなので、
  // ここではまだ今のフレーズのまま (two:D-24)
  await expect(page.locator('#pphrase')).toContainText('→', { timeout: 8000 });
  // まだシーンは変わっていない
  expect((await page.locator('#scenename').textContent()).replace(' (edit)', '')).toBe(before);

  // 4小節ぶんのブレイクが明けたら乗り換わる
  await expect.poll(async () => (await page.locator('#scenename').textContent()).replace(' (edit)', ''),
    { timeout: 30000, intervals: [300] }).not.toBe(before);
  await expect(page.locator('#pphrase')).not.toContainText('→');
});

test('遷移中はBPMが次のシーンへ向かって動く', async ({ page }) => {
  test.setTimeout(90000);
  // two:D-6。BPM は乗り換えの瞬間に飛ぶのではなく、ブレイクの間に寄っていく
  await page.locator('.scenebtn').nth(0).click();    // 潜行 118
  await page.locator('#play').click();
  await page.waitForTimeout(3000);
  const before = parseInt(await page.locator('#rbpm').textContent(), 10);
  expect(before).toBe(118);

  await page.locator('#next').click();
  // 行き先の BPM は選ばれるまで分からないので、値が動くことだけを見る
  await expect.poll(() => page.locator('#rbpm').textContent().then(v => parseInt(v, 10)),
    { timeout: 30000, intervals: [300] }).not.toBe(before);
});

test('two:D-11 の操作がひと通り揃っている', async ({ page }) => {
  // 増減があったときに気づけるよう、操作の一覧をここで押さえておく
  for (const id of ['s_volume', 's_yy', 's_density', 's_weight', 's_drive', 's_space', 's_glitch',
                    's_evolution', 's_mutate', 's_shift', 's_lush', 's_bpm', 's_glide']) {
    await expect(page.locator('#' + id)).toBeVisible();
  }
  await expect(page.locator('#next')).toBeVisible();
  // XYパッドは廃止し、陰陽と密度もスライダーにした (two:D-54)
  await expect(page.locator('#plane')).toHaveCount(0);
  // 個別の音量 (two:D-54)
  for (const key of ['kick', 'snare', 'clap', 'hat', 'ohat', 'cymbal', 'tom', 'rim', 'perc', 'cowbell',
                     'bassFunk', 'bass', 'strings', 'chop', 'stab', 'ep', 'lead', 'riff', 'bell', 'bellRatio', 'noise']) {
    await expect(page.locator('#s_mix_' + key)).toHaveCount(1);
  }
});

test('連続変形の遷移ではブレイクを挟まない', async ({ page }) => {
  test.setTimeout(90000);
  // two:D-5 方式2。?transition= で方式を固定できる (開発用)
  await page.goto('/index.html?transition=morph');
  await page.locator('.scenebtn').nth(12).click();   // 疾走 dash
  await page.locator('#s_bpm').fill('140');
  await page.locator('#play').click();
  await page.waitForTimeout(1500);

  const before = (await page.locator('#scenename').textContent()).replace(' (edit)', '');
  await page.locator('#next').click();
  await expect(page.locator('#pphrase')).toContainText('(morph)', { timeout: 8000 });
  // ブレイクにはならない。表示の方式名にも break が入りうるので、矢印より前だけを見る
  expect((await page.locator('#pphrase').textContent()).split('→')[0]).not.toContain('break');

  // 16小節かけて乗り換わる
  await expect.poll(async () => (await page.locator('#scenename').textContent()).replace(' (edit)', ''),
    { timeout: 60000, intervals: [500] }).not.toBe(before);
});

test('ミックスの遷移では新旧が重なる', async ({ page }) => {
  test.setTimeout(90000);
  // two:D-5 方式3。入ってくるシーンのドラムが2本目の経路から重なる
  await page.goto('/index.html?transition=mix');
  await page.locator('.scenebtn').nth(12).click();
  await page.locator('#s_bpm').fill('140');
  await page.locator('#play').click();
  await page.waitForTimeout(1500);

  const before = (await page.locator('#scenename').textContent()).replace(' (edit)', '');
  await page.locator('#next').click();
  await expect(page.locator('#pphrase')).toContainText('(mix)', { timeout: 8000 });
  expect((await page.locator('#pphrase').textContent()).split('→')[0]).not.toContain('break');

  await expect.poll(async () => (await page.locator('#scenename').textContent()).replace(' (edit)', ''),
    { timeout: 60000, intervals: [500] }).not.toBe(before);
  // 乗り換えが済んだら表示から矢印が消える
  await expect(page.locator('#pphrase')).not.toContainText('→');
});

test('ブレイクは1小節を超えない', async ({ page }) => {
  test.setTimeout(90000);
  // two:D-24。フレーズ型の break は出るかどうかが確率なので、確実に起こせる経路で見る。
  // ブレイクを挟む遷移では、乗り換えの直前1小節だけが必ずブレイクになる
  // 乗り換え前の小節は40%でダブになりブレイクを置かないので、?dub=0 でオカズ (とブレイク) に固定する (two:D-62)
  await page.goto('/index.html?transition=break&dub=0');
  await page.locator('.scenebtn').nth(12).click();   // 疾走 dash。1小節が短い
  await page.locator('#s_bpm').fill('140');
  await page.locator('#play').click();
  await page.waitForTimeout(1500);
  const bpm = parseInt(await page.locator('#rbpm').textContent(), 10);
  const barMs = (60 / bpm) * 4 * 1000;

  // 表示は「フレーズ → 行き先 (方式)」の形で、方式の名前にも break が入る。
  // 見たいのはフレーズ側なので、矢印より前だけを取る
  const phrase = async () =>
    (await page.locator('#pphrase').textContent()).split('→')[0].trim();
  await page.locator('#next').click();

  await expect.poll(phrase, { timeout: 30000, intervals: [100] }).toContain('break');
  const t0 = Date.now();
  await expect.poll(phrase, { timeout: 20000, intervals: [100] }).not.toContain('break');
  // 検出の遅れぶんを見込んでも、2小節ぶんは超えない
  expect(Date.now() - t0).toBeLessThan(barMs * 2);
});

test('ベースの旋律は小節ごとには変わらない', async ({ page }) => {
  test.setTimeout(90000);
  // two:D-30。ベースの矩形波は鋸波2本の差なので、低い sawtooth の予約を拾えば旋律が分かる
  await page.addInitScript(() => {
    window.__bn = [];
    const orig = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const o = orig.call(this);
      const start = o.start.bind(o);
      o.start = function (when) {
        if (o.type === 'sawtooth' && o.frequency.value < 120 && typeof when === 'number') {
          window.__bn.push([when, o.frequency.value]);
        }
        return start(when);
      };
      return o;
    };
  });
  await page.goto('/index.html');
  await page.locator('.scenebtn').nth(0).click();    // 潜行。和音が8小節ごとにしか動かない (two:D-67)
  await page.locator('#s_bpm').fill('140');
  await page.locator('#s_mutate').fill('0');          // 変異で引き直させない
  await page.locator('#s_evolution').fill('0');       // フレーズを早く切り替えさせない
  await page.locator('#play').click();
  // BPM は時定数6秒で目標へ寄るので、落ち着くまで待つ。
  // 途中で測ると小節の長さがずれ、位置の比較が崩れる
  await page.waitForTimeout(16000);
  const bpm = parseInt(await page.locator('#rbpm').textContent(), 10);

  await page.evaluate(() => { window.__bn.length = 0; });
  /* 16小節ぶん (140BPM で約27秒) 測る。8小節ぶんだけだと、比べる隣り合う組が5つしか取れず、
     オカズの小節とその次 (2組) に和音の変わり目 (two:D-67 で8小節ごと) が1つ重なるだけで 0.6 ちょうどになる。
     変わり目の数は測る長さに比例しないので、長く測れば比率に余裕が出る */
  await page.waitForTimeout(28000);
  const raw = await page.evaluate(() => window.__bn);
  expect(raw.length).toBeGreaterThan(20);

  // 1音につき鋸波が6本立つので、時刻でまとめる
  const notes = new Map();
  for (const [t, f] of raw) notes.set(Math.round(t * 1000), f);

  const barSec = (60 / bpm) * 4;
  const step = barSec / 16;
  const t0 = Math.min(...notes.keys()) / 1000;
  const bars = new Map();
  for (const [ms, f] of notes) {
    const t = ms / 1000;
    const bar = Math.floor((t - t0) / barSec + 0.001);
    const pos = ((Math.round((t - t0) / step) % 16) + 16) % 16;
    const midi = Math.round(69 + 12 * Math.log2(f / 440));
    if (!bars.has(bar)) bars.set(bar, []);
    bars.get(bar).push(`${pos}:${midi}`);
  }
  // 端の小節は取りこぼしがあるので落とす
  const keys = [...bars.keys()].sort((a, b) => a - b).slice(1, -1);
  expect(keys.length).toBeGreaterThan(4);
  const sigs = keys.map(k => bars.get(k).sort().join(','));

  // 隣り合う小節が同じである組が多数を占めること。
  // オカズの小節とその次、和音が変わる小節では変わってよいので、そのぶんは見込む
  let same = 0;
  for (let i = 1; i < sigs.length; i++) if (sigs[i] === sigs[i - 1]) same++;
  expect(same / (sigs.length - 1)).toBeGreaterThan(0.6);
});

test('インダストリアル・ノイズの出現率がジャンルごとに決まっている', async ({ page }) => {
  test.setTimeout(120000);
  // two:D-38。シーンに入るたびに引き直すので、同じシーンを選び直せば何度でも引ける
  const label = async () => (await page.locator('#pchord').textContent()).trim();
  const rate = async (idx, tries) => {
    let on = 0;
    for (let k = 0; k < tries; k++) {
      await page.locator('.scenebtn').nth(idx).click();
      if ((await label()).includes(' noise ')) on++;
    }
    return on / tries;
  };
  // 標本が小さいので幅を広く取る。狙いは 0.6 / 0.2 / 0.3 / 0.2
  expect(await rate(0, 90)).toBeGreaterThan(0.42);    // 潜行 (stab)
  expect(await rate(4, 90)).toBeLessThan(0.4);        // 微睡 (jazz)
  expect(await rate(11, 90)).toBeLessThan(0.4);       // 曙 (sustain)
});

test('ノイズの周期は小節に乗らない', async ({ page }) => {
  test.setTimeout(90000);
  // 16分5〜15個、または8分5〜7個。どれも16の約数にならないのでポリリズムになる (two:D-38)
  const lens = [];
  let stereo = 0, single = 0;
  for (let k = 0; k < 80; k++) {
    await page.locator('.scenebtn').nth(0).click();   // 潜行。最も出やすい
    const m = (await page.locator('#pchord').textContent()).match(/noise ([\d/]+)/);
    if (!m) continue;
    const parts = m[1].split('/').map(Number);
    parts.length === 2 ? stereo++ : single++;
    lens.push(...parts);
  }
  expect(lens.length).toBeGreaterThan(20);
  expect(Math.min(...lens)).toBeGreaterThanOrEqual(5);
  expect(Math.max(...lens)).toBeLessThanOrEqual(15);
  // 16の約数だと小節にそのまま乗ってしまう
  expect(lens.filter(v => 16 % v === 0).length).toBe(0);
  // 7割は左右それぞれ独立、3割は片側だけ
  expect(stereo).toBeGreaterThan(single);
});

test('ベースが疎な小節にはフェーザーが掛かる', async ({ page }) => {
  test.setTimeout(60000);
  // two:D-39。潜行は8分より粗い格子なので、1小節あたり2音ほどにしかならない
  await page.locator('.scenebtn').nth(0).click();
  await page.locator('#play').click();

  const read = async () => {
    const m = (await page.locator('#pchord').textContent()).match(/bass (\d+)( \+phaser)?/);
    return m && { n: Number(m[1]), ph: !!m[2] };
  };
  await expect.poll(async () => (await read())?.n, { timeout: 15000 }).toBeGreaterThan(0);

  // 5未満の小節では必ず掛かっている
  for (let i = 0; i < 12; i++) {
    const r = await read();
    if (r && r.n > 0 && r.n < 5) expect(r.ph).toBe(true);
    await page.waitForTimeout(600);
  }
});

test('ベースが密な小節にはフェーザーが掛からない', async ({ page }) => {
  test.setTimeout(90000);
  // 疾走は16分の格子なので、5音以上になる小節が出る
  await page.locator('.scenebtn').nth(12).click();
  await page.locator('#s_bpm').fill('140');
  await page.locator('#play').click();

  const read = async () => {
    const m = (await page.locator('#pchord').textContent()).match(/bass (\d+)( \+phaser)?/);
    return m && { n: Number(m[1]), ph: !!m[2] };
  };
  let dense = null;
  for (let i = 0; i < 60 && !dense; i++) {
    const r = await read();
    if (r && r.n >= 5) dense = r;
    await page.waitForTimeout(500);
  }
  expect(dense).not.toBeNull();
  expect(dense.ph).toBe(false);
});

test('音程が動かない小節ではベースのフィルタが揺れる', async ({ page }) => {
  test.setTimeout(60000);
  // two:D-42。ベースはもともとルートを踏み続ける設計なので、たいていの小節が該当する
  await page.locator('.scenebtn').nth(0).click();   // 潜行
  await page.locator('#play').click();
  await expect(page.locator('#pchord')).toContainText('+wobble', { timeout: 15000 });
});

test('大きな再生ボタンで鳴りはじめ、鳴っている間は消える', async ({ page }) => {
  // Issue #1。スライダーの群より前面にあるので、そのまま押せる
  await expect(page.locator('#bigplay')).toBeVisible();
  await page.locator('#bigplay').click();

  await expect(page.locator('#play')).toHaveAttribute('data-on', '1');
  await expect(page.locator('#bigplay')).toBeHidden();
  await expect(page.locator('#readme')).toBeHidden();   // 案内も一緒に消える (two:D-72)

  // 止めればまた出る
  await page.locator('#pause').click();
  await expect(page.locator('#bigplay')).toBeVisible();
  await expect(page.locator('#readme')).toBeVisible();
});

test('ミックスの遷移中にシーンを選んでも進行が止まらない', async ({ page }) => {
  test.setTimeout(60000);
  // 遷移を打ち切ったあとも2本目の並びが残り、行き先の無いキットを引いて例外で止まっていた
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/index.html?transition=mix');
  await page.locator('.scenebtn').nth(12).click();   // 疾走 dash
  await page.locator('#s_bpm').fill('140');
  await page.locator('#play').click();
  await page.waitForTimeout(1500);
  await page.locator('#next').click();
  await expect(page.locator('#pphrase')).toContainText('(mix)', { timeout: 8000 });
  await page.waitForTimeout(2000);                   // 小節の途中で選ぶ
  await page.locator('.scenebtn').nth(13).click();   // 祝祭 jubilee
  const at = await sceneBar(page);
  await expect.poll(() => sceneBar(page), { timeout: 10000 }).toBeGreaterThan(at + 1);
  expect(errors).toEqual([]);
});

test('小節ループの間は小節が進まず、解除すると続きから進む', async ({ page }) => {
  test.setTimeout(60000);
  // two:D-56
  await page.locator('.scenebtn').nth(12).click();   // 疾走 dash。1小節が短い
  await page.locator('#s_bpm').fill('140');
  await page.locator('#play').click();
  await expect.poll(() => sceneBar(page), { timeout: 8000 }).toBeGreaterThan(1);

  await page.locator('#loop').click();
  await expect(page.locator('#loop')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#loop')).toHaveClass(/blink/);   // 有効な間は点滅する (two:D-63)
  await expect(page.locator('#pbarpos')).toContainText('loop');
  const held = await sceneBar(page);
  await page.waitForTimeout(5000);                   // 3小節ぶん以上
  expect(await sceneBar(page)).toBe(held);
  // ステップの点灯は回り続ける
  await expect(page.locator('#steps i.now')).toHaveCount(1);

  await page.locator('#loop').click();
  await expect(page.locator('#loop')).not.toHaveClass(/blink/);
  await expect.poll(() => sceneBar(page), { timeout: 8000 }).toBeGreaterThan(held);
});

test('乗り換え前の小節でシーン名が点滅してオカズが入り、next は乗り換わるまで点滅する', async ({ page }) => {
  test.setTimeout(90000);
  // two:D-62。?dub=0 で乗り換え前の小節をオカズに固定する。
  // 視差効果を減らす設定でも点滅は止めない (two:D-63)。その設定のまま確かめる
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/index.html?transition=break&dub=0');
  await page.locator('.scenebtn').nth(12).click();   // 疾走 dash。1小節が短い
  await page.locator('#s_bpm').fill('140');
  await page.locator('#play').click();
  await page.waitForTimeout(1500);
  const name = async () => (await page.locator('#scenename').textContent()).replace(' (edit)', '');
  const before = await name();

  await page.locator('#next').click();
  await expect(page.locator('#next')).toHaveClass(/blink/);
  expect(await page.locator('#next').evaluate(el => getComputedStyle(el).animationName)).toBe('blink');
  await expect(page.locator('#scenename')).not.toHaveClass(/blink/);

  // 乗り換え前の小節
  await expect(page.locator('#scenename')).toHaveClass(/blink/, { timeout: 15000 });
  await expect(page.locator('#pbarpos')).toContainText('fill');
  expect((await page.locator('#pphrase').textContent()).split('→')[0]).toContain('break');

  // 乗り換わったら点滅は止まる
  await expect.poll(name, { timeout: 15000, intervals: [200] }).not.toBe(before);
  await expect(page.locator('#scenename')).not.toHaveClass(/blink/);
  await expect(page.locator('#next')).not.toHaveClass(/blink/);
});

test('乗り換え前の小節でダブを引いたらブレイクにしない', async ({ page }) => {
  test.setTimeout(90000);
  // two:D-62。?dub で乗り換え前の小節をダブに固定する
  await page.goto('/index.html?transition=break&dub');
  await page.locator('.scenebtn').nth(12).click();
  await page.locator('#s_bpm').fill('140');
  await page.locator('#play').click();
  await page.waitForTimeout(1500);

  await page.locator('#next').click();
  await expect(page.locator('#scenename')).toHaveClass(/blink/, { timeout: 15000 });
  await expect(page.locator('#pbarpos')).toContainText('dub');
  expect((await page.locator('#pphrase').textContent()).split('→')[0]).not.toContain('break');
});

test('shift を上げると、8小節の節目で調が平行にずれる', async ({ page }) => {
  test.setTimeout(90000);
  // two:D-65。shift=1 なら節目ごとに必ず動く。0 からはかならず 0 以外へ動くので、最初の節目で表示に出る
  await page.locator('.scenebtn').nth(12).click();   // 疾走 dash。1小節が短い
  await page.locator('#s_glide').fill('3');
  await page.locator('#s_shift').fill('1');
  await page.locator('#s_bpm').fill('140');
  await page.locator('#play').click();
  await expect(page.locator('#pkey')).toHaveText(/ [+-]\d+$/, { timeout: 40000 });
});

test('lush を上げると、e.piano と strings の回路だけが開いた和声に切り替わる', async ({ page }) => {
  test.setTimeout(60000);
  // two:D-66。判定はシーンに入るときに、平滑化された値で行う。推移時間を詰めて値が届くのを待ってから選ぶ
  await page.locator('#s_glide').fill('3');
  await page.locator('#s_lush').fill('1');
  await page.waitForTimeout(6000);
  await page.locator('.scenebtn').nth(5).click();    // 硝子 glass (jazz)
  await expect(page.locator('#pchord')).toContainText('[e.piano lush');
  await page.locator('.scenebtn').nth(11).click();   // 曙 daybreak (sustain)
  await expect(page.locator('#pchord')).toContainText('[sustain lush');
  await page.locator('.scenebtn').nth(0).click();    // 潜行 submerge (stab) には効かない
  await expect(page.locator('#pchord')).not.toContainText('lush');
});

test('shift で調がずれても、開いた和声の進行は先へ進む', async ({ page }) => {
  test.setTimeout(90000);
  // two:D-65 / two:D-66。調がずれるたびに進行が頭へ巻き戻る不具合があった。
  // 開いた和声の strings の進行は、どれも2つ目か3つ目で和音の種類か分数コードが変わる。
  // 根音の名前は平行移動でも変わるので、それを除いた部分が2種類以上出ることを見る
  await page.locator('#s_glide').fill('3');
  await page.locator('#s_lush').fill('1');
  await page.locator('#s_shift').fill('1');
  await page.locator('#s_bpm').fill('140');
  await page.waitForTimeout(6000);
  await page.locator('.scenebtn').nth(11).click();   // 曙 daybreak (sustain)
  await page.locator('#play').click();
  const kinds = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 45000 && kinds.size < 2) {
    const chord = (await page.locator('#pchord').textContent()).trim().split(' ')[0];
    kinds.add(chord.replace(/^[A-G]#?/, ''));
    await page.waitForTimeout(500);
  }
  expect(kinds.size).toBeGreaterThanOrEqual(2);
});
