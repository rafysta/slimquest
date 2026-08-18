# SlimQuest 実装ノート

**対象バージョン: v0.4.0 (2026-08-18) / Phase 1 + Phase 2 + Phase 3 完了**

新しい会話を始めるときに、まずこのファイルを読めば現状が把握できるようにしたものです。
機能を追加・変更したら、このファイルも必ず更新してください。

---

## 0. プロジェクト概要

| 項目 | 内容 |
|---|---|
| 目的 | 2027-01-31 の結婚式に向けた減量(開始 2026-08-17: 173cm / 81kg → 目標 60kg)。特にお腹周り |
| 形式 | PWA(純粋な HTML/CSS/JavaScript、ビルド不要、外部ライブラリなし) |
| 公開 | GitHub Pages (`rafysta/slimquest`)。Android の Chrome でホーム画面に追加 |
| データ | 端末内のみ。設定は localStorage(`sq_*`)、記録は IndexedDB(`slimquest`) |
| 利用者 | 本人1名。パートナーと2人暮らしで、調理は本人。**2人分作って食べるのは1人分**が基本 |
| 方針 | 厳密な栄養計算はしない。概算で良いので、入力が速く続けられることを最優先 |

### 生活パターン(プリセットの根拠)

毎日 自転車通勤 / ジムでプール(水泳) / 週1回 社交ダンス / 昼食・夕食は自炊

### 決まっていること

- 食事入力は**メニューDB+入力補助**方式。**写真から料理のカロリーを解析する機能は作らない**(2026-08-17 決定)
- 栄養素は カロリー + PFC。ゲーミフィケーションは軽め(ストリークとバッジのみ、ジェム/クエスト/ショップは作らない)
- ヘルスケア・スマートウォッチ連携はしない(未使用のため)

---

## 1. 画面一覧

`index.html` 内の `<section id="screen-XXX">` を `showScreen('XXX')` で切り替える単一ページ構成。
`data-nav="XXX"` 属性を持つ要素は自動で遷移ボタンになる(`bindEvents()` で一括登録)。

| ID | 画面 | 状態 |
|---|---|---|
| `home` | ホーム(収支リング・カウントダウン・体重・ストリーク) | ✅ |
| `setup` | 初回設定ウィザード | ✅ |
| `meal-add` | 食事入力(区分タブ・検索・よく食べるもの) | ✅ |
| `meal-new` | 新規メニュー登録(手動 + AI検索で候補入力) | ✅ v0.2.0 でAI検索を追加 |
| `meal-set` | セット(組み合わせ)メニューの作成 | ✅ v0.2.0 |
| `recipe-edit` | レシピ登録(材料 + 何人分) | ✅ v0.3.0 |
| `barcode` | バーコード読み取り | ✅ v0.3.0 |
| `diary` | 食事日記(日送り・削除) | ✅ |
| `weight` | 体重の記録とグラフ | ✅ |
| `exercise` | 運動の記録 | ✅ |
| `badges` | 連続記録とバッジ | ✅ |
| `settings` | プロフィール・目標・自動計上・データ削除 | ✅ |
| `about` | バージョン・更新履歴・完全リセット | ✅ |
| `pantry` | 手持ち食材リスト | ✅ v0.4.0 |
| `suggest` | 食材からの献立提案 | ✅ v0.4.0 |
| `shopping` | 買い物チェックリスト | ✅ v0.4.0 |
| `belly` / `belly-view` | お腹の定点撮影と変化ビュー | ✅ v0.4.0 |

画面ではないUI: `#amount-sheet`(量の指定シート)、`#modal-overlay`(appAlert/appConfirm)。

---

## 2. データ

### localStorage

| キー | 内容 |
|---|---|
| `sq_profile` | 身長・生年月・性別・開始体重/開始日・目標体重/目標日・通勤の自動計上設定 |
| `sq_use` | メニューの使用履歴 `{ [menuId]: { n, last, slots: {b,l,d,s} } }` |
| `sq_streak` | `{count, best, last, total}` |
| `sq_badges` | `{ [badgeId]: 解除日 }` |
| `sq_auto_last` | 自転車通勤を自動計上した最後の日(二重計上の防止) |
| `sq_ai_key` | Anthropic APIキー(AI検索・バーコード照会用。設定画面で登録。データ全消去では消さない) |
| (Phase 2) `sq_claude_key` / `sq_openai_key` / `sq_ai_provider` / `sq_ai_model` | AI設定 |

**同梱データの使用回数を localStorage に置いている理由**: foods.js の食品は IndexedDB に入れていない
(アプリ更新のたびに作り直すため)。メニュー本体と使用履歴を分けることで、同梱データにも
自作メニューにも同じ仕組みで「よく食べるもの」を出せる。同梱データの id は負の数。

### IndexedDB(DB名 `slimquest`、version 1)

将来の機能ぶんのストアも最初から作ってあるので、Phase 2 以降でスキーマ変更は不要。

| ストア | keyPath | index | 内容 |
|---|---|---|---|
| `menus` | id (auto) | jan | メニューDB。`{name, kana, base, kcal, p, f, c, origin, jan?, ingredients?, serves?}` |
| `meals` | id (auto) | date | 食事記録。`{date, slot, menuId, name, base, factor, kcal, p, f2, c}` |
| `weights` | date | - | `{date, weight, bodyFat?}` 1日1件で上書き |
| `exercises` | id (auto) | date | `{date, type, mets, minutes, kcal, auto}` |
| `photos` | id (auto) | date | お腹の写真。`{date, blob(JPEG), w, h}` |
| `shopping` | id (auto) | - | 買い物リスト。`{name, amount, checked, addedAt, source}` |
| `pantry` | id (auto) | - | 手持ち食材。`{name, kana, addedAt}` |
| `ingWords` | name | - | 食材の入力履歴辞書。`{name, kana, useCount, lastUsed}` |

**注意**: `meals` の脂質フィールドは `f2`。レコード自体の倍率が `factor` で、脂質 `f` と名前が
衝突しないようにしている(`Meals.totals()` が `m.f2` を読む)。

### 同梱食品データ(js/foods.js)

172件。`[名前, 読み, 基準量, kcal, P, F, C]` の配列で持ち、`FOODS` として menus と同じ形に展開する。
基準量は「よく食べる1回ぶん」(例: ごはん = 茶碗1杯150g)。日本食品標準成分表(八訂)ベースの概算。

---

## 3. 主要な仕組み

### 食事入力の速さ(このアプリの心臓部)

1. 画面を開くと `Meals.slotByHour()` が時間帯から区分を自動選択(〜10時=朝 / 〜15時=昼 / 〜22時=夕 / それ以降=間食)
2. 検索が空なら `Menus.frequent(slot)` = **全体の使用回数 + その区分での回数×3 + 最近度**で並べたリスト
3. 検索は `Menus.search()`。名前と読みの両方を `Calc.norm()` で正規化して照合し、
   前方一致(2点)→ 部分一致(1点)→ 使用回数 の順に並べる
4. タップ → 量シートで倍率を選ぶ → 記録。**2〜3タップで完了する**

`Calc.norm()` はカタカナ→ひらがな、全角→半角、記号と空白の除去を行う。
これで「からあげ / カラアゲ / 唐揚げ」がすべて同じ候補に当たる(漢字は名前側で一致)。

### カロリー収支

```
基礎消費 = BMR(Mifflin-St Jeor) × 1.2
目標摂取 = 基礎消費 + 記録した運動 − 目標赤字   (下限 1200kcal)
ホームの表示 = 目標摂取 − 実際の摂取
```

**活動係数を1.2に固定している理由**: 「活動的(1.55)」などを選ばせると、運動記録と二重に
計上されて赤字が実際より甘くなる。低め固定 + 運動を個別加算にすることで、
運動を記録するほど正しく反映される設計にした。

**目標赤字に上限600kcalを設けている理由**: 81→60kg を 167日で達成するには毎日約900kcalの
赤字が必要になるが、これは推奨ペースを超えている。上限で頭打ちにし、設定画面と体重グラフで
「健康的なペースだとどこまで行けるか」を併記する。

### 体重グラフ(js/weight.js の `svg()`)

外部ライブラリなしで SVG 文字列を組み立てる。描くもの:
実測の折れ線と点(青)/ 7日移動平均(緑・太。**実際に見るべき線**)/ 目標線(黄・破線)/
健康ペース帯(週0.5〜0.8kgで減った場合の範囲、緑の薄い帯)/ 今日の縦線。

表示範囲は 1ヶ月 / 3ヶ月 / 全期間。全期間は「開始日と最初の記録の早い方 〜 目標日」。

### 自転車通勤の自動計上

設定でONにすると、平日の初回起動時に1回だけ `exercises` に `auto: true` で追加する。
`sq_auto_last` に処理した日を記録して二重計上を防ぐ。休んだ日は食事日記から × で消せる。

### 更新の仕組み(ConfQuest から流用)

- `sw.js` は同一オリジンを `cache: 'no-store'` で取得し、HTTPキャッシュを迂回する
- `tools/sync-version.js` が **index.html の全JS/CSS参照に `?v=バージョン` を自動付与**する。
  これにより「古いHTML + 新しいJS」の混在が構造的に起こらない
- 起動時に `version.json` を照合し、新版があればホームに通知バナーを出す
- API(api.anthropic.com / api.openai.com)と Open Food Facts は SW を通さない

### UIの規約(ConfQuest から引き継ぎ)

- **`alert` / `confirm` は使わない**。`appAlert()` / `appConfirm()`(アプリ内モーダル)を使う
- 一時通知は `showToast()`
- 画面に出す文字列は必ず `escapeHtml()` を通す
- エラーは画面上部の赤いバナーに出す。`window.__earlyErrors` で読み込み中のエラーも拾う

---

### セットメニューと AI検索(v0.2.0 追加)

**セット(`js/meals.js` の `SetBuilder`)** — 「シリアル+プロテイン+牛乳」のように
いつも一緒に食べる組み合わせを1つのメニューとして登録する。

- 保存形式は普通のメニューと同じ menus レコードで `origin: 'set'`、`base: '1セット'`。
  合計 kcal/PFC は登録時に構成要素から計算して本体に持つ(記録経路は既存のまま)
- `ingredients: [{menuId, name, base, factor, kcal, p, f, c}]` に構成要素のスナップショットを保持。
  構成要素側を後から変えてもセットの値は変わらない(記録の一貫性を優先)
- 量は構成要素ごとに −/＋ で 0.25 刻み。食事日記には1行で入り、内訳は量シート(`#as-ing`)に表示
- 構成要素は単品のメニューのまま残るので、別の組み合わせ(シリアル+牛乳+果物など)の日にも対応できる
- セット作成中に見つからない食品は `Meals.openNew(prefill, forSet=true)` でその場で登録して
  セットに戻る(`Meals.newForSet` フラグ。meal-new の戻るボタン `#mn-back` も同フラグで分岐)
- セットの入れ子は不可(SetBuilder の検索結果から `origin === 'set'` を除外)

**AI検索(`js/ai.js`)** — 新規メニュー登録画面の「🔍 ネットで調べて入力」ボタン。

- `AI.searchFood(query, answers)` が Anthropic Messages API を直接 fetch
  (`anthropic-dangerous-direct-browser-access` ヘッダーでブラウザから呼ぶ)。
  Web検索ツール `web_search_20250305`(max_uses: 4)付き。モデルは `AI.MODEL` 定数
- 応答は JSON 1個を指示: `{candidates: [{name, base, kcal, p, f, c, note}], questions: [{q, options}]}`。
  情報が足りないときは questions が返り、選択肢チップ or 自由入力(`AiUI`)で answers に積んで再照会
- 候補をタップするとフォームに値が入るだけで、登録は従来どおりユーザーが確認して行う。
  このとき `origin: 'ai'` で保存(`#mn-name` の dataset.origin 経由)
- APIキー未設定なら設定画面へ誘導。キーがなくてもアプリの他機能は全部動く
- SW は `api.anthropic.com` をパススルー済み(v0.1.0 から準備されていた)

### レシピとバーコード(v0.3.0 / Phase 2 追加)

**組み合わせの共通部品(`js/combo.js`)** — セットとレシピは「複数のメニューを選んで
1つのメニューを作る」点がまったく同じなので、`makeComboBuilder(cfg)` に一本化した。
画面ごとの違いは cfg だけ:

| | セット (`SetBuilder`) | レシピ (`Recipes`) |
|---|---|---|
| prefix / 画面 | `ms` / `meal-set` | `rc` / `recipe-edit` |
| origin / base | `set` / `1セット` | `recipe` / `1人分` |
| 人数で割る | しない | する(既定 **2**) |
| 必要な部品数 | 2つ以上 | 1つ以上 |

要素IDは `#<prefix>-name / -items / -total / -search / -search-clear / -results`(+レシピは `-serves`)
の規約で引く。配線は `app.js` の `bindCombo()` が両方まとめて行う。

**レシピ(`js/recipes.js`)**

- 「2人分作って食べるのは1人分」が生活の前提なので、何人分作るかの既定値は 2
- menus に保存される kcal/PFC は **合計 ÷ 人数 = 1人分**。`serves` に人数を持つ
- `ingredients` には **作った全体ぶん** の材料を入れる(1人分に割らない)。
  Phase 3 の買い物リストがそのまま材料として使えるようにするため
- 量シートの内訳は `serves > 1` なら「材料(2人分)」と出す(1人分の値との対応を誤解させないため)
- レシピはセットの部品にできる(肉じゃが + ごはん など)。逆にセットは部品にできない

**バーコード(`js/barcode.js`)**

照会は4段階。上から順に試し、見つかった時点で止める:

1. **menus の jan 一致** … 通信なしで即ヒットし、そのまま量シートを開く(これが本命の経路)
2. **Open Food Facts** … `/api/v2/product/{code}.json`。100gあたりの値なので基準量は `100g`。
   日本の商品は収録が薄いため、未収録・カロリー空・通信失敗はすべて **静かに次へ進む**
3. **AIのWeb検索** … `AI.searchByBarcode(code)`。APIキーがあるときだけ。
   **特定できないときは候補を空で返させる**(存在しない商品を作られると気付かずに登録されるため)
4. **手入力** … 名前空 + jan だけ入れて `meal-new` を開く

どの経路でも `Meals.openNew({..., jan})` 経由でユーザーが確認してから保存し、menus に `jan` が付く。
次回からは①で即ヒットする。

- 読み取りは Android Chrome 標準の `BarcodeDetector`(外部ライブラリなし)。
  `getSupportedFormats()` で端末が対応する形式に絞ってから生成する
- **非対応端末では番号の手入力にフォールバック**するので機能自体は使える
- カメラは `showScreen()` の先頭で `Barcode.stop()` を呼び、**barcode 画面以外へ移ったら必ず停止**する
- SW は `openfoodfacts.org` をパススルー済み(v0.1.0 から準備されていた)

### 手持ち食材・献立提案・買い物リスト(v0.4.0 / Phase 3 追加)

この3つは1本の輪になっている。**手持ち食材 → 献立提案 → 足りない材料が買い物リスト →
買えたら手持ちへ戻す**。どこか1つだけ使っても成立するが、続けて回すほど入力が減る。

**食材の入力履歴(`IngWords`、js/pantry.js)** — `ingWords` ストア(keyPath: name)。

- 手持ち食材・買い物リスト・提案の採用、すべての食材入力から `IngWords.touch()` で学習する
- `frequent()` = 回数 + 最近度。入力欄が空のときのチップに使う
- `suggest(q)` = 履歴 → 同梱食品(foods.js)の順で前方一致優先。文字を入れたときの候補
- 画面を2段構え(空ならよく使うもの / 入力があれば候補)にしているのは、
  **食材名を毎回タイプさせると続かない**ため

**手持ち食材(`Pantry`)** — 数量は持たない。「あるか無いか」だけで提案には十分だから。

- `reading(name)`: 同梱食品に名前か読みが一致すればその**読み**を返す。
  これで「玉ねぎ」と「たまねぎ」が同じ食材になる(ユーザーが打った名前には読みがないため)
- `same(a, b)`: ①完全一致 ②どちらかがどちらかを含む ③**飛ばし一致**(文字が順番どおり現れる)。
  ③があるので AI の「豚肉」が手持ちの「豚こま切れ肉」に当たる。
  1文字の食材(米・塩・油)が何にでも当たらないよう、②③は2文字以上のときだけ許す
- `matches(材料名)`: 表記どうし・読みどうしの両方で `same()` を試し、当たった手持ちを返す

**献立提案(`js/suggest.js` + `AI.suggestDishes`)**

- プロンプトに渡すもの: 手持ち食材 / 直近3日の食事名(同じ料理の連続を避ける) /
  何人分作るか / 1食の目安kcal(`Profile.targetIntake() ÷ 3`)
- 応答は `{dishes:[{name, kcal, p, f, c, ingredients:[{name, amount}], reason, steps}]}`。
  kcal/PFC は**1人分**、材料は**作った全体ぶん**の分量
- **Web検索ツールは付けない**(`AI._call(system, user, {web: false})`)。
  ここは調べ物ではなく考える用途で、検索を付けても待ち時間が伸びるだけのため
- 表示は材料の色分けが肝。手持ち=緑(`.ing.have`)/ 不足=グレー破線(`.ing.miss`)
- 「これにする」= menus に `origin:'suggest'` `base:'1人分'` `serves` 付きで登録 +
  **不足分だけ** shopping へ + `IngWords` 学習 + バッジ `suggest` 解除
- 「材料を選んで正確に登録する」= 材料名を `Menus.search()` で当てはめて `recipe-edit` を開く。
  カロリーをAIの概算ではなく食品データから積み上げたいときの経路

**買い物リスト(`js/shopping.js`)**

- チェック済みは**消さずに下へ沈める**(買い忘れの確認ができるように)
- 「買えたものを手持ち食材に移す」で pantry へ移してリストから消す。これで輪が閉じる
- 未チェックの同名は重複追加しない(提案を続けて採用しても増えない)

### お腹の定点撮影(v0.4.0 / `js/belly.js`)

体重は水分で1〜2kg動くので、見た目の変化のほうが正直な記録になる。ただし
**同じ位置・同じ距離で撮れていないと比較にならない**ので、プレビューに
ガイド枠 + **前回写真の半透明オーバーレイ**(濃さはスライダーで調整)を重ねている。

- 保存は長辺1280px・JPEG品質0.8(1枚150〜300KB)。毎日撮っても半年で50MB前後
- カメラは `showScreen()` の先頭で `Belly.stop()`。**belly 画面以外へ移ったら必ず停止**する
  (バーコードと同じ扱い)
- カメラが使えない環境では `<input type="file" capture>` にフォールバック
- 写真は `photos` ストアに Blob のまま置き、**起動時には読まない**(画面を開いたときだけ `load()`)
- `URL.createObjectURL` したものは `_urls` に積み、描画のたびに `_freeUrls()` で解放する
- 変化ビューはスライダー + 連続再生(450ms)。日付・枚数・その日の体重(なければ直前の記録)を重ねる

## 4. 読み込み順序

```
version → db → foods → calc → menus → ai → combo → meals → recipes → barcode
        → weight → exercise → pantry → shopping → suggest → belly → streak → app
```

`ai.js` と `combo.js` は `meals.js` より前(`AiUI` を `Meals.openNew` が、
`makeComboBuilder` を `SetBuilder` の定義が使うため)。
`recipes.js` / `barcode.js` は `meals.js` より後(`Meals` を参照するため)。
`suggest.js` は `pantry.js` / `shopping.js` / `recipes.js` の後。

`app.js` が全モジュールに依存するため必ず最後。Phase 4 で追加する `backup.js` は
`streak.js` と `app.js` の間に入れる。

追加したら `sw.js` の `APP_SHELL` と `index.html` の `<script>` の両方に足すこと
(`?v=` は `node tools/sync-version.js` が自動で付ける)。

---

## 5. テスト

`/tmp/test-slimquest.js` に jsdom + fake-indexeddb による自動テストがある(**182項目**、
v0.4.0 で作り直した)。**セッションが変わると消えるため、大きな変更のときは作り直すこと。**

作り直すときの注意(はまりどころ):

- jsdom は `runScripts: 'dangerously'` にして `<script>` 要素として評価する。
  `win.eval()` だと `const` 宣言が eval スコープに閉じて `Calc` すら見えない
- 各ファイルの `const` はグローバル**字句**束縛なので `window.Calc` にはならない。
  最後に `['Calc', ...].forEach(n => window[n] = eval(n))` を流すブリッジを入れる
- `appAlert` / `appConfirm` はボタンが押されるまで解決しないので、テストでは差し替える

カバーしている範囲:

- 全JSファイルの構文チェックと起動時エラーの有無、`data-nav` の飛び先の存在
- index.html / sw.js の APP_SHELL / version.json / CHANGELOG の整合(読み込み漏れの検出)
- 日付計算(月またぎ・年またぎ)、かな正規化、BMR、METs、目標赤字、ペース帯
- メニュー検索(ひらがな/カタカナ/漢字、前方一致の優先)、頻出ランキング
- 食事の記録・倍率計算・日別集計・削除、セット/レシピの合計と人数割り
- 体重の保存/上書き・移動平均・SVG生成(NaN混入の検出)
- 運動の記録・自動計上が1日1回であること、ストリークの増減とバッジ解除
- 手持ち食材の重複防止・削除、`matches()` の一致/不一致(「豚肉」↔「豚こま切れ肉」、1文字の誤爆)
- 入力履歴の学習・補完(履歴と同梱食品の両方から)
- 買い物リストの重複防止・チェックで下に沈む・手持ちへの移動・チェック済み一括削除
- 献立提案の材料ハイライト・採用時のメニュー登録と不足材料の買い物リスト投入・料理名のエスケープ
- 写真の縮小サイズ計算・保存/削除・キャプション・スライダーの範囲・画面を離れるとカメラが止まること
- 各画面の描画とXSSエスケープ、データ全消去の対象ストア

実行: `node /tmp/test-slimquest.js`

実機でしか確認できないもの(カメラ・バーコード・ホーム画面への追加)は下のチェックリスト。

### 実機(Android Chrome)確認チェックリスト

- [ ] ホーム画面に追加できる / 起動時にスプラッシュが出る
- [ ] バーコード: カメラが起動し、JANを読んで商品が出る。画面を離れるとカメラが消灯する
- [ ] お腹の撮影: カメラ起動 → ガイド枠と前回写真が重なる → 撮影して保存される
- [ ] お腹の撮影: 画面を離れるとカメラが消灯する / 変化ビューで再生できる
- [ ] AI検索と献立提案が通る(APIキー設定後)
- [ ] 機内モードでも起動して記録できる(SWのオフライン動作)

---

## 6. リリース手順

1. `js/version.js` の `APP_VERSION` を上げ、`CHANGELOG` の**先頭**に追加(不一致だとツールが止まる)
2. `node tools/sync-version.js`
3. `sw.js` の `CACHE_VERSION` を上げる
4. このファイルを更新
5. commit → push

---

## 7. 次に作るもの

(Phase 1 / Phase 2 / Phase 3 は完了。残りは Phase 4)

### Phase 4 — 仕上げ

- `js/backup.js`(ConfQuest の MiniZip を流用): `sq_*` + IndexedDB 全ストア + 写真を
  1つのZIPに。Web Share で Nextcloud へ送れるようにする。**写真が入るので容量に注意**
  (現状バックアップ手段がないので、実データが増える前に作っておきたい)
- 設定画面の「バックアップ機能は今後のバージョンで追加します」の注記を差し替える

### 積み残し(気づいたら直す)

- 登録済みメニュー(レシピ・セット)の**編集と削除の画面がない**。
  `Menus.update()` / `Menus.remove()` は用意してあるが、そこへ行く導線がまだない
- 献立提案の採用で作った menus は AI の概算値なので、あとから実測に直す導線があるとよい
- 食事日記から過去日への追加ができない(今日ぶんの記録のみ)
