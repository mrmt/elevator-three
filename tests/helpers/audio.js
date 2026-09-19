// アプリのオーディオグラフはIIFEの中に閉じているので、外からノードを掴めない。
// AudioNode.prototype.connect をラップして、destination へ繋がる信号を
// AnalyserNode にも分岐させ、テストから波形を読めるようにする。

export async function installAudioProbe(page) {
  await page.addInitScript(() => {
    const origConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dest, ...rest) {
      if (typeof AudioDestinationNode !== 'undefined' && dest instanceof AudioDestinationNode) {
        const probe = dest.context.createAnalyser();
        probe.fftSize = 2048;
        origConnect.call(this, probe);
        window.__audioProbe = probe;
      }
      return origConnect.call(this, dest, ...rest);
    };
  });
}

/** プローブから現在の波形レベルを取る。プローブ未設置なら null */
export function readLevel(page) {
  return page.evaluate(() => {
    const probe = window.__audioProbe;
    if (!probe) return null;
    const buf = new Float32Array(probe.fftSize);
    probe.getFloatTimeDomainData(buf);
    let peak = 0;
    let sum = 0;
    for (const v of buf) {
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
    }
    return { peak, rms: Math.sqrt(sum / buf.length), state: probe.context.state };
  });
}

/** 一定時間ポーリングして観測できた最大のピークを返す */
export async function maxPeakOver(page, ms, intervalMs = 250) {
  const deadline = Date.now() + ms;
  let peak = 0;
  let last = null;
  while (Date.now() < deadline) {
    last = await readLevel(page);
    if (last && last.peak > peak) peak = last.peak;
    await page.waitForTimeout(intervalMs);
  }
  return { peak, last };
}

/**
 * 音源の予約時刻を記録する。
 *
 * 音の波形から打点の時刻を推定すると、キックとベースで立ち上がりの速さが違うぶん
 * 検出が前後し、格子との照合がぼやける。予約そのものを見れば、生成側が
 * どの時刻に音を置いたかがサンプル精度で分かる。
 * `start(when)` を包んで、渡された音声時計の値を集める。
 */
export async function installScheduleProbe(page) {
  await page.addInitScript(() => {
    window.__starts = [];
    for (const proto of [OscillatorNode, AudioBufferSourceNode]) {
      const orig = proto.prototype.start;
      proto.prototype.start = function (when, ...rest) {
        if (typeof when === 'number') window.__starts.push(when);
        return orig.call(this, when, ...rest);
      };
    }
  });
}

/** 記録された予約時刻を取り出して消す */
export async function takeStarts(page) {
  return page.evaluate(() => {
    const s = window.__starts.slice();
    window.__starts.length = 0;
    return s;
  });
}

/**
 * 予約時刻が格子に乗っている割合を返す。
 * 原点は分からないので、割合が最大になる位置を総当たりで探す。
 */
export function gridFit(times, step, tol = 0.05) {
  if (!times.length) return 0;
  let best = 0;
  for (let k = 0; k < 400; k++) {
    const off = (step * k) / 400;
    const near = times.filter(t => {
      const r = ((t - off) % step + step) % step;
      return Math.min(r, step - r) / step < tol;
    }).length;
    best = Math.max(best, near / times.length);
  }
  return best;
}
