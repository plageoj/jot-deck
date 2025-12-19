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
* Tauri アプリでカード一覧が表示される

---

## Phase 3: フロントエンド本格実装

### 目標
仕様書の UI/UX を完全実装。

### 成果物
* フル機能の UI（AI 機能除く）
  * マルチカラムレイアウト
  * 仮想スクロール
  * CodeMirror エディタ（Vim モード）
  * キーバインド（`001-keybindings.md` 参照）
  * コマンドパレット
  * タグ機能（補完、フィルタ）
  * ゴミ箱 UI
  * ダーク/ライトモード
  * 設定画面

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
| **ローカル動作版** | Phase 1-3 | 未着手 |
| **AI 機能付き** | Phase 4 | 未着手 |
| **MVP リリース** | Phase 5 | 未着手 |
| **同期機能リリース** | Phase 6 | 未着手 |
