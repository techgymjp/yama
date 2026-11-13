# Google Play ストア掲載情報（下書き）

Play Console の「ストアの掲載情報」に貼り付けて使います。既定の言語を日本語にし、「翻訳を管理」から英語（en-US）を追加してください。

## 画像（このフォルダ）

| 用途 | ファイル | サイズ |
| --- | --- | --- |
| アプリのアイコン | `icon-512.png` | 512 × 512 |
| フィーチャー グラフィック（日本語） | `feature-graphic.png` | 1024 × 500 |
| フィーチャー グラフィック（英語） | `feature-graphic-en.png` | 1024 × 500 |
| スマートフォンのスクリーンショット（日本語） | `ja-1-top.png` 〜 `ja-5-result.png` | 1920 × 1080 |
| スマートフォンのスクリーンショット（英語） | `en-1-top.png` 〜 `en-5-result.png` | 1920 × 1080 |

スクリーンショットは Web 版を自動操作して撮影したものです（`scripts/store-shots.cjs`）。結果画面の点数は撮影用に入れた値です。

---

## 日本語

**アプリ名**（30 文字以内）

```
山探し - 山座同定クイズ（富士山・百名山）
```

**簡単な説明**（80 文字以内）

```
あの山の名前は？本物の地形から描いた景色で山座同定。富士山や百名山を探す、山の名前当てクイズ
```

**詳しい説明**

```
あの山の名前、わかりますか？

「山探し」は、景色の中からお題の山を探してタップする、山座同定（さんざどうてい）の山の名前当てクイズです。
国土地理院の標高データから、その場所から実際に見える山の景色を計算して描き出します。
「富士山を探して！」——さあ、どの山でしょう？
登山・ハイキングの予習に、展望台や山頂からの山の名前調べに。

■ 本物の地形から描く景色
・国土地理院の標高データと空中写真から、その場所から見える景色を再現
・地球の丸みや空気による光の屈折まで計算し、何百キロ先の山まで描画
・季節に合わせた雪化粧、遠くの山ほど青く霞む空気遠近法
・街なかでは家やビルが立ち並び、東京スカイツリーなどの高い建物も見える

■ どこからでも遊べる
・「現在地でスタート」で、いまいる場所の景色が出てくる（スマホを向けた方角から始まる）
・地図から好きな場所を選んだり、山の名前で山頂へ一気に飛んだり
・東京スカイツリー、あべのハルカスなど全国22か所の展望台からの眺めも
・コンパス機能をオンにすれば、スマホを向けた方角に景色がついてくる

■ 収録した山は約1,000座
・国土地理院「日本の主な山岳標高」の山を収録
・日本百名山・二百名山・三百名山は全国の地図で色分け
・高さ100m以上の主な建物・タワーもお題に

■ ゲームのルール
・1ゲーム10問。1問100点、はずすと減点
・違う山をタップすると「そこは〇〇です」と教えてくれる
・ヒントで方角と距離、パスで答えがわかる
・難易度は「かんたん」「ふつう」「むずかしい」の3つ
・タイムも計測。ベスト記録をめざそう
・結果は友だちにシェア

■ その他
・スイス風のヨーデルBGMと効果音
・日本語・英語対応
・景色の地形データを読み込むため、インターネット接続が必要です

登山の前の予習に、展望台からの答え合わせに。
いつもの景色に見えている山の名前を、探しに行きましょう。
```

---

## English

**App name** (max 30 characters)

```
Peak Finder: Japan Mountains
```

**Short description** (max 80 characters)

```
Identify mountains in real views of Japan. Can you find Mt. Fuji? A peak quiz!
```

**Full description**

```
Do you know the names of the mountains you can see?

Peak Finder is a mountain identification quiz for Japan. You get a quest like "Find Mt. Fuji!", and you have to find that peak in the view and tap it.
The mountain view is computed from the elevation data of the Geospatial Information Authority of Japan (GSI), so it shows what you would really see from that spot — great for hiking, trekking and travel in Japan.

■ A REAL VIEW, DRAWN FROM REAL TERRAIN
• Rebuilds the view from any place in Japan using GSI elevation data and aerial photos
• Accounts for the curvature of the Earth and atmospheric refraction, drawing mountains hundreds of kilometers away
• Seasonal snow, and distant ridges fading into blue haze
• Houses and buildings in cities, and landmarks like Tokyo Skytree

■ PLAY FROM ANYWHERE
• "Start here" shows the view from where you are, facing the direction your phone points
• Pick any place on the map, or jump straight to a summit by name
• Views from 22 observation decks, including Tokyo Skytree and Abeno Harukas
• Turn on the compass and the view follows your phone as you turn

■ ABOUT 1,000 MOUNTAINS
• Mountains from GSI's list of major mountains of Japan
• The 100, 200 and 300 Famous Mountains of Japan are color-coded on the map
• Major towers and skyscrapers over 100 m appear as quests too

■ HOW TO PLAY
• 10 questions per game, 100 points each; wrong taps cost points
• Tap the wrong mountain and you're told which one it is
• Use a hint for the direction and distance, or pass to see the answer
• Three levels: Easy, Normal and Hard
• Beat your best score and time, and share your results

■ ALSO
• Swiss-style yodel music and sound effects
• English and Japanese
• An internet connection is required to load terrain data

Study the peaks before a hike, or check what you saw from an observation deck.
Go and find the names of the mountains in your everyday view.
```

---

## ASO（検索で見つけてもらうための工夫）

Google Play にはキーワード欄がなく、アプリ名・簡単な説明・詳しい説明の文章から検索語が拾われます。

- **アプリ名**に、用途をそのまま表す検索語を入れた：「山座同定」（見えている山の名前を特定すること。登山者がこの用途で検索する言葉）、「クイズ」、「富士山」「百名山」
- **簡単な説明**（検索結果と一覧に出る）に、「山の名前」「山座同定」「富士山」「百名山」「クイズ」「景色」を入れた
- **詳しい説明**は、最初の数行（「もっと見る」の前に表示される部分）に主な検索語を集めた。ほかに「登山」「ハイキング」「展望台」「山頂」「地形」「標高」「パノラマ」に近い言葉を、自然な文章の中に入れた
- 同じ言葉を不自然にくり返すこと、「No.1」「最高」などの順位・評価の言葉、絵文字の多用は、Google Play のポリシー（メタデータのスパム）に反するので避けた
- **英語**は「Japan Mountains」「mountain identification」「peak」「Mt. Fuji」「hiking」「trekking」を入れた（「Peak Finder」は英語圏の同名アプリもあるため、「Japan Mountains」を付けて日本の山のアプリだと分かるようにした）
- 公開後は、Play Console の「ストアのパフォーマンス」で、どの検索語から来ているかを見て見直す

## Play Console「アプリのコンテンツ」の回答の目安

- **プライバシー ポリシー**: https://techgym.jp/privacy-policy/
- **広告**: 「はい、広告を含みます」
- **アプリのアクセス権**: 「制限なし（ログイン不要）」
- **ターゲット ユーザー**: 13 歳以上（13 歳未満を含めると広告に制限がかかる）
- **データ セーフティ**:
  - 位置情報: 「現在地でスタート」のときだけ端末の中で使い、送信・保存はしない（端末の外に出ないため「収集」には当たらない）。※ Play Console の定義で最終確認すること
  - Google AdMob が「デバイスまたはその他の ID（広告 ID）」と「アプリの操作（広告の表示・クリック）」を広告とアナリティクスの目的で収集・共有する。通信は暗号化されている。※ AdMob の公式ガイドに従って最終確認すること
- **コンテンツのレーティング**: 暴力・性的表現・ギャンブルなどはなし
- **カテゴリ**: ゲーム → パズル（またはトリビア）
