# Elevator Three

自動生成のエレクトロを鳴らし続けるシングルファイルの楽器。
[elevator-two](https://github.com/mrmt/elevator-two) から分岐し、音楽的な判断を
TypeSafe の [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) に文脈つきで任せて、
展開と即興を豊かにすることを目指す。

**最新版: v0.3** — 変更点は下の[変更履歴](#変更履歴)を参照。

`index.html` をブラウザで開き、卓の中央にある大きな再生ボタンを押すと鳴りはじめる。
ブラウザの制限で、開いただけでは音は出ない。音と操作は two v0.6 を引き継いでいる。
次のシーン・遷移の方式・キーと進行・フレーズ・イベント・ダブ・リフの旋律は、数小節先に Jev へ問い合わせ、
返った確率分布から引く。control の `jev` はその割合で、0 にすると two と同じに鳴る。
問い合わせは中継の Worker (`worker/`) を通す。繋がらないときは手元の判断で鳴り続ける。

設計の議論と決定は [docs/DESIGN.md](docs/DESIGN.md) に集約している。D-1 から振り直した。
two から引き継いだコードや文書に残る `two:D-n` は、two の決定 ([docs/two-DESIGN.md](docs/two-DESIGN.md)) を指す。
シーンの定義は [docs/SCENES.md](docs/SCENES.md)、実装の構造は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、
テストは [docs/TESTING.md](docs/TESTING.md) に分けてある。

## elevator-two との関係

| | elevator-two | elevator-three |
| --- | --- | --- |
| 音楽 | エレクトロ (minimal techno を土台に electro funk / dub techno / グリッチを混ぜる) | 同左を引き継ぐ |
| 判断 | 手元の乱数と種 | Jev に文脈つきで問い合わせる。応答が無いときは two と同じ判断に戻る |
| 通信 | ネットワークに一切繋がらない | 判断の問い合わせだけ、自前の中継に繋がる |
| 実装 | 単一 `index.html`、ビルド工程なし | 同左を踏襲 |

コードは共有せず、two から土台をコピーして分岐させた。共通化のための仕組みは持たない。

## Jev の中継 (`worker/`)

ブラウザから `api.typesafe.ai` は呼べない (CORS) ので、Cloudflare Worker `elevator-three-api` を挟む (D-3)。

```
cd worker
npx wrangler secret put TYPESAFE_API_KEY   # 初回だけ
npx wrangler deploy                        # three-api.elevator-noise.com
```

手元では `worker/.dev.vars` に `TYPESAFE_API_KEY=...` を書いて `npx wrangler dev` (ポート 8787) を立てる。
`localhost` / `127.0.0.1` で開いた `index.html` は、既定でこちらに問い合わせる。
Worker の試験は `npm run test:worker`。

## 変更履歴

### 未リリース

**操作と見た目**
- 配色を青紫の地、白い文字、淡いクリームの差し色にした。about と docs の解説 html も同じ (D-16)
- 既定値を上げた。`shift` / `lush` を 0.8、`jev` を 1、mixer の `funk bass` / `other bass` を 0.5 (D-16)
- jev 欄の JSON から `history` を外した。送る state には含む (D-16)
- decision 群に `temperature` (0〜2、既定 1) を足した。Jev の確率に掛ける温度で、下げるほど Jev のいちばんの答えに寄り、0 では必ずそれを取る。上げるほど均す (D-18)

**音**
- 音色と細部の判断も Jev に問い合わせる。行き先のシーンのベースの音色・コードの連打・インダストリアル・ノイズ、
  ep の差し込み、16分シーケンスの音色、並びの書き換え、8小節の終わりのキックの変形、平行移動の幅、ペダル。
  問い合わせの回数は増やさず、既存の問い合わせに質問を足した (D-17)

**開発**
- 中継の Worker に質問を9つ足した。**`index.html` より先に Worker をデプロイすること** (古い Worker は知らない質問を 400 で弾く)
- 毎小節使う判断のため、届いた答えを次の答えまで `jevHold` に持つ (D-17)
- 試験を足した。上の判断が Jev の答えどおりになること、`temperature` 0 でいちばん確率の高い答えだけを取ること

### v0.3 (2026-09-19)

画面を3カラムにし、Jev とのやり取りを専用の欄に出すようにした。配色を紫にした。

**操作と見た目**
- 3カラムにした。左は scene、中央は control と mixer、右は monitor と jev。狭い画面のタブは scene / param / monitor (D-14)
- jev 欄に、Jev とのやり取りを新しい順に出す。送った query の JSON (グレー)、返った result の JSON (白)、
  その結果音楽的に何が起こるか (強調)。やり取りが増えても、伸びるのは jev 欄の中だけ (D-15)
- 配色を #d8b2ff / #b266ff / #4500e2 / #3100a2 / #4c0099 の5色にした。about と docs の解説 html も同じ (D-13)

**開発**
- 真偽の問いの `jevP()` を、引いた結果を返す `jevRoll()` にした (D-15)
- 試験を足した。やり取りが20回を超えても mixer と jev 欄の位置と大きさが変わらないこと、3色が読み分けられること

### v0.2 (2026-09-19)

音楽的な判断を Jev に任せるようにした (D-3〜D-9)。

**音**
- 次のシーン、遷移の方式、シーンの長さを Jev に問い合わせる。候補は two と同じく陰陽の波に近いものに限る
- 行き先のキーと和音の進行、平行移動の転調、開いた和声を Jev に問い合わせる
- 次のフレーズ型、第3層イベント (起こさないことも含む)、ダブを出すかを Jev に問い合わせる
- リフを新しく引く回は、候補を6通り作って Jev に選ばせる
- どれも最大確率ではなく、返った分布から引く。応答が間に合わなければ two と同じ判断に戻る

**操作と見た目**
- control に decision 群を足し、`jev` スライダー (既定 0.8) を置いた。判断のうち Jev に任せる割合
- monitor に Jev の状態・応答時間・Jev と手元で決めた数・直近の判断を出す
- monitor の最下段に Jev とのやり取りを出す。何を問い、何が返り、何を使ったか (D-11)

**開発**
- 中継の Worker を `worker/` に置いた。質問文は Worker 側だけが持ち、形とサイズ、オリジン、回数を絞る
- `?jev=0` / `?jevurl=` / `?jevlog` / `?scenebars=` を足した
- `tests/jev.spec.js` を足した。Worker の応答を差し替えて、答えどおりに鳴ること、遅れた答えを捨てること、
  繋がらなくても止まらないことを見る

### v0.1 (2026-09-19)

elevator-two v0.6 から分岐した (D-1 / D-2)。音と操作は v0.6 と同じ。

## ライセンス

MIT
