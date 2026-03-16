# gas-monthly-input

軽貨物ドライバー向け **月次入力・レポ生成ツール**（Google Apps Script）

ブラウザだけで動くシンプルな月次入力アプリです。
インストール不要。GAS にデプロイしてアクセスするだけで使えます。

---

## 主な機能

- ログイン認証（セッショントークン管理）
- 日次入力・保存（Supabase へのリアルタイム保存）
- GitHub 上の過去 CSV を自動読み込み・マージ（2025年データ対応）
- 月次レポ生成（売上 / 稼働時間 / 時給 / TOP・WORST 分析）
- 年次レポ生成（年間目標達成状況・月別サマリ）
- 月ごとの個別目標管理
- CSV インポート / データ削除

---

## ファイル構成

| ファイル | 内容 |
|---------|------|
| `Code.gs` | バックエンド処理（Supabase 連携・レポ生成ロジック） |
| `index.html` | フロントエンド UI（HTML / CSS / JavaScript） |

---

## 技術構成

| 項目 | 内容 |
|------|------|
| バックエンド | Google Apps Script（GAS） |
| フロントエンド | HTML / CSS / JavaScript |
| DB | Supabase（PostgreSQL）REST API |
| データ連携 | GitHub raw CSV 自動読み込み・マージ |
| 認証 | セッショントークン管理 |

---

## セットアップ

### 1. GAS にデプロイ

1. [script.google.com](https://script.google.com) で新しいプロジェクトを作成
2. `Code.gs` と `index.html` の内容をそれぞれ貼り付け
3. **デプロイ → 新しいデプロイ** → 種類: ウェブアプリ → 「全員」アクセス可に設定

### 2. スクリプトプロパティを設定

**プロジェクトの設定 → スクリプトプロパティ** に以下を追加：

| プロパティ名 | 内容 |
|------------|------|
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase の anon/public キー |
| `APP_USERNAME` | ログインユーザー名 |
| `APP_PASSWORD` | ログインパスワード |
| `SESSION_SECRET` | 任意のランダム文字列 |

