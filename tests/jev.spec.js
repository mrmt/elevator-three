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
  await expect(page.locator('#s_jev')).toHaveValue('0.8');
  await expect(page.locator('#pjev')).toBeVisible();
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
  await expect.poll(() => played.length, { timeout: 30000 }).toBeGreaterThan(0);
  expect(want).not.toBeNull();
  expect(played).toContain(want);
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

test('?jev=0 では問い合わせない', async ({ page }) => {
  test.setTimeout(30000);
  const seen = await fakeWorker(page, () => ({}));
  await start(page, '?jev=0');
  await page.waitForTimeout(10000);
  expect(seen.length).toBe(0);
  await expect(page.locator('#pjev')).toHaveText('off');
});
