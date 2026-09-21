// Jev の判断の差し込み (D-4〜D-8)。中継の Worker (手元では localhost:8787) の応答を差し替えて、
// 答えどおりに鳴らすこと、遅れた答えを捨てること、繋がらなくても止まらないことを見る
import { test, expect } from '@playwright/test';

const DECIDE = 'http://localhost:8787/decide';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/* Worker の代わり。answer(req) は {kind, state, ask} を受けて answers を返す。
   delay を渡すと、その ms だけ待ってから返す。受けた要求は配列に積む */
async function fakeWorker(page, answer, { delay = 0, fail = false } = {}) {
  const seen = [];
  await page.route(DECIDE, async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = JSON.parse(req.postData());
    seen.push(body);
    if (fail) return route.abort('connectionrefused');
    if (delay) await new Promise(r => setTimeout(r, delay));
    await route.fulfill({ status: 200, headers: CORS, contentType: 'application/json',
                          body: JSON.stringify({ answers: answer(body), ms: 1 }) });
  });
  return seen;
}
// 選択肢のうち1つに確率を寄せる
const only = (opts, key) => ({ probs: Object.fromEntries(Object.keys(opts).map(k => [k, k === key ? 1 : 0])), confidence: 0.9 });

// Jev に全部任せる (スライダーを 1 に)。BPM を上げて待ちを詰める
async function start(page, query = '') {
  await page.goto('/index.html' + query);
  await page.locator('#s_jev').fill('1');
  await page.locator('#s_bpm').fill('140');
  await page.locator('#play').click();
}

test('jev のスライダーと monitor の表示がある', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#s_jev')).toBeVisible();
  await expect(page.locator('#s_jev')).toHaveValue('1');
  await expect(page.locator('#pjev')).toBeVisible();
  // 雰囲気の操作ではないので (edit) を付けない。付くと陰陽が波に従わなくなる
  await page.locator('#s_jev').fill('0.5');
  await expect(page.locator('#scenename')).not.toContainText('(edit)');
});

test('temperature のスライダーがあり、動かしても (edit) を付けない (D-18)', async ({ page }) => {
  await page.goto('/index.html');
  const s = page.locator('#s_temp');
  await expect(s).toBeVisible();
  await expect(s).toHaveValue('1');
  await expect(s).toHaveAttribute('max', '2');
  // 判断の任せ方なので (edit) を付けない
  await s.fill('0.5');
  await expect(page.locator('#scenename')).not.toContainText('(edit)');
});

test('temperature 0 では Jev のいちばん確率の高い答えだけを取る (D-18)', async ({ page }) => {
  test.setTimeout(60000);
  await fakeWorker(page, ({ kind, ask }) => {
    if (kind !== 'phrase') return {};
    const probs = Object.fromEntries(Object.keys(ask.event).map(k => [k, 0]));
    probs.kickdrop = .6; probs.sweep = .4;
    return { event: { probs, confidence: .2 }, ...(ask.dub ? { dub: { p: .45, confidence: null } } : {}) };
  });
  await start(page);
  await page.locator('#s_temp').fill('0');
  const out = t => page.locator('#declog .d', { hasText: t });
  await expect(out('event: kick out').first()).toBeVisible({ timeout: 40000 });
  await expect.poll(() => out('event: kick out').count(), { timeout: 40000 }).toBeGreaterThanOrEqual(3);
  await expect(out('event: filter sweep')).toHaveCount(0);
  // 真偽の問いも 0.5 未満なら起こさない
  await expect(out('no dub (p=0%)').first()).toBeVisible({ timeout: 40000 });
  await expect(out(/^dub at bar/)).toHaveCount(0);
});

test('イベントは Jev の答えどおりに起きる', async ({ page }) => {
  test.setTimeout(60000);
  const seen = await fakeWorker(page, ({ kind, ask }) =>
    kind === 'phrase' ? { event: only(ask.event, 'kickdrop') } : {});
  await start(page);
  // 4小節の節目の2小節前に問い合わせ、節目で使う
  await expect(page.locator('#pevent')).toContainText('kick out', { timeout: 30000 });
  await expect(page.locator('#pjev')).toContainText('on');
  await expect(page.locator('#pjevd')).toContainText('event kickdrop 100%');
  // JEV セクション (D-15)。送った query (グレー) と返った result (白)
  const entry = page.locator('#jevlog .e').filter({ has: page.locator('pre.r', { hasText: '"kickdrop":1' }) }).first();
  await expect(entry).toBeVisible();
  await expect(entry.locator('.m').first()).toContainText(/bar \d+ · phrase · for bar \d+/);
  await expect(entry.locator('pre.q')).toContainText('"kind": "phrase"');
  await expect(entry.locator('pre.q')).toContainText('"state"');
  await expect(entry.locator('pre.q')).toContainText('"ask"');
  await expect(entry.locator('pre.r')).toContainText('"answers"');
  // 音楽的に何が起こるかは JEV の件ではなく、下の DECISION に出す (D-19)
  await expect(entry.locator('.o', { hasText: 'event: kick out' })).toHaveCount(0);
  const dec = page.locator('#declog .d', { hasText: 'event: kick out' }).first();
  await expect(dec).toBeVisible();
  await expect(dec).toHaveAttribute('title', /^bar \d+ · phrase · event: kick out/);
  // 読み分けられる。query はグレー、result は白 (D-16)。DECISION のいちばん新しい件は太字と帯で強調する
  const [q, r] = await entry.evaluate(e => ['pre.q', 'pre.r'].map(s => getComputedStyle(e.querySelector(s)).color));
  expect(r).toBe('rgb(255, 255, 255)');
  expect(q).not.toBe(r);
  const top = await page.locator('#declog .d').first().evaluate(e => {
    const c = getComputedStyle(e);
    return { bg: c.backgroundColor, weight: c.fontWeight };
  });
  expect(top.bg).toBe('rgb(49, 49, 120)');   // --hot の帯
  expect(Number(top.weight)).toBeGreaterThanOrEqual(700);
  const req = seen.find(b => b.kind === 'phrase');
  // 質問文は送らない。選択肢と state だけ
  expect(Object.keys(req.ask.event)).toContain('none');
  expect(req.state.scene.id).toBeTruthy();
  expect(typeof req.state.story).toBe('string');
  expect(JSON.stringify(req)).not.toContain('instructions');
});

test('シーンの行き先・方式・キーは Jev の答えどおりになる', async ({ page }) => {
  test.setTimeout(90000);
  let want = null, wantKey = null;
  await fakeWorker(page, ({ kind, ask }) => {
    if (kind === 'scene') {
      const ids = Object.keys(ask.next);
      want = ids[ids.length - 1];   // 手元ならいちばん選ばれにくい、波から遠い候補
      return { next: only(ask.next, want), mode: only(ask.mode, 'break'), length: only(ask.length, 'medium') };
    }
    if (kind === 'harmony' && ask.key) {
      const keys = Object.keys(ask.key);
      wantKey = keys[keys.length - 1];
      return { key: only(ask.key, wantKey), prog: only(ask.prog, 'p0') };
    }
    return {};
  });
  await start(page, '?scenebars=16');
  // 平行移動の転調を切る。乗り換えた小節でも調がずれうるため
  await page.locator('#s_shift').fill('0');
  const first = await page.locator('#scenename').textContent();
  // 8小節めで遷移を始め、16小節めで乗り換える
  await expect(page.locator('#pphrase')).toContainText('(break)', { timeout: 30000 });
  expect(want).not.toBeNull();
  // 乗り換えたあとの問い合わせで want が書き換わるので、ここで押さえる
  const scene = want, key = wantKey;
  await expect(page.locator('#pphrase')).toContainText(`→ ${scene} (break)`);
  await expect(page.locator('#scenename')).not.toHaveText(first, { timeout: 30000 });
  await expect(page.locator('#scenename')).toContainText(scene);
  expect(key).not.toBeNull();
  await expect(page.locator('#pkey')).toContainText(new RegExp(`^${key.replace('#', '\\#')} `));
});

test('リフは Jev が選んだ候補の旋律で鳴る', async ({ page }) => {
  test.setTimeout(60000);
  let want = null;
  await fakeWorker(page, ({ kind, ask }) => {
    if (kind !== 'riff') return {};
    const ks = Object.keys(ask.riff);
    const k = ks[ks.length - 1];
    want = ask.riff[k].replace(/ \(.*\)$/, '');   // 「C6 E6 G6 (quarter rhythm)」の音名だけ
    return { riff: only(ask.riff, k) };
  });
  const played = [];
  page.on('console', m => { const t = m.text(); if (t.startsWith('[jev] riff played')) played.push(t.slice(18)); });
  // 覚えた形の使い回しを切り、毎回新しく引かせる
  await start(page, '?spark&sparkmotif=0&jevlog');
  /* Jev が選んだ旋律が鳴るまで待つ。jev スライダーは 1 へ滑らかに寄る途中なので、
     最初のリフは手元で選ばれることがある (その回は Jev に問い合わせない) */
  await expect.poll(() => want !== null && played.includes(want), { timeout: 30000 }).toBe(true);
  // ログには選んだ候補の旋律まで出す
  await expect(page.locator('#jevlog')).toContainText(want);
});

test('行き先のシーンの音色は Jev の答えどおりになる (D-17)', async ({ page }) => {
  test.setTimeout(90000);
  const yes = { p: 1, confidence: 0.9 };
  const seen = await fakeWorker(page, ({ kind, ask }) => {
    if (kind === 'scene') return { mode: only(ask.mode, 'break') };
    if (kind === 'harmony' && ask.prog) return { tight: yes, noise: yes, ...(ask.chop ? { chop: yes } : {}) };
    return {};
  });
  await start(page, '?scenebars=16');
  const first = await page.locator('#scenename').textContent();
  await expect(page.locator('#scenename')).not.toHaveText(first, { timeout: 40000 });
  const req = seen.find(b => b.kind === 'harmony' && b.ask.prog);
  expect(req.ask.tight).toBe(true);
  expect(req.ask.noise).toBe(true);
  await expect(page.locator('#pchord')).toContainText('noise');
  await expect(page.locator('#declog .d', { hasText: 'bass: tight (p=100%)' }).first()).toBeVisible();
  await expect(page.locator('#declog .d', { hasText: 'industrial noise on (p=100%)' }).first()).toBeVisible();
});

test('リードの音色・キックの変形・並びの変異は Jev の答えどおりになる (D-17)', async ({ page }) => {
  test.setTimeout(90000);
  const seen = await fakeWorker(page, ({ kind, ask }) => kind !== 'phrase' ? {} : {
    lead: only(ask.lead, 'square'),
    mutate: { p: 1, confidence: 0.9 },
    ...(ask.kick ? { kick: only(ask.kick, 'push') } : {}),
  });
  await start(page);
  const out = t => page.locator('#declog .d', { hasText: t }).first();
  await expect(out('lead timbre: square')).toBeVisible({ timeout: 40000 });
  await expect(out(/pattern mutates at bar \d+/)).toBeVisible({ timeout: 40000 });
  await expect(out('kick bends (push)')).toBeVisible({ timeout: 40000 });
  // キックの変形は8小節の終わりに使うので、その3小節前の節目の回だけ聞く
  for (const b of seen.filter(b => b.kind === 'phrase' && b.ask.kick)) expect((b.state.bar + 2) % 8).toBe(4);
  // Jev が square 以外を選ぶことはない
  await expect(page.locator('#declog .d', { hasText: /lead timbre: (sawtooth|triangle|pulse)/ })).toHaveCount(0);
});

test('平行移動の幅とペダルは Jev の答えどおりになる (D-17)', async ({ page }) => {
  test.setTimeout(90000);
  const seen = await fakeWorker(page, ({ kind, ask }) => kind === 'harmony' && ask.shift
    ? { shift: { p: 1, confidence: 0.9 }, step: only(ask.step, '+5'), pedal: { p: 1, confidence: 0.9 } } : {});
  await start(page);
  await page.locator('#s_shift').fill('1');
  const out = t => page.locator('#declog .d', { hasText: t }).first();
  await expect(out('key shifts up a fourth')).toBeVisible({ timeout: 60000 });
  await expect(out(/bass holds a pedal at bar \d+/)).toBeVisible({ timeout: 60000 });
  const req = seen.find(b => b.kind === 'harmony' && b.ask.shift);
  expect(req.ask.pedal).toBe(true);
  expect(Object.keys(req.ask.step)).toContain('+5');
});

test('遅れて届いた答えは捨て、手元の判断で進む', async ({ page }) => {
  test.setTimeout(60000);
  // 4小節の節目より遅く返す。使われれば kick out が出るはず
  await fakeWorker(page, ({ kind, ask }) =>
    kind === 'phrase' ? { event: only(ask.event, 'kickdrop') } : {}, { delay: 9000 });
  await start(page, '?jevlog');
  const logs = [];
  page.on('console', m => { if (m.text().startsWith('[jev]')) logs.push(m.text()); });
  await expect.poll(() => logs.some(t => t.includes('late') || t.includes('failed')), { timeout: 30000 }).toBe(true);
  await expect(page.locator('#pjevd')).not.toContainText('event kickdrop');
  await expect(page.locator('#pjevd')).toContainText(/[1-9]\d* local/);
});

test('Worker に繋がらなくても進行は止まらない', async ({ page }) => {
  test.setTimeout(60000);
  const seen = await fakeWorker(page, () => ({}), { fail: true });
  await start(page);
  await expect(page.locator('#pjev')).toContainText('offline', { timeout: 20000 });
  await expect(page.locator('#jevlog')).toContainText('✕');
  const bar = async () => parseInt(await page.locator('#rbar').textContent(), 10);
  const b0 = await bar();
  await page.waitForTimeout(5000);
  expect(await bar()).toBeGreaterThan(b0);
  // 3回続けて失敗したら、32小節は問い合わせない
  await expect.poll(() => seen.length, { timeout: 40000 }).toBeGreaterThanOrEqual(3);
  const n = seen.length;
  await page.waitForTimeout(8000);
  expect(seen.length).toBe(n);
});

test('jev スライダーを 0 にすると問い合わせが止まる', async ({ page }) => {
  test.setTimeout(40000);
  const seen = await fakeWorker(page, () => ({}));
  await start(page);
  await expect.poll(() => seen.length, { timeout: 15000 }).toBeGreaterThan(0);
  await page.locator('#s_jev').fill('0');
  await expect(page.locator('#pjev')).toHaveText('off');
  // 滑らかに寄せる値は 0 にならないので、目標値で止めていないとここで送り続ける
  await page.waitForTimeout(1000);
  const n = seen.length;
  await page.waitForTimeout(10000);
  expect(seen.length).toBe(n);
});

test('?jev=0 では問い合わせない', async ({ page }) => {
  test.setTimeout(30000);
  const seen = await fakeWorker(page, () => ({}));
  await start(page, '?jev=0');
  await page.waitForTimeout(10000);
  expect(seen.length).toBe(0);
  await expect(page.locator('#pjev')).toHaveText('off');
  await expect(page.locator('#jevlog')).toHaveText('jev off — nothing is asked');
});

test('Jev とのやり取りが増えても、mixer と JEV の位置と大きさは変わらない', async ({ page }) => {
  // D-14 / D-15。以前は monitor の下にログを積んでいて、やり取りのたびに mixer が押し下げられた
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = await fakeWorker(page, ({ kind, ask }) =>
    kind === 'phrase' ? { event: only(ask.event, 'sweep') } : {});
  await start(page, '?spark&sparkmotif=0');
  const box = async () => ({
    mixer: await page.locator('#grp-mixer').boundingBox(),
    jev: await page.locator('#jev').boundingBox(),
    decision: await page.locator('#decision').boundingBox(),
    scroll: await page.evaluate(() => [document.documentElement.scrollHeight, innerHeight]),
  });
  await expect.poll(() => seen.length, { timeout: 15000 }).toBeGreaterThan(1);
  const b0 = await box();
  /* 欄からあふれるのに十分な件数まで待つ。実時間で鳴らすので、並列で走らせると問い合わせの間隔が伸びる。
     21件を待つと負荷しだいで上限に届かないので、13件で見る (件数の上限 20 は下で確かめる) */
  await expect.poll(() => seen.length, { timeout: 80000 }).toBeGreaterThan(12);
  const n = await page.locator('#jevlog .e').count();
  expect(n).toBeGreaterThan(12);
  expect(n).toBeLessThanOrEqual(20);
  const b1 = await box();
  expect(b1.mixer).toEqual(b0.mixer);
  expect(b1.jev).toEqual(b0.jev);
  expect(b1.decision).toEqual(b0.decision);
  expect(b1.scroll[0]).toBeLessThanOrEqual(b1.scroll[1]);
  const overflow = await page.locator('#jevlog').evaluate(e => e.scrollHeight > e.clientHeight);
  expect(overflow).toBe(true);
});

test('DECISION は JEV の下にあり、3行の高さでスクロールせずに見える (D-19)', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await fakeWorker(page, ({ kind, ask }) => kind !== 'phrase' ? {} : {
    event: only(ask.event, 'sweep'), lead: only(ask.lead, 'square'),
  });
  await start(page);
  const d = page.locator('#declog .d');
  await expect.poll(() => d.count(), { timeout: 60000 }).toBeGreaterThan(4);
  const g = await page.evaluate(() => {
    const box = id => document.getElementById(id).getBoundingClientRect();
    const log = document.getElementById('declog');
    const lh = parseFloat(getComputedStyle(log).lineHeight);
    const rows = [...log.children].map(e => e.getBoundingClientRect().height);
    return { jev: box('jev'), dec: box('decision'), log: box('declog'), lh, rows,
             scroll: log.scrollHeight > log.clientHeight, vh: innerHeight };
  });
  // JEV の真下にあり、画面の中に収まる
  expect(g.dec.top).toBeGreaterThanOrEqual(g.jev.bottom - 1);
  expect(g.dec.bottom).toBeLessThanOrEqual(g.vh);
  // 高さは3行ぶん。1件は1行に切る。あふれたぶんは中でスクロールする
  expect(g.log.height).toBeCloseTo(g.lh * 3, 0);
  for (const h of g.rows) expect(h).toBeCloseTo(g.lh, 0);
  expect(g.scroll).toBe(true);
  // 新しい順。いちばん上が最新
  await expect(d.first()).toHaveAttribute('title', /^bar \d+/);
  const bars = await d.evaluateAll(es => es.map(e => parseInt(e.title.slice(4), 10)));
  expect(bars).toEqual([...bars].sort((a, b) => b - a));
});

test('履歴は英文にして渡し、長く鳴らしても伸びない (D-21)', async ({ page }) => {
  test.setTimeout(120000);
  const seen = await fakeWorker(page, () => ({}));
  await start(page);
  // 出来事がひととおり積まれるまで鳴らす
  await expect.poll(() => (seen.length ? seen[seen.length - 1].state.bar : 0), { timeout: 90000 }).toBeGreaterThan(40);
  for (const b of seen) {
    const st = b.state;
    // 生の配列は渡さない。1本の英文だけ
    expect(st.history).toBeUndefined();
    expect(typeof st.story).toBe('string');
    expect(st.story).toMatch(/^\d+ min in, \d+ bars\./);
    expect(st.story).toMatch(/scenes? so far/);
    expect(st.story).toMatch(/riff/);
    // 絶対の小節番号ではなく「何小節前か」で語る
    expect(st.story).not.toMatch(/\bat bar \d+/);
    // 節の数は決まっているので、鳴らし続けても長さが伸びない
    expect(st.story.length).toBeLessThan(900);
  }
  // 出来事が積まれても、最初の頃と終わりで桁は変わらない
  const first = seen[0].state.story.length, last = seen[seen.length - 1].state.story.length;
  expect(last).toBeLessThan(first + 500);
  // 1文になったので JEV セクションにも出す (D-16 で隠していた history を置き換えた)
  await expect(page.locator('#jevlog pre.q').first()).toContainText('"story"');
  await expect(page.locator('#jevlog pre.q').first()).toContainText('min in,');
});
