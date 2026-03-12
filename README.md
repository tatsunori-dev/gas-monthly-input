# gas-monthly-input

軽貨物配送の売上・稼働実績を管理するWebアプリ。  
Google Apps Script（GAS）+ HTML 1ファイル構成で、スマホ・PCどちらからでも使えます。

## 概要

もともと Streamlit（Python）で作っていた売上管理アプリを、  
GAS + HTML に移植したバージョンです。  
データベースは Supabase（PostgreSQL）を使用しています。

## 機能

- **売上・稼働入力** — 日付ごとに売上・稼働時間・取引先別売上を入力
- **データ一覧** — 月別フィルタ・CSV出力・削除
- **月次レポート** — 月目標達成状況・時給分析・季節評価・TOP5/WORST5
- **年次レポート** — 年間目標達成率・月別サマリ・年間TOP5/WORST5
- **CSVインポート** — バックアップCSVからDBへの復元
- **2025年データ対応** — 過去データはGitHub上のCSVから自動読み込み・マージ

## 技術スタック

| 項目 | 内容 |
|------|------|
| バックエンド | Google Apps Script (GAS) |
| フロントエンド | HTML + Vanilla JS（1ファイル） |
| データベース | Supabase (PostgreSQL) |
| 認証 | HMAC-SHA256 セッショントークン |
| レスポンシブ | JS幅検知によるSP/PCレイアウト切り替え |

## 画面

- **スマホ** — 下部固定ナビ・縦1列レイアウト
- **PC** — 上部ヘッダー・タブ切り替えレイアウト

## セットアップ

### 1. Supabase

`records` テーブルを作成し、以下の列を用意します。
> ⚠️ 以下はサンプルです。実際の列名・取引先名は各自の運用に合わせて変更してください。
```

日付（text, PK）, 合計売上, 合計h, frex h, fresh h, 他 h, 合計時給,
5h+, 警告, U, 出, R, menu, しょんぴ, CW, Afrex, Afresh, ハコベル, pickg, その他, メモ
```

### 2. GASプロジェクト

1. [Google Apps Script](https://script.google.com) で新規プロジェクト作成
2. `Code.gs` と `index.html` をそれぞれ貼り付け
3. スクリプトプロパティに以下を設定

| キー | 内容 |
|------|------|
| `SUPABASE_URL` | SupabaseプロジェクトURL |
| `SUPABASE_ANON_KEY` | Supabase service_roleキー |
| `APP_USERNAME` | ログインユーザー名 |
| `APP_PASSWORD` | ログインパスワード |
| `SESSION_SECRET` | 任意のランダム文字列 |

4. デプロイ → ウェブアプリとして公開（アクセス：全員）

## スクリーンショット

### 1. ログイン
<img width="1332" height="1045" alt="ログイン" src="https://github.com/user-attachments/assets/4a6ff2ed-b4ff-4428-9f10-5aa535257e8d" />

### 2. 入力タブ
<img width="1356" height="1058" alt="入力タブ" src="https://github.com/user-attachments/assets/e901011b-c5ca-44b9-afd2-0c68bf09b2c6" />

### 3. データタブ
<img width="1336" height="1045" alt="データタブ" src="https://github.com/user-attachments/assets/cf613737-bb9c-4053-98a9-e24f9641c098" />

### 4. インポートタブ
<img width="1350" height="678" alt="インポートタブ" src="https://github.com/user-attachments/assets/ca615fe5-ebae-4fe6-a841-1295d4943a84" />

### 5. レポートタブ
<img width="1347" height="661" alt="レポートタブ" src="https://github.com/user-attachments/assets/8d28e4d0-db12-47f8-812e-48d1b1810f70" />

## 関連リポジトリ

- [streamlit-monthly-input](https://github.com/tatsunori-dev/streamlit-monthly-input) — Streamlit版（同じDBを共有）
