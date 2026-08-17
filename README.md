# SlimQuest

食事・体重・運動を素早く記録して、目標に向けた変化を見えるようにするPWAです。
2027年1月31日の結婚式に向けた減量のために作りました。

- **形式**: 純粋な HTML / CSS / JavaScript。ビルド不要、外部ライブラリなし
- **公開**: GitHub Pages
- **使い方**: Android の Chrome で開き、メニューから「ホーム画面に追加」
- **データ**: すべて端末内(IndexedDB と localStorage)。サーバーには何も送りません

## セットアップ(初回だけ)

1. GitHub に `slimquest` リポジトリを作り、このフォルダの中身を push する
2. リポジトリの Settings → Pages で、公開ブランチを `main` / `(root)` に設定する
3. 数分後に `https://<ユーザー名>.github.io/slimquest/` で開けるようになる
4. Android の Chrome でそのURLを開き、⋮ メニュー →「ホーム画面に追加」

カメラを使う機能(今後追加するバーコード読み取り・お腹の定点撮影)には HTTPS が必要です。
GitHub Pages は HTTPS なのでそのまま動きます。

## いまできること (v0.1.0 / Phase 1)

- **食事の記録**: よく食べるものリストと、かな検索(「からあげ」「カラアゲ」「唐揚げ」のどれでも引ける)。
  タップ → 倍率(0.5/1/1.5/2)を選ぶだけで記録。同梱の食品データ約170件から探せます
- **新しいメニューの登録**: 名前・基準量・カロリー・PFC を手入力して保存。次回からは検索で出てきます
- **体重の記録とグラフ**: 実測・7日移動平均・目標線・健康ペース帯(週0.5〜0.8kg)を1枚に表示
- **運動の記録**: METs方式のプリセット(自転車通勤・水泳・社交ダンスなど)。自転車通勤は平日に自動計上できます
- **1日のカロリー収支**: 基礎代謝 × 1.2 + 運動 − 目標赤字 を目安として、残りカロリーをリングで表示
- **食事日記**: 日送りで過去の記録を確認・削除
- **連続記録とバッジ**

## これから作るもの

| Phase | 内容 |
|---|---|
| 2 | AIによるカロリー推定(Claude / OpenAI)、Web検索での市販品登録、バーコード読み取り、レシピ登録(2人分作って1人分食べる) |
| 3 | 手持ち食材リスト、食材からの料理提案(材料ハイライト)、買い物チェックリスト、お腹の定点撮影と変化の比較 |
| 4 | ZIPバックアップ / 復元、仕上げ |

## ファイル構成

```
slimquest/
├── index.html          全画面のHTML + エラー捕捉
├── sw.js               Service Worker(ネットワーク優先)
├── manifest.json       PWA設定
├── version.json        更新検出用(sync-version.js が生成)
├── css/style.css
├── js/
│   ├── version.js      バージョンと更新履歴
│   ├── db.js           IndexedDB ヘルパー
│   ├── foods.js        同梱の食品データ(約170件)
│   ├── calc.js         日付・かな正規化・BMR・METs などの純粋関数
│   ├── menus.js        メニューDB(検索・頻出ランキング)
│   ├── meals.js        食事の記録・食事日記
│   ├── weight.js       体重の記録とSVGグラフ
│   ├── exercise.js     運動の記録
│   ├── streak.js       連続記録とバッジ
│   └── app.js          画面遷移・プロフィール・ホーム(最後に読み込む)
├── tools/sync-version.js
└── docs/implementation-notes.md   実装の詳細(作業前にまず読む)
```

## リリース手順

1. `js/version.js` の `APP_VERSION` を上げ、`CHANGELOG` の**先頭**に変更を追加する
2. `node tools/sync-version.js` を実行(version.json の更新と、JS/CSS参照への `?v=` 付与)
3. `sw.js` の `CACHE_VERSION` を上げる
4. `docs/implementation-notes.md` を更新する
5. commit して push

## 注意

カロリーや消費エネルギーはすべて概算です。医学的な助言ではありません。
体調を見ながら無理のない範囲で使ってください。
