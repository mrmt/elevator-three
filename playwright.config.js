// @ts-check
import { defineConfig, devices } from '@playwright/test';

const PORT = 8125;   // elevator-one (8123) / two (8124) と同時に走らせても衝突しないようにずらす

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  // 音の検証はメインスレッドで一定間隔にサンプリングするので、
  // 並列度を上げすぎるとポーリングが痩せて測定がぶれる
  /* 各ワーカーが実時間で音を鳴らすので、上げすぎるとCPUが競合して
     測定が不安定になる。実測 (10論理コア / 高性能4) では
     3 → 2.4〜2.7分 失敗0、4 → 1.9〜2.0分 失敗0、6 → 1.4〜1.6分 失敗1。
     速さと安定の折り合いで 4 にしてある */
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // CI でも list を混ぜる。github reporter は失敗時の注釈しか出さないため、
  // これがないとログから「いまどのテストを実行しているか」が分からない
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },

  // 静的HTML1枚なので配信はpython3で足りる
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'ignore',
  },

  projects: [
    // 音の検証。ヘッドレスWebKitはAudioContextのresumeが不安定なためChromiumのみ
    {
      name: 'audio-chromium',
      testMatch: /audio\.spec\.js/,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
    // 進行 (シーン / フレーズ / イベント)。AudioContext を動かすので Chromium のみ
    {
      name: 'transport-chromium',
      testMatch: /transport\.spec\.js/,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
    // macOS相当。2カラムのデスクトップレイアウト
    {
      name: 'desktop-chromium',
      testMatch: /interaction\.spec\.js/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    // iOS相当。ヘッダーが折り返す危険が一番高い幅
    {
      name: 'mobile-webkit',
      testMatch: /interaction\.spec\.js/,
      use: { ...devices['iPhone 14'] },
    },
  ],
});
