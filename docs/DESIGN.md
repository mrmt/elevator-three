# 設計メモ

elevator-three の決定と議論を積む作業文書。確定した内容は「決定事項」へ、議論中は「検討中の論点」へ置く。

three の決定は D-1 から振り直す。two から引き継いだコードやほかの文書に残る `two:D-n` は、
two の決定 ([two-DESIGN.md](two-DESIGN.md)) を指す。two-DESIGN.md は分岐した時点の写しで、three では書き足さない。

最終更新: 2026-09-19

---

## 決定事項

### D-1. two から分岐した別リポジトリとする (2026-09-19)

`mrmt/elevator-three` を新設し、elevator-two v0.6 (main の 23b70c2) の中身をコピーして土台にする。

- three の目的は、音楽的な判断を TypeSafe の Jev に文脈つきで任せ、展開と即興を豊かにすること。
  two は判断をすべて手元の乱数と種で決めているので、「いま何が起きてきたか」を踏まえた展開の筋を持たない
- two は「ネットワークに一切繋がらない」(two:D-60) ことを方針にしている。
  Jev は問い合わせを要するので、two の中ではやらずに別の楽器にする
- 分岐のやり方は two が one から分かれたとき (two:D-1) に倣う。
  git の履歴は引き継がず、コードを共有する仕組みも持たない

### D-2. two から引き継ぐもの (2026-09-19)

- 音源・シーン・遷移・フレーズ・イベント・リフ・和声・卓の UI を、v0.6 のまま全部引き継ぐ
- Playwright の試験一式と CI。ポートは 8125 にし、one (8123) / two (8124) と同時に走らせても衝突しないようにした
- `index.html export-subst` によるコミット番号の差し込み (two:D-81)
- 決定番号は振り直す。コードのコメントに残る two の決定番号は、`D-n` を機械的に `two:D-n` へ置き換えた
- 個別の音量の保存先は `elevator-three:mix` にした。two とは別に持つ
- two:D-60 で入れた、YouTube の API キーを起動時に消す処理は、three では持つ理由がないので削除した

### D-3. Jev は three 専用の Worker を通して呼ぶ (2026-09-19)

`worker/` に中継の Worker (`elevator-three-api`、`three-api.elevator-noise.com`) を置き、
ブラウザからは `POST /decide` だけを呼ぶ。Worker が TypeSafe の API (`/v1/systemone`、`jev-latest`) を呼ぶ。

- `api.typesafe.ai` は許可したオリジン以外を CORS で弾く (実測で 400 Disallowed CORS origin)。
  API キーをブラウザに置かないためにも、中継が要る
- Workers AI にも `typesafe/jev` があるが、外部のモデルなので AI Gateway のクレジットが要る
  (試したところ `2021: Insufficient AI Gateway credits`)。TypeSafe の API キーを使うことにした。
  キーは `wrangler secret put TYPESAFE_API_KEY` で Worker に置く
- **質問文は Worker 側の表 (`worker/src/decide.js` の `KINDS`) からしか組み立てない。**
  クライアントが送るのは `{kind, state, ask}` だけで、`ask` には質問 id と、choice なら選択肢を入れる。
  任意の質問を Jev に中継する口にしないため
- 形とサイズを検査する。`kind` と質問 id は許可リストにあるものだけ。
  上限は、body 16,000 字、state 8,000 字、選択肢は1問あたり2〜64個、選択肢のキーは英数字32字、説明は240字
- オリジンは `https://elevator-noise.com` と `http://localhost` / `127.0.0.1` だけを許可する。
  Rate Limiting で IP ごとに毎分60回まで。Jev は4秒で打ち切る
- 返すのは確率と confidence だけ (`{answers:{id:{probs|p, confidence}}, model, ms}`)

### D-4. 判断は数小節先に問い合わせ、その小節で使う (2026-09-19)

`onBar()` はその小節が鳴る約0.12秒前に同期で走るので、その場で応答を待てない。
two の `planSpark` / `planDub` と同じく、**数小節先の判断を先に問い合わせておき、その小節で使う**。

- `jevAsk(name, kind, {tag, deadline, ask, extra, onAnswer})` が問い合わせる。応答は `jev.book[name]` に `tag` と組で置く
- `jevTake(name, tag)` が取り出す。`tag` が一致しなければ使わない。過ぎた場面のものは捨て、先の場面のものは残す
- `deadline` の小節の `onBar()` より後に届いた応答は捨てる。fetch もそこまでの時間で打ち切る
- **応答が無いとき (遅れた、失敗した、`?jev=0`) は、two とまったく同じ手元の判断に戻る**。
  既存の判断関数 (`chooseScene` / `moveKey` / `pickProg` / `choosePhrase` など) は消さずにフォールバックとして使う
- 3回続けて失敗したら、32小節は問い合わせない。Worker が落ちているときに叩き続けないため

### D-5. Jev の分布からサンプリングし、jev スライダーで混ぜる割合を決める (2026-09-19)

- **最大確率の選択肢は取らず、Jev が返した確率分布から引く。** いちばんもっともらしい手ばかり選ぶと、
  即興の意外性が乱数より落ちる
- control に decision 群を足し、`jev` スライダー (既定 0.8) を置いた。各判断は、この割合で Jev の分布から引き、
  残りは手元で引く。分布を `jev : 1-jev` で混ぜるのと同じなので、0 なら two と同じに鳴る
- 真偽の問い (shift / lush / dub) は Jev の確率を使う。shift と lush は、スライダーの値を 0.5 で割った倍率
  (上限1) を掛ける。スライダーを 0 にしたら出さないという two の約束を、Jev の側でも守るため

### D-6. Jev に渡す state (2026-09-19)

Jev は音を聴けないので、いまの状態と「いままで何が起きてきたか」を文字にして渡す (`jevState()`)。

- いま: 小節、BPM、シーン (名前・群・性格の説明・経過/予定の小節数)、フレーズ、陰陽の波の位置と向き、
  キー、和音 (度数と種類)、density / glitch / evolution
- 履歴 `hist`: シーン、フレーズ、イベント、ダブ、リフ (音名とリズムの型)、キー。種類ごとに直近8件
- 判断ごとの追加: 行き先のシーン (harmony)、和音の構成音と覚えたモチーフ (riff)

### D-7. 問い合わせの予定 (2026-09-19)

| name | kind | 問い合わせる小節 | 使う場所 |
| --- | --- | --- | --- |
| scene | scene | 遷移を始めうる最初の小節の8小節前 | `startTransition()` |
| harm | harmony | 遷移を始めたとき | `enterScene()` (キー・進行、D-17 の音色) |
| phrase | phrase | 4小節の節目の2小節前 | `maybeEvent()` / `nextPhrase()` / `planDub()`、D-17 の lead / mutate / kick / ep |
| shift | harmony | 8小節の節目の2小節前 | 平行移動の転調 / `nextPhrase()` の lush、D-17 の step / pedal |
| riff | riff | `planSpark()` が新しい旋律を引いたとき | 食いを置く小節の前に差し替える |

回数は、BPM 125 でおよそ毎分10〜15回になる (phrase が4小節ごと、shift が8小節ごと、ほかはたまに)。
`?spark` でリフを出し続けると毎分20回ほど。

### D-8. Jev に任せる判断 (2026-09-19)

- **シーンの展開** — 次のシーン (候補は `chooseScene()` と同じく、波に近い順に、直近のものといまのものを除いた6つ)、
  遷移の方式 (連続変形は同じ群・同じキットのときだけ)、次のシーンの長さ (short / medium / long を ×0.7 / ×1 / ×1.35 として
  evolution から出す長さに掛ける)
- **キーと和声** — 行き先のキー (五度圏の近い調。shift が 0 でなければ3度・6度の遠い調も)、和音の進行
  (lush は問い合わせる時点で手元で引き、その側の進行表から選ばせる)、平行移動の転調、開いた和声
- **フレーズとイベント** — 次のフレーズ型 (そのシーンで出うる型だけ)、第3層イベント (none を含む。
  glitch を 0.1 未満にしたらグリッチ系は選ばせない)、ダブを出すか
- **リフの旋律** — 新しく引く回は、同じ音数の候補を6通り作り、Jev に選ばせる。
  応答を待つ間が要るので、Jev に任せる回は必ず3小節先に置く。候補の1つめを仕込んでおき、届いたら差し替える。
  覚えた形の使い回しと応答 (two:D-75) は選ばせない
- 手で選んだシーン (`enterScene(…, {manual:true})`) には Jev の答えを使わない
- D-17 で、音色・並び・平行移動の幅・ペダルも足した

### D-9. monitor に Jev の状態を出す (2026-09-19)

monitor の最下段に `jev` の行を置いた。
- 左: 状態 (on / local / offline / off) と、直近の応答時間
- 右: Jev で決めた数 / 手元で決めた数と、直近に Jev が決めたこと (例: `event kickdrop 62%`)

開発用のクエリを足した。
- `?jev=0` — 問い合わせない
- `?jevurl=` — 中継の URL を差し替える。手元 (localhost / 127.0.0.1) で開いたときの既定は `http://localhost:8787/decide`、
  つまり `wrangler dev`。試験が本番の Worker を叩かないため
- `?jevlog` — 応答・遅れ・失敗・鳴らしたリフをコンソールに出す
- `?scenebars=16` — シーンの長さを固定する。遷移の判断を数分待たずに確かめるため

### D-10. 本物の Jev で鳴らした結果 (2026-09-19)

Worker を `three-api.elevator-noise.com` にデプロイし、`?jevurl=` で本番の Worker に繋いで3分鳴らした (jev=1、BPM は既定)。

- 問い合わせは33回 (毎分およそ12回)。遅れて捨てたもの・失敗は0。応答時間は中央値 233ms、最大 686ms (日本から)。
  Worker を直に呼んだときの内訳は、全体 0.56秒のうち Jev が 435ms
- シーンは drowse → submerge → bounce と移った。キー、イベント、リフの候補も Jev の分布から引いていた
- 第3層イベントでは Jev は none を5〜7割選ぶ。手元の判断 (4小節ごとに3〜5割で発火) より仕掛けが少し減る
- 許可していないオリジンからは 403 になることを本番で確かめた
- `jev` スライダーを動かすとシーン名に (edit) が付き、陰陽が波に従わなくなっていた。`jev` は雰囲気の操作ではないので付けないようにした

### D-11. Jev とのやり取りを monitor に出す (2026-09-19) — D-15 で置き換えた

Jev に何を問い、何が返り、そのうち何を使ったかを、monitor の最下段にその場で出す。新しい順に5件まで。
1件は3行で、行が長ければ末尾を省く。マウスを乗せると、問いと答えの全文 (JSON) が出る。

- 1行め (問い): 問うた小節、予約の名前、どの小節までに要るか、質問 (選択肢の数。真偽の問いは `?`)、
  問うたときのシーン・フレーズ・キー。例: `bar 14 phrase → by 16  event(10) phrase(4) dub?  [drowse plateau C dorian]`
- 2行め (答え): 応答時間と、質問ごとの確率の上位3つ。待っている間は `… waiting`。
  遅れて捨てたもの (`late, discarded`)、場面が過ぎて使わなかったもの (`not used: moment passed`)、失敗 (`✕`) もここに出す
- 3行め (使ったもの): `event sweep` のように Jev の答えから引いた値。真偽の問いは使った確率 (`dub p=26%`)。
  答えはあったが jev スライダーの割合で手元の判断に回したものは `→ local`。リフは選んだ候補の旋律も添える
- `?jev=0` のときは `jev off — nothing is asked` とだけ出す

### D-12. jev を 0 にしたら問い合わせない (2026-09-19)

問い合わせるかどうかを `current.jev` で決めていたため、スライダーを 0 にしても問い合わせが続いていた。
`current` は `glide` の時間をかけて目標へ指数的に寄せる値で、0 に近づくだけで 0 にならない。
答えはほとんど使われないが、送信は続いていた。

- 問い合わせるかどうか (`jevActive`) と、monitor の off 表示は、目標値 `target.jev` で決める
- 使う割合 (`jevInfl`) は従来どおり `current.jev`。滑らかに変わるほうが聴きやすい
- プライバシーポリシーに「jev を 0 にすると何も送らない」と書くので、それを試験で押さえた

### D-13. 配色を紫の5色にする (2026-09-19) — D-16 で置き換えた

ユーザーの指定で、配色を #d8b2ff / #b266ff / #4500e2 / #3100a2 / #4c0099 の5色にした。地色も紫にする (ユーザーの選択)。
two の EK (漆黒に黄色、two:D-37) の構造はそのままに、色だけを CSS 変数で差し替えた。

| 変数 | 値 | 使い道 |
| --- | --- | --- |
| `--bg` | #3100a2 | 地 |
| `--box` | #2a008c | section・header・footer の地 (#3100a2 を少し沈めた色) |
| `--deep` / `--panel` | #4c0099 | ツールチップ、卓の群の地 (半透明で重ねる) |
| `--ink` / `--dim` | #d8b2ff / その6割 | 文字 |
| `--accent` | #b266ff | 見出しの帯、つまみ、選択中のもの (旧 `--amber`) |
| `--hot` | #4500e2 | 押している状態のボタン・SOLO・点いているステップ。文字は白 |
| `--glow` | #d8b2ff | 発音インジケーター、いま鳴っているステップ |
| `--scope` / `--scope-bg` | #d8b2ff / #1c005e | 波形の線と地。`readLook()` が起動時に拾う |

- 直書きの色 (黄色の rgba、#0B0B0D など) は変数に寄せた
- about.html と docs の解説 html 2本も同じ5色にした。解説 html は長い本文を読むので、本文だけ白に近い色 (#f6eeff) にした
- フッターの注記「Green steps … blue are hats」は色が変わって事実と合わなくなったので直した

### D-14. 3カラムにする (2026-09-19)

Jev とのやり取りを monitor の下に積んでいたため (D-11)、やり取りのたびに表示が伸びて mixer が押し下げられていた。

- 左 `#tab-scene` は scene (いままでどおり)。中央 `#tab-mix` は control と mixer。右 `#tab-mon` は monitor と JEV
- 列の幅は `minmax(128px,166px) minmax(0,1fr) minmax(280px,min(30vw,440px))`
- 右カラムは縦並びの flex。monitor は中身の高さ、JEV は残りの高さを取り (`flex:1; min-height:0`)、
  **JEV のログはその中だけでスクロールする**。何件増えても、ほかの欄は動かない
- 狭い画面 (≤900px) のタブは `scene` / `param` / `monitor` の3つにした
- 試験で、やり取りが20回を超えても mixer と JEV の位置と大きさが変わらないことを見る

### D-15. JEV セクションにやり取りを出す (2026-09-19)

D-11 の3行の要約をやめ、Jev に何を送り、何が返り、その結果音楽的に何が起こるかを、そのまま出す。

- 1回のやり取りを1件とし、新しい順に20件まで持つ。1件は4つの部分からなる
  1. 小さな行: `bar 14 · phrase · for bar 16 · 216ms` (問うた小節、予約の名前、使う小節、応答時間)
  2. **グレー**: 実際に送った `{kind, state, ask}` の JSON (ユーザーの選択で state まで全部)
  3. **白**: 返った JSON (`{answers, model, ms}`)。失敗したときは `✕` と理由
  4. **強調** (太字の `--glow`、`--hot` の帯。D-16 で白と #313178): 音楽的に何が起こるか。
     `next scene: gear (electro funk)`、`transition: DJ mix`、`key: F# dorian`、`event: filter sweep at bar 20`、
     `no event at bar 16`、`dub at bar 17 (p=28%)`、`key shifts to C# dorian at bar 16 (p=27%)`、`riff: C#4 E4 G#4 (eighth rhythm)` など。
     jev の割合で手元に回したときは `…: decided by local rules`、遅れたときは `discarded (…) — local rules decide`
- JSON は `fmtJson()` で整形する。深さ2までは改行と字下げ、それより深いもの (履歴の配列、選択肢の表) は1行に畳む。
  全部を開くと1件が100行を超えるため。履歴 (`history`) は D-16 で表示から外した
- 真偽の問い (shift / lush / dub) は、確率を返す `jevP()` をやめ、引いた結果を返す `jevRoll()` にした。
  呼び手が結果を決めたあと `jevRolled()` で「何が起こったか」を書き足す。開いた和声は、実際に引き直す場面 (シーンに入った直後以外) だけで引く
- 見出しの右に、状態と応答時間、Jev と手元で決めた数を出す (旧 monitor の `jev` の行を移した)
- 1件が長いので、新しい件の強調の行は、たいてい query と result の下にあり、見るにはスクロールが要る

### D-16. 配色を青紫とクリームにし、既定値を上げ、JEV の履歴を隠す (2026-09-19)

D-13 の紫の5色をやめ、地を明るい青紫、文字を白、差し色を淡いクリームにした。白い文字で読みやすくするため。

| 変数 | 値 | 使い道 |
| --- | --- | --- |
| `--bg` | #7474b0 | 地 |
| `--box` | #4e4e94 | section・header・footer の地。地より濃くする |
| `--deep` | #313178 | ツールチップなど、浮いた箱の地 |
| `--panel` / `--panel-hi` | rgba(207,207,232,.08) / .16 | 卓の群の地。淡い青紫を重ねて明るくする |
| `--ink` / `--dim` | #ffffff / #cfcfe8 | 文字 |
| `--accent` | #ffffee | 見出しの帯、つまみ、選択中のもの |
| `--hot` | #313178 | 押している状態のボタン・SOLO・点いているステップ。文字は白 |
| `--glow` | #ffffff | 発音インジケーター、いま鳴っているステップ |
| `--scope` / `--scope-bg` | #cfcfe8 / #313178 | 波形の線と地 |

- 小さな文字 (数値、monitor と JEV の見出しの値、進行のイベント) は白に保ち、差し色は操作と状態の目印だけに使う
- ハットのステップ、拍の明滅、再生ボタンの呼吸は、差し色 (#ffffee) の rgba にした。フッターの注記も「faint cream」に直した
- about.html と docs の解説 html 2本も同じ地と差し色にした

既定値を上げた。

- `shift` / `lush`: 0.5 → 0.8 (two:D-70 の 0.5 から変えた)
- `jev`: 0.8 → 1
- mixer の `funk bass` / `other bass`: 1 → 0.5。`MIX` に `def` を持たせ、保存値が無いときに使う (two:D-54 の「1 のまま」から変えた)

JEV セクションの強調の行は、文字色が result と同じ白になった。試験は文字色の3色ではなく、太字と `--hot` の帯で区別できることを見る。

JEV セクションの JSON から `history` を外した。送った state のうち履歴が大半を占め、1件が長くなりすぎるため。
表示だけで、Jev に送る state には従来どおり含む。

### D-17. 残りの構造的な判断も Jev に任せる (2026-09-19)

シーン〜数小節単位の判断のうち、手元の乱数で決めていた9つを Jev に移した。**問い合わせの回数は増やさず**、
既存の harm / phrase / shift の ask に質問を足す。使い方は D-5 と同じで、jev の割合だけ Jev から引き、
残りと答えが無いときは従来の手元の確率で引く。

| 判断 | 問い合わせ (kind / id / 型) | 使う場所 | 手元の確率 |
| --- | --- | --- | --- |
| ベースの音色 (`bassTight`) | harm (harmony) / `tight` / noul | `enterScene()` | .5 |
| コードの連打 (`padChop`) | harm (harmony) / `chop` / noul。`chop` が 0 のシーンには聞かない | `enterScene()` | シーンの `chop` |
| インダストリアル・ノイズ (`noiseOn`) | harm (harmony) / `noise` / noul。左右の周期の配置は手元 | `rollNoise()` | `NOISE_P` |
| ep の差し込み (`epGuest`) | phrase / `ep` / noul。フレーズ型を聞く回で、jazz 回路以外 | `nextPhrase()` | .18 |
| リードの音色 (`leadType`) | phrase / `lead` / choice (sawtooth / square / triangle / pulse)。毎回 | `regenerate()`。差し替えるかどうか (毎小節 .25) は手元 | 鋸波5割、ほか5割 |
| 並びの再抽選 | phrase / `mutate` / noul。mutate が 0 なら聞かない | `regenerate()` | 毎小節 `mutate*.5` |
| キックの変形 (`kickVariant`) | phrase / `kick` / choice (skip / push / double / ghost)。`at%8===4` の回だけ | `buildBar()` の8小節の終わり。ミックスの2本目には使わない | 一様 |
| 平行移動の幅 | shift (harmony) / `step` / choice (`home`、-4〜+7 の各段) | `onBar()` の転調 | 戻す5割、`SHIFT_STEPS` から |
| ペダル | shift (harmony) / `pedal` / noul | `onBar()` の和音の変わり目 | 変わり目ごとに `shift*.5` |

- 毎小節引く判断 (lead / mutate / kick / pedal) のため、届いた答えを次の答えまで `jevHold` に持つ
  (phrase は4小節、shift は8小節)。`jevHeld(name)` で取り出す。シーンに入ったら捨てる
- mutate の Jev の p は「この4小節のうちに並びが変わる確率」とし、小節あたり `1-(1-p)^(1/4)` に直して引く。
  mutate と pedal には、shift / lush と同じくスライダーの値を 0.5 で割った倍率 (上限1) を掛ける (D-5)
- JEV セクションには `bass: tight`、`industrial noise on`、`lead timbre: square at bar 20`、`kick bends (push) at bar 23`、
  `key shifts up a fourth` などを書く。mutate と pedal は毎小節引くので、当たったときだけ書く
- 変えなかったもの: 音声合成の乱数、1音・1ステップ単位の揺らぎ、Jev の分布から引く乱数、Jev が使えないときの手元の判断

### D-18. Jev の確率に温度を掛ける (2026-09-19)

decision 群に `temperature` スライダー (0〜2、既定 1) を足した。Jev の API には温度の指定が無い
(送れるのは `model` / `state` / `questions` だけ) ので、返った確率に手元で掛ける。

- choice: `p^(1/T)` を正規化してから引く (`tempProbs()`)。選べる選択肢 (`allowed`) に絞ってから掛ける
- noul: 対数オッズを T で割る (`tempP()`)。shift / lush などの倍率 (gate) は温度を掛けたあとに掛ける
- T=1 で Jev の確率そのまま。下げるほどいちばん確率の高い答えに寄り、0 (0.02 未満) では必ずそれを取る。
  noul は 0.5 より上なら必ず起こし、下なら起こさない。上げるほど選択肢が均され、noul は 0.5 に寄る
- 例: 確率 .6 / .3 / .1 は T=0.5 で .78 / .20 / .02、T=2 で .47 / .33 / .19。noul の .7 は T=0.5 で .85、T=2 で .60
- 判断の任せ方なので、jev と同じく (edit) を付けない。音の変化ではないので滑らかに寄せず、目標値をすぐ使う
- 手元の判断 (jev の割合で手元に回した分、答えが無いとき) には掛けない。D-5 の「0 なら two と同じ」を保つため

---

## 検討中の論点

- 実際の Jev の答えを聴いて、質問文 (`KINDS`) と state の渡し方を詰める。まずはイベントの none の多さ
- 配布: elevator-noise.com の `/three/` への配置と、プライバシーポリシーの見直し
