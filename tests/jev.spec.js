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

test('イベントは Jev の答えどおりに起きる', async ({ page }) => {
  test.setTimeout(60000);
  const seen = await fakeWorker(page, ({ kind, ask }) =>
    kind === 'phrase' ? { event: only(ask.event, 'kickdrop') } : {});
  await start(page);
  // 4小節の節目の2小節前に問い合わせ、節目で使う
  await expect(page.locator('#pevent')).toContainText('kick out', { timeout: 30000 });
  await expect(page.locator('#pjev')).toContainText('on');
  await expect(page.locator('#pjevd')).toContainText('event kickdrop 100%');
  // JEV セクション (D-15)。送った query (グレー)、返った result (白)、音楽的に何が起こるか (強調)
  const entry = page.locator('#jevlog .e').filter({ has: page.locator('.o', { hasText: 'event: kick out' }) }).first();
  await expect(entry).toBeVisible();
  await expect(entry.locator('.m').first()).toContainText(/bar \d+ · phrase · for bar \d+/);
  await expect(entry.locator('pre.q')).toContainText('"kind": "phrase"');
  await expect(entry.locator('pre.q')).toContainText('"state"');
  await expect(entry.locator('pre.q')).toContainText('"ask"');
  await expect(entry.locator('pre.r')).toContainText('"answers"');
  await expect(entry.locator('pre.r')).toContainText('"kickdrop":1');
  // 色で読み分けられる。query はグレー、result は白、何が起こるかは強調
  const colors = await entry.evaluate(e => ['pre.q', 'pre.r', '.o'].map(s => getComputedStyle(e.querySelector(s)).color));
  expect(colors[1]).toBe('rgb(255, 255, 255)');
  expect(new Set(colors).size).toBe(3);
  const req = seen.find(b => b.kind === 'phrase');
  // 質問文は送らない。選択肢と state だけ
  expect(Object.keys(req.ask.event)).toContain('none');
  expect(req.state.scene.id).toBeTruthy();
  expect(req.state.history).toBeTruthy();
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
  expect(b1.scroll[0]).toBeLessThanOrEqual(b1.scroll[1]);
  const overflow = await page.locator('#jevlog').evaluate(e => e.scrollHeight > e.clientHeight);
  expect(overflow).toBe(true);
});
