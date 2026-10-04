# suzuki-toshihir0.github.io

鈴木 聡宏（Toshihiro Suzuki）の個人サイト。https://suzuki-toshihir0.github.io/

HTML・CSS・JavaScript を手で書いている（フレームワークや静的サイト生成器は使わない）。

| ファイル | 中身 |
| --- | --- |
| `index.html` | 本文 |
| `style.css` | 見た目（配色は [Catppuccin](https://github.com/catppuccin/catppuccin) Mocha） |
| `js/attitude.js` | 背景の衛星の姿勢: 剛体とリアクションホイールの運動方程式、姿勢制御 |
| `js/art.js` | 背景の描画（ワイヤーフレームの衛星と星） |
| `js/planner.js` | 名前の前の `❯` で開くパネル（衛星を向ける方向と、ホイールの回転数の履歴） |
| `js/lang.js` | 日本語・英語の切り替え |
| `js/stars.js` | 星のデータ |

## テスト

```sh
npm ci
npm test          # Chrome の場所は CHROME で指定できる（既定は PATH の google-chrome / chromium）
npm run serve     # 手元で http://localhost:8000/ を開いて確かめる
```

- `test/attitude.test.js`: 姿勢制御の性質を [fast-check](https://fast-check.dev/) で確かめる（目標に収束する、光軸が大円に沿って動く、天の極や真反対の目標でもおかしな動きをしない、角運動量が保たれる、など）。回数は `RUNS` で変えられる
- `test/page.test.js`: ページの体裁（head、OGP、favicon）、読み込みの失敗が無いこと、言語の切り替え、パネルの操作、背景の描画
- `test/layout.test.js`: 画面の幅（320〜1920px）・言語・表示倍率・パネルの開閉の組み合わせごとに、はみ出しや重なりが無いこと。`SHOTS=<フォルダ>` でスクリーンショットを保存する

## 出典

星のデータは Hipparcos 星表（ESA, 1997。[CDS VizieR I/239](https://cdsarc.cds.unistra.fr/viz-bin/cat/I/239)）から 6 等級より明るいものを取り出した。Credit: ESA, [CC BY-NC 3.0 IGO](https://creativecommons.org/licenses/by-nc/3.0/igo/)。
