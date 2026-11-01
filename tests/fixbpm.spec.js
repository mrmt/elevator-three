// fix BPM (D-23)。立てるとシーンに関わらず BPM スライダーの値で鳴り、外すとシーンの bpm に戻る。
import { test, expect } from '@playwright/test';

const bpm = async page => parseInt(await page.locator('#rbpm').textContent(), 10);
const scene = (page, id) => page.locator('#scenes .scenebtn', { hasText: new RegExp(`^${id}$`) });

// ms のあいだ BPM の表示を見張り、出た値をすべて返す
async function watchBpm(page, ms) {
  const seen = new Set();
  for (let t = 0; t < ms; t += 250) {
    seen.add(await bpm(page));
    await page.waitForTimeout(250);
  }
  return [...seen];
}

test('fix BPM はトグルで、押すたびに状態が入れ替わる', async ({ page }) => {
  await page.goto('/index.html');
  const b = page.locator('#fixbpm');
  await expect(b).toBeVisible();
  await expect(b).toHaveText('fix BPM');
  await expect(b).toHaveAttribute('aria-pressed', 'false');
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'false');
});

test('立てると、シーンが変わっても BPM スライダーの値で鳴り続ける', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/index.html');
  // 113 はどのシーンの bpm にも当たらない (シーンの bpm がそのまま出るのは 125 のときだけ)
  await page.locator('#s_bpm').fill('113');
  await page.locator('#fixbpm').click();
  await scene(page, 'dash').click();   // 132 BPM のシーン
  await page.locator('#play').click();
  await expect(page.locator('#rbpm')).toHaveText('113');
  expect(await watchBpm(page, 3000)).toEqual([113]);

  // 手で乗り換えても、遅いシーン (118) でも変わらない
  await scene(page, 'submerge').click();
  await expect(page.locator('#scenename')).toContainText('submerge');
  expect(await watchBpm(page, 3000)).toEqual([113]);

  // next のブレイク遷移 (4小節) を抜けて次のシーンに入るまで見張る
  const before = await page.locator('#scenename').textContent();
  await page.locator('#next').click();
  expect(await watchBpm(page, 12000)).toEqual([113]);
  await expect(page.locator('#scenename')).not.toHaveText(before);
});

test('外すと、シーンの bpm (+ スライダーのずれ) へ寄っていく', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#s_bpm').fill('113');
  await page.locator('#fixbpm').click();
  await scene(page, 'dash').click();   // 132 - 12 = 120 が戻り先
  await page.locator('#play').click();
  await expect(page.locator('#rbpm')).toHaveText('113');
  await page.locator('#fixbpm').click();
  // 拍が飛ばないよう、テンポは数秒かけて寄る
  await expect.poll(() => bpm(page), { timeout: 15000 }).toBeGreaterThanOrEqual(118);
  expect(await bpm(page)).toBeLessThanOrEqual(120);
});

test('立てている間、Jev に見せるシーンの候補から BPM を外す', async ({ page }) => {
  test.setTimeout(60000);
  const asks = [];
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
                 'Access-Control-Allow-Headers': 'Content-Type' };
  await page.route('http://localhost:8787/decide', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = JSON.parse(req.postData());
    if (body.kind === 'scene') asks.push(body.ask.next);
    await route.fulfill({ status: 200, headers: CORS, contentType: 'application/json',
                          body: JSON.stringify({ answers: {}, ms: 1 }) });
  });
  await page.goto('/index.html?scenebars=16');
  await page.locator('#s_jev').fill('1');
  await page.locator('#s_bpm').fill('140');
  await page.locator('#fixbpm').click();
  await page.locator('#play').click();
  await expect.poll(() => asks.length, { timeout: 30000 }).toBeGreaterThan(0);
  const opts = Object.values(asks[0]);
  expect(opts.length).toBeGreaterThan(0);
  for (const o of opts) {
    expect(o).not.toContain('BPM');
    expect(o).toContain('kit, dark-bright');
  }
});
