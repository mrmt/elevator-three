// レイアウトと操作。広い画面では2カラム、狭い画面ではタブで1セクションずつ。
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
});

test('ページ自体は横にも縦にもスクロールしない', async ({ page }) => {
  const over = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));
  expect(over.x).toBeLessThanOrEqual(1);
  expect(over.y).toBeLessThanOrEqual(1);
});

test('陰陽のスライダーは手で動かすと波に戻されない', async ({ page, isMobile }) => {
  // two:D-54 / two:D-13。触ったら (edit) が付き、目標は手で置いた値のまま保たれる
  if (isMobile) await page.locator('.tab[data-tab="param"]').click();
  const before = parseFloat(await page.locator('#s_yy').inputValue());
  const v = before < 0.5 ? '0.9' : '0.1';
  await page.locator('#s_yy').fill(v);
  await expect(page.locator('#scenename')).toContainText('(edit)');
  await page.waitForTimeout(1500);
  await expect(page.locator('#s_yy')).toHaveValue(v);
});

test('狭い画面ではタブで切り替わる', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'デスクトップ幅ではタブを出さない');
  await expect(page.locator('#tabs')).toBeVisible();
  // scene / param / monitor の3つ (D-14)
  await expect(page.locator('.tab')).toHaveCount(3);
  await page.locator('.tab[data-tab="scene"]').click();
  await expect(page.locator('#tab-scene')).toBeVisible();
  await expect(page.locator('#tab-mix')).toBeHidden();
  await expect(page.locator('#tab-mon')).toBeHidden();
  await page.locator('.tab[data-tab="param"]').click();
  await expect(page.locator('#tab-mix')).toBeVisible();
  await expect(page.locator('#tab-mon')).toBeHidden();
  await page.locator('.tab[data-tab="monitor"]').click();
  await expect(page.locator('#tab-mon')).toBeVisible();
  await expect(page.locator('#monitor')).toBeVisible();
  await expect(page.locator('#jev')).toBeVisible();
  await expect(page.locator('#tab-mix')).toBeHidden();
});

test('広い画面では3カラムが同時に見える', async ({ page, isMobile }) => {
  // D-14。左 scene、中央 control と mixer、右 monitor と JEV
  test.skip(isMobile, '狭幅ではタブ表示になる');
  await expect(page.locator('#tabs')).toBeHidden();
  const cols = [];
  for (const id of ['tab-scene', 'tab-mix', 'tab-mon']) {
    await expect(page.locator('#' + id)).toBeVisible();
    cols.push(await page.locator('#' + id).boundingBox());
  }
  expect(cols[1].x).toBeGreaterThan(cols[0].x);
  expect(cols[2].x).toBeGreaterThan(cols[1].x);
  // 右カラム (音作り) は廃止した (two:D-54)
  await expect(page.locator('#tab-sound')).toHaveCount(0);
});

test('ヘッダーが折り返さない', async ({ page, isMobile }) => {
  /* 起動時のシーンはランダムなので、一番長い名前 (submerge) を選び、スライダーを触って (edit) まで付けた
     最悪の状態で見る。短い名前のときだけ1行に収まる、という崩れを CI で踏んだ (two:D-69) */
  if (isMobile) await page.locator('.tab[data-tab="scene"]').click();
  await page.locator('.scenebtn').nth(0).click();   // 潜行 submerge
  if (isMobile) await page.locator('.tab[data-tab="param"]').click();
  await page.locator('#s_drive').fill('0.9');
  await expect(page.locator('#scenename')).toContainText('(edit)');
  // シーン名は、はみ出すぶんを省略しても再生ボタンに食い込まない
  const scene = await page.locator('#scenename').boundingBox();
  const playBox = await page.locator('#play').boundingBox();
  expect(scene.x + scene.width).toBeLessThanOrEqual(playBox.x);
  // シーン名が読める幅を残す。about を足したとき、狭い画面で 7px (1文字も読めない) まで削られた (two:D-71)
  expect(scene.width).toBeGreaterThanOrEqual(80);
  const h = await page.locator('header').evaluate(el => el.getBoundingClientRect().height);
  expect(h).toBeLessThan(90);
  // 高さだけでは2行に落ちても通ってしまう (two:D-69 でアイコンを足したとき、狭い画面で再生ボタンが2行目に落ちた)。
  // 再生ボタンがタイトルと同じ行にあることを、縦の中心で見る
  const mark = await page.locator('header .mark').boundingBox();
  const play = await page.locator('#play').boundingBox();
  expect(Math.abs((play.y + play.height / 2) - (mark.y + mark.height / 2))).toBeLessThan(12);
});

test('シーンは14種すべて並ぶ', async ({ page, isMobile }) => {
  if (isMobile) await page.locator('.tab[data-tab="scene"]').click();
  await expect(page.locator('.scenebtn')).toHaveCount(14);
  await expect(page.locator('#scenes .group')).toHaveCount(4);
});

test('見た目は EK 固定で、切り替えは無い', async ({ page }) => {
  // two:D-37。テーマの切り替えは廃止した (2026-09-12)
  await expect(page.locator('.themebtn')).toHaveCount(0);
  expect(await page.getAttribute('html', 'data-theme')).toBeNull();
  // 紫の5色 (D-13)。地は #3100a2
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(49, 0, 162)');
});

test('UI は英語だけで、言語の切り替えは無い', async ({ page }) => {
  // two:D-55。表示もツールチップも英語に統一し、i18n の仕組みは廃止した
  await expect(page.locator('#lang')).toHaveCount(0);
  expect(await page.getAttribute('html', 'lang')).toBe('en');
  const text = await page.evaluate(() => [
    document.title,
    document.body.innerText,
    ...[...document.querySelectorAll('[data-tip]')].map(el => el.dataset.tip),
    ...[...document.querySelectorAll('[aria-label]')].map(el => el.getAttribute('aria-label')),
  ].join('\n'));
  expect(text).not.toMatch(/[\u3040-\u30ff\u3400-\u9fff]/);
});

test('個別の音量はリロードしても保たれる', async ({ page, isMobile }) => {
  // two:D-54。値はこのブラウザに保存する
  if (isMobile) await page.locator('.tab[data-tab="param"]').click();
  await expect(page.locator('#s_mix_kick')).toHaveValue('1');
  await page.locator('#s_mix_kick').fill('0.4');
  await page.locator('#s_mix_bellRatio').fill('1.5');
  await expect(page.locator('#v_mix_kick')).toHaveText('40%');

  await page.reload();
  await expect(page.locator('#s_mix_kick')).toHaveValue('0.4');
  await expect(page.locator('#s_mix_bellRatio')).toHaveValue('1.5');
  await expect(page.locator('#v_mix_bellRatio')).toHaveText('×1.50');
});

test('大きな再生ボタンと READ ME FIRST が画面の中央に出る', async ({ page }) => {
  // Issue #1 / two:D-72。右上の小さなボタンだけでは、まず押さないと鳴らないことに気づけない。
  // 卓の中ではなく画面全体の左右中央に、大きく出す。その下に about ページへの案内
  const btn = page.locator('#bigplay');
  const readme = page.locator('#readme');
  await expect(btn).toBeVisible();
  await expect(readme).toBeVisible();
  await expect(readme).toHaveText('READ ME FIRST');
  await expect(readme).toHaveAttribute('href', 'about.html');
  // 遷移すると演奏が止まるので、別のタブで開く
  await expect(readme).toHaveAttribute('target', '_blank');

  const vw = await page.evaluate(() => document.documentElement.clientWidth);
  const b = await btn.boundingBox();
  const r = await readme.boundingBox();
  expect(Math.abs((b.x + b.width / 2) - vw / 2)).toBeLessThan(2);
  expect(Math.abs((r.x + r.width / 2) - vw / 2)).toBeLessThan(2);
  // ボタンの下にある
  expect(r.y).toBeGreaterThan(b.y + b.height);
  // 以前 (最大 104px) より大きい。指でも押せる
  expect(b.width).toBeGreaterThan(90);
});

test('卓は control / mixer、右カラムは monitor / jev', async ({ page, isMobile }) => {
  // two:D-57 / two:D-61 / D-14
  if (isMobile) await page.locator('.tab[data-tab="param"]').click();
  await expect(page.locator('#mixer .mixgrp > .mixhead > span:first-child'))
    .toHaveText(['control', 'mixer']);
  await expect(page.locator('#tab-mon .mixgrp > .mixhead > span:first-child'))
    .toHaveText(['monitor', 'jev']);
  await expect(page.locator('#s_mix_strings')).toHaveCount(1);
  await expect(page.locator('#s_mix_sustain')).toHaveCount(0);
});

test('reset all で既定値に戻り、保存も消える', async ({ page, isMobile }) => {
  // two:D-57
  if (isMobile) await page.locator('.tab[data-tab="param"]').click();
  await page.locator('#s_mix_kick').fill('0.3');
  await page.locator('#s_weight').fill('0.9');
  await page.locator('#s_volume').fill('20');
  await expect(page.locator('#scenename')).toContainText('(edit)');

  await page.locator('#reset').click();
  await expect(page.locator('#s_mix_kick')).toHaveValue('1');
  await expect(page.locator('#s_weight')).toHaveValue('0.1');
  await expect(page.locator('#s_volume')).toHaveValue('80');
  await expect(page.locator('#scenename')).not.toContainText('(edit)');

  await page.reload();
  await expect(page.locator('#s_mix_kick')).toHaveValue('1');
});

test('mixer の音量には SOLO と MUTE がある', async ({ page, isMobile }) => {
  // two:D-59。倍率の bell FM ratio には付けない
  if (isMobile) await page.locator('.tab[data-tab="param"]').click();
  await expect(page.locator('#mixer .smbtn.solo')).toHaveCount(20);
  await expect(page.locator('#mixer .smbtn.mute')).toHaveCount(20);
  await expect(page.locator('#solo_bellRatio')).toHaveCount(0);

  const row = key => page.locator('.param', { has: page.locator(`#s_mix_${key}`) });
  await page.locator('#solo_kick').click();
  await expect(page.locator('#solo_kick')).toHaveAttribute('aria-pressed', 'true');
  await expect(row('kick')).not.toHaveClass(/silenced/);
  await expect(row('snare')).toHaveClass(/silenced/);

  // MUTE は SOLO より強い
  await page.locator('#mute_kick').click();
  await expect(row('kick')).toHaveClass(/silenced/);

  // reset all で解除される
  await page.locator('#reset').click();
  await expect(page.locator('#solo_kick')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#mute_kick')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#mixer .param.silenced')).toHaveCount(0);
});

test('YouTube と大きな読み出しは無く、進行の表示は monitor にある', async ({ page, isMobile }) => {
  // two:D-60 / two:D-61
  if (isMobile) await page.locator('.tab[data-tab="monitor"]').click();
  for (const id of ['bg', 'bgvideo', 'ytkey', 'vcap', 'ryy', 'rd']) {
    await expect(page.locator('#' + id)).toHaveCount(0);
  }
  for (const id of ['rbpm', 'rbar', 'cv', 'steps', 'pphrase', 'pevent', 'pwave', 'pchord']) {
    await expect(page.locator(`#monitor #${id}`)).toHaveCount(1);
  }
  // 広い画面では右カラムにあり、control より右 (D-14)
  await expect(page.locator('#tab-mon #monitor')).toHaveCount(1);
  if (!isMobile) {
    const c = await page.locator('#grp-control').boundingBox();
    const m = await page.locator('#monitor').boundingBox();
    expect(m.x).toBeGreaterThan(c.x + c.width - 1);
  }
});

test('next と loop bar は control にあり、PARAM の見出しは出さない', async ({ page, isMobile }) => {
  // two:D-62
  if (isMobile) await page.locator('.tab[data-tab="param"]').click();
  await expect(page.locator('#grp-control #next')).toHaveCount(1);
  await expect(page.locator('#grp-control #loop')).toHaveCount(1);
  await expect(page.locator('#tab-scene #next')).toHaveCount(0);
  await expect(page.locator('#tab-mix > .eyebrow')).toBeHidden();
});

test('再生開始時のシーンは stab / dark の群から選ばない', async ({ page }) => {
  test.setTimeout(90000);
  /* two:D-80 (#18)。stab 群は単調なので、起動時のランダム選択では避ける。
     起動時は波が陰寄りで、候補が stab に偏っていた。
     確率の出現頻度ではなく「決して起きない」ことなので、読み込みを繰り返して確かめる。
     並び順に依存しないよう、表示されているシーン名で判定する */
  const STAB = ['submerge', 'moss', 'frost', 'pulse'];
  const seen = [];
  for (let n = 0; n < 20; n++) {
    await page.goto('/index.html');
    const name = (await page.locator('#scenename').textContent()).trim().split(' ')[0];
    seen.push(name);
  }
  expect(seen.filter(s => STAB.includes(s)), `選ばれたシーン: ${seen.join(', ')}`).toEqual([]);
});

test('mixer の発音要素すべてに発音インジケーターがある', async ({ page, isMobile }) => {
  /* two:D-82 (#17)。音量のある20行すべてに1つずつ。倍率の bell FM ratio は発音しないので付けない。
     mixer に無い発音要素 (reverse) は、インジケーターだけの行を置く */
  if (isMobile) await page.locator('.tab[data-tab="param"]').click();
  const keys = ['kick', 'snare', 'clap', 'hat', 'ohat', 'cymbal', 'tom', 'rim', 'perc', 'cowbell',
                'bassFunk', 'bass', 'strings', 'chop', 'stab', 'ep', 'lead', 'riff', 'bell', 'noise'];
  for (const k of keys) {
    await expect(page.locator(`.param:has(#s_mix_${k}) .led`), k).toHaveCount(1);
  }
  await expect(page.locator('.param:has(#s_mix_bellRatio) .led')).toHaveCount(0);
  await expect(page.locator('#mixer #led_reverse')).toHaveCount(1);
  await expect(page.locator('#mixer .led')).toHaveCount(keys.length + 1);
  // 止まっている間は1つも灯らない
  await expect(page.locator('#mixer .led.on')).toHaveCount(0);
});

test('バージョン表示は tag だけで、置き換え前の書式は見せない', async ({ page }) => {
  /* two:D-81 (#16)。コミット番号は git archive で配るときに差し込まれる。
     テストは作業ツリーの index.html をそのまま配信するので、ここでは番号は出ず、
     置き換え前の書式の文字列も表示に漏れないことを見る。
     狭い画面ではバージョンごと隠れる (two:D-71) ので、表示ではなく中身で見る */
  const ver = (await page.locator('#ver').textContent()).trim();
  expect(ver).toMatch(/^v\d+\.\d+$/);
});

test('タイトルの左に、上の階層へのアイコンのリンクがある', async ({ page }) => {
  // two:D-69。アイコンは index.html に埋め込み、色は --ink
  const link = page.locator('header > a.home');
  await expect(link).toHaveAttribute('href', '../');
  // 遷移すると演奏が止まるので、about と同じく別のタブで開く (#15)
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link.locator('svg path')).toHaveCount(3);
  await expect(link).toBeVisible();
  expect(await link.evaluate(el => getComputedStyle(el).color)).toBe('rgb(216, 178, 255)');   // --ink (D-13)
  // タイトルより左にある
  const icon = await link.boundingBox();
  const title = await page.locator('header .mark').boundingBox();
  expect(icon.x + icon.width).toBeLessThanOrEqual(title.x);
});

test('about ページへのリンクがある', async ({ page, isMobile }) => {
  // two:D-71。広い画面ではヘッダーに、狭い画面ではタブの並びの右端にある
  const link = page.locator(isMobile ? '#tabs a.tababout' : 'header a.about');
  await expect(link).toHaveAttribute('href', 'about.html');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toBeVisible();
  // 切り替えのタブには数えない
  if (isMobile) await expect(page.locator('#tabs .tab')).toHaveCount(3);
});
