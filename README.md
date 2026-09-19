# Elevator Three

自動生成のエレクトロを鳴らし続けるシングルファイルの楽器。
[elevator-two](https://github.com/mrmt/elevator-two) から分岐し、音楽的な判断を
TypeSafe の [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) に文脈つきで任せて、
展開と即興を豊かにすることを目指す。

**最新版: v0.1** — 変更点は下の[変更履歴](#変更履歴)を参照。

`index.html` をブラウザで開き、卓の中央にある大きな再生ボタンを押すと鳴りはじめる。
ブラウザの制限で、開いただけでは音は出ない。音と操作は、いまのところ two v0.6 と同じ。

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

## 変更履歴

### v0.1 (2026-09-19)

elevator-two v0.6 から分岐した (D-1 / D-2)。音と操作は v0.6 と同じ。

## ライセンス

MIT
