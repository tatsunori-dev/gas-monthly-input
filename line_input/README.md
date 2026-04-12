# LINE個人やりとり → Supabase登録フォーム

スマホブラウザから個人LINEのやりとりをSupabaseの`messages`テーブルに登録するGAS Webアプリです。

---

## デプロイ手順

### 1. GASプロジェクトを作成する

1. [Google Apps Script](https://script.google.com) を開く
2. 「新しいプロジェクト」をクリック
3. プロジェクト名を `line_input` などに変更

---

### 2. Code.gs と index.html を貼り付ける

**Code.gs（バックエンド）**
- デフォルトの `コード.gs` を開く
- 中身をすべて削除し、`Code.gs` の内容を貼り付ける

**index.html（フロントエンド）**
- 左メニュー「＋」→「HTMLファイル」を選択
- ファイル名を `index` にする（`.html` は自動付与）
- `index.html` の内容を貼り付ける

---

### 3. スクリプトプロパティを設定する

1. 上部メニュー「プロジェクトの設定」（歯車アイコン）を開く
2. 「スクリプト プロパティ」セクションで以下を追加する

| プロパティ名 | 値 |
|---|---|
| `SUPABASE_URL` | `https://xxxxxxxxxx.supabase.co` |
| `SERVICE_ROLE_KEY` | Supabaseの `service_role` キー |

> **注意**: `anon` キーではなく `service_role` キーを使用してください（RLSをバイパスするため）。

---

### 4. Webアプリとしてデプロイする

1. 右上「デプロイ」→「新しいデプロイ」をクリック
2. 種類の選択で「Webアプリ」を選ぶ
3. 以下の設定にする

| 項目 | 設定値 |
|---|---|
| 説明 | LINE入力フォーム |
| 次のユーザーとして実行 | 自分（自分のGoogleアカウント） |
| アクセスできるユーザー | **全員** |

4. 「デプロイ」をクリック
5. 表示された **WebアプリのURL** をコピーして保存しておく

> 初回はGoogleアカウントのアクセス許可を求められます。「権限を確認」→「許可」で進めてください。

---

### 5. URLをスマホのホーム画面に追加する

**iPhone（Safari）の場合**
1. SafariでWebアプリのURLを開く
2. 下部の共有ボタン（四角＋矢印）をタップ
3. 「ホーム画面に追加」を選択
4. 名前を入力して「追加」

**Android（Chrome）の場合**
1. ChromeでWebアプリのURLを開く
2. 右上メニュー（…）をタップ
3. 「ホーム画面に追加」を選択

---

## Supabaseテーブル構成（参考）

`messages` テーブルに以下のカラムが必要です。

| カラム名 | 型 | 説明 |
|---|---|---|
| `source` | text | `"line_personal"` 固定 |
| `sender_name` | text | フォームで入力した送信者名 |
| `sender_id` | text | `"personal_line"` 固定 |
| `room_id` | text | `"personal_line"` 固定 |
| `content` | text | メッセージ本文 |
| `processed` | boolean | `false` で登録 |

---

## コード変更後の再デプロイ

コードを修正した場合は「デプロイ」→「デプロイを管理」→「編集（鉛筆アイコン）」→バージョンを「新しいバージョン」にして「デプロイ」。
