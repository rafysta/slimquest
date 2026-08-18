# SlimQuest 実装ノート

**対象バージョン: v0.2.0 (2026-08-18) / Phase 1 + セット登録・AI検索**

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
| `diary` | 食事日記(日送り・削除) | ✅ |
| `weight` | 体重の記録とグラフ | ✅ |
| `exercise` | 運動の記録 | ✅ |
| `badges` | 連続記録とバッジ | ✅ |
| `settings` | プロフィール・目標・自動計上・データ削除 | ✅ |
| `about` | バージョン・更新履歴・完全リセット | ✅ |
| `barcode` | バーコード読み取り | ⬜ Phase 2 |
| `recipe-edit` | レシピ登録(何人分作るか) | ⬜ Phase 2 |
| `pantry` | 手持ち食材リスト | ⬜ Phase 3 |
| `suggest` | 食材からの料理提案 | ⬜ Phase 3 |
| `shopping` | 買い物チェックリスト | ⬜ Phase 3 |
| `belly` / `belly-view` | お腹の定点撮影と比較 | ⬜ Phase 3 |

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
| `sq_ai_key` | Anthropic APIキー(AI検索用。設定画面で登録。データ全消去では消さない) |
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
| `photos` | id (auto) | date | お腹の写真(Phase 3) |
| `shopping` | id (auto) | - | 買い物リスト(Phase 3) |
| `pantry` | id (auto) | - | 手持ち食材(Phase 3) |
| `ingWords` | name | - | 食材の入力履歴辞書(Phase 3) |

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

## 4. 読み込み順序

```
version → db → foods → calc → menus → ai → meals → weight → exercise → streak → app
```

(`ai.js` は `meals.js` より前。`AiUI` を `Meals.openNew` が呼ぶため)

`app.js` が全モジュールに依存するため必ず最後。Phase 2 以降で追加するファイルの位置:

```
version → db → foods → calc → ai → menus → meals → recipes → barcode
        → weight → exercise → pantry → suggest → shopping → belly → streak → backup → app
```

追加したら `sw.js` の `APP_SHELL` と `index.html` の `<script>` の両方に足すこと。

---

## 5. テスト

`/tmp/test-slimquest.js` に jsdom + fake-indexeddb による自動テストがある(91項目)。
**セッションが変わると消えるため、大きな変更のときは作り直すこと。** カバーしている範囲:

- 全JSファイルの構文チェックと起動時エラーの有無
- `data-nav` の飛び先がすべて存在するか
- 日付計算(月またぎ・年またぎ)、かな正規化、BMR、METs、目標赤字、ペース帯
- メニュー検索(ひらがな/カタカナ/漢字、前方一致の優先)、頻出ランキング
- 食事の記録・倍率計算・日別集計・削除
- 体重の保存/上書き・移動平均・SVG生成(NaN混入の検出)
- 運動の記録・自動計上が1日1回であること
- ストリークの増減とバッジ解除
- 各画面の描画とXSSエスケープ

実行: `node /tmp/test-slimquest.js`

実機でしか確認できないもの(カメラ・バーコード・ホーム画面への追加)は Phase 2/3 で
チェックリストにする。

---

## 6. リリース手順

1. `js/version.js` の `APP_VERSION` を上げ、`CHANGELOG` の**先頭**に追加(不一致だとツールが止まる)
2. `node tools/sync-version.js`
3. `sw.js` の `CACHE_VERSION` を上げる
4. このファイルを更新
5. commit → push

---

## 7. 次に作るもの

### Phase 2 — AI と入力強化

- `js/ai.js`(ConfQuest の ai.js を流用): Claude / OpenAI 切替、**JSONモード**での構造化出力、
  **Web検索ツール付き呼び出し**。APIキーは設定画面から localStorage へ
- `meal-new` に「AIに推定させる」「Webで調べる」ボタンを追加(いまは手入力のみ)
- `js/barcode.js`: `BarcodeDetector`(Android Chrome標準、EAN-13)で読み取り →
  **① menus の jan 一致 → ② Open Food Facts API → ③ AIのWeb検索 → ④ 手動入力** の順に照会。
  どの経路でも結果は menus に `jan` 付きで保存し、次回は①で即ヒットさせる。
  Open Food Facts は日本の商品の収録が薄いので、空でもエラーにせず静かに③へ進むこと
- `js/recipes.js`: 食材と分量からレシピを登録。**何人分作るかの既定値は2**、
  記録されるのは合計÷人数の1人分

### Phase 3 — 提案・買い物・写真

- `js/pantry.js`: 手持ち食材リスト。頻出食材チップ + インクリメンタル検索。
  食材の入力履歴(`ingWords`)は手持ち・レシピ・買い物リストの3箇所で共有する
- `js/suggest.js`: **手持ち食材を起点に** AI が料理候補3〜5件を提案。
  各候補に 1人分の概算カロリー・PFC / 材料リスト / ひとこと理由。
  材料のうち**手持ちにあるものをハイライト**(かな正規化 + 部分一致で「豚肉」と「豚こま切れ肉」も当てる)。
  採用 → レシピ登録 + **足りない材料だけ**買い物リストへ
- `js/shopping.js`: チェックリスト。チェックした食材を「手持ちに移す」導線
- `js/belly.js`: ガイド枠 + 前回写真の半透明重ねで定点撮影 → JPEG圧縮して photos へ。
  スライダーと連続再生で変化を比較

### Phase 4 — 仕上げ

- `js/backup.js`(ConfQuest の MiniZip を流用): `sq_*` + IndexedDB 全ストア + 写真を
  1つのZIPに。Web Share で Nextcloud へ送れるようにする
