# Jot Deck 開発ロードマップ

## Phase 1: データ層

### 目標
SQLite でローカル DB を構築。CLI で動作確認。

### 成果物
* Deck / Column / Card の CRUD（論理削除/復元を含む）
* 物理削除バッチ処理（30日経過後）

---

## Phase 2: Tauri 統合

### 目標
Rust バックエンド + 最小限 Svelte フロントエンドの統合。

### 成果物
* Tauri v2 + Svelte 5 + TypeScript のプロジェクトセットアップ
* pnpm workspace 構成（`crates/core`, `packages/app`）
* Rust コア層の IPC コマンド公開（Deck / Column / Card CRUD）
* 最小限の UI でカード一覧が表示される（スタイリング不要）

---

## Phase 3: フロントエンド本格実装

### 目標
仕様書の UI/UX を完全実装。

### 3.1 マルチカラムレイアウト

#### 成果物
* TweetDeck 風の横スクロール可能なカラム配置
* Column ヘッダー表示
* 仮想スクロール実装（大量カード対応）

### 3.2 カード表示・編集

#### 成果物
* View / Edit モード切り替え
* CodeMirror 6 統合（Vim モード）
* カード CRUD 操作（作成・更新・削除）

### 3.3 キーバインドシステム

#### 成果物
* フォーカス管理（Column / Card / Edit）
* `h/j/k/l` ナビゲーション
* カード操作キー（`o`, `d d`, `y y`, `p` など）
* カラム操作キー（`H`, `L`, `c` など）

### 3.4 コマンドパレット

#### 成果物
* `Ctrl+Shift+p` / `F1` で起動
* コマンド検索・実行
* キーバインドチートシート（`?` / `Ctrl+/`）

### 3.5 タグ機能

#### 成果物
* `#tag` 自動認識・ハイライト
* 入力時の補完候補表示（`Tab` で確定）
* タグによる Deck 全体フィルタ
* フィルタ中の検索バー風 UI 表示

### 3.6 ゴミ箱 UI・復元機能

#### 成果物
* `g t` で削除済み Column / Card 一覧表示
* 復元操作
* `u` による直後の Undo

### 3.7 設定画面・テーマ切り替え

#### 成果物
* ダーク / ライトモード（OS 設定追従）
* フォント設定（family / size / line-height）
* Markdown / プレーンテキスト表示切り替え
* キーバインドカスタマイズ UI

---

## Phase 4: AI ストリーミング

### 目標
Gemini API 連携、ストリーミングレスポンス実装。

### 成果物
* AI 清書機能が動作

---

## Phase 5: 認証・課金

### 目標
Google OAuth + Stripe 連携。Cloudflare Workers で API を構築。

### 成果物
* 認証・課金が動作する MVP 完成

---

## Phase 6: クラウド同期

### 目標
Automerge + PartyKit でリアルタイム同期。

### 成果物
* リアルタイム同期が動作

---

## 将来の Phase

* **Phase 7:** 全文検索
* **Phase 8:** macOS / Linux 対応
* **Phase 9:** エクスポート機能
* **Phase 10:** 共有機能

---

## マイルストーン

| マイルストーン | 含まれる Phase | 状態 |
|:---|:---|:---|
| **データ層完成** | Phase 1 | 完了 |
| **Tauri 統合** | Phase 2 | 進行中 |
| **ローカル動作版** | Phase 3.1-3.7 | 未着手 |
| **AI 機能付き** | Phase 4 | 未着手 |
| **MVP リリース** | Phase 5 | 未着手 |
| **同期機能リリース** | Phase 6 | 未着手 |
