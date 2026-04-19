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

### 3.1 マルチカラムレイアウト ✅

#### 成果物
* TweetDeck 風の横スクロール可能なカラム配置
* Column ヘッダー表示
* カード可変高さ対応（テキスト量に応じた自動伸縮）

#### 将来の最適化
* 仮想スクロール（動的高さ対応）: カードが数千件規模になった場合のパフォーマンス最適化として、推定高さでレンダリング後に実測補正する方式で実装予定

### 3.2 カード表示・編集 ✅

#### 成果物
* View / Edit モード切り替え
* CodeMirror 6 統合（Vim モード）
* カード作成・更新操作

#### 未実装
* カードスコア（`f` / `F` / `+` / `-`）の視覚的表示

### 3.3 キーバインドシステム ✅

#### 成果物
* フォーカス管理（Column / Card / Edit）
* `h/j/k/l` ナビゲーション
* カード操作キー（`o`, `d d`, `y y`, `p` など）
* カード削除操作
* カラム操作キー（`H`, `L`, `c` など）

#### 追加実装済み
* カード コピー & ペースト（`y y` / `p` / `P`）
* カラム切り替えパレット（`g n` / `g c` / `Ctrl+t`）

### 3.4 コマンドパレット ✅

#### 成果物
* `Ctrl+Shift+p` / `F1` で起動
* コマンド検索・実行（9 コマンド登録済み。未実装機能のコマンドはスタブ）
* キーバインドチートシート（`?` / `Ctrl+/`）— 多段レイアウト、同一アクションのキーをグループ表示
* `command` フォーカスモード追加

### 3.5 タグ機能 ✅

#### 成果物
* `#tag` 自動認識・ハイライト
* 入力時の補完候補表示（`Tab` で確定）
* タグによる Deck 全体フィルタ
* フィルタ中の検索バー風 UI 表示

#### 実装済み
* DB 層でのタグ自動抽出・保存（`tags`, `card_tags` テーブル）
* Tauri コマンド公開（`get_tags_by_deck`, `get_cards_by_tag`, `get_tag_suggestions`）
* View モードでの `#tag` ハイライト表示（`TagHighlight` コンポーネント）
* CodeMirror エディタでのタグオートコンプリート（`@codemirror/autocomplete`、`Tab` で確定）
* タグクリックでの Deck 全体フィルタ（非マッチカードの半透明化）
* `/` キーでタグパレット表示（`TagPalette`、`PaletteDialog` ベース）
* フィルタ中の検索バー風 UI 表示（`TagFilterBar`）
* コマンドパレットに「Filter by Tag」「Clear Tag Filter」追加

### 3.6 Deck 管理 UI ✅

#### 成果物
* Deck の作成・削除・名前変更
* `Ctrl+p` によるコマンドパレットからの Deck 切り替え（VS Code の Recent Workspaces 風）
* Deckスイッチャー UI（Chrome の Profile Switcher 風）
* 起動時に最後に開いていた Deck を自動で開く
* 初回起動時のオンボーディング Deck 読み込み

#### 実装済み
* DB 層での Deck CRUD
* コマンドパレット基盤（Phase 3.4）
* `Ctrl+P` で Deck 切り替えパレット表示（`DeckPalette`、`PaletteDialog` ベース）
* Chrome Profile Switcher 風 `DeckSwitcher` ドロップダウン（ヘッダー内）
* ドロップダウンからの Deck 名前変更・削除
* コマンドパレットに「Switch Deck」「Rename Deck」「Delete Deck」追加
* `localStorage` による最後に開いた Deck の記憶・自動復元
* 初回起動時のオンボーディング Deck（「Getting Started」: Welcome / Navigation / Tips カラム付き）

### 3.7 削除スタック（ゴミ箱）UI

#### 成果物
* 削除操作の永続化（SQLite に削除スタックとして保存）
* `u` で直近の削除から順に復元
* `g t` で削除スタック一覧表示、任意の項目を選択して復元

#### 実装済み
* インメモリ削除スタック（`deleteStack.ts`）
* `u` キーによる直近削除の復元
* DB 層の `restoreCard()` / `restoreColumn()` / `getDeletedCards()` / `getDeletedColumns()`

#### 未実装
* `g t` キーバインドと削除スタック一覧 UI
* 削除スタックの SQLite 永続化（現在はインメモリのみ）

### 3.8 セッション状態の永続化

#### 成果物
* フォーカス位置（最後にフォーカスされた Column インデックス）の保存・復元
* カラム別カードフォーカス（各 Column で最後にフォーカスされた Card インデックス）の保存・復元
* 保存先: Tauri ローカルストレージ

#### 実装済み
* メモリ上でのフォーカス位置管理

#### 未実装
* Tauri ローカルストレージへの永続化
* 起動時の復元処理

### 3.9 設定画面・テーマ切り替え

#### 成果物
* ダーク / ライトモード（OS 設定追従）
* フォント設定（family / size / line-height）
* Markdown / プレーンテキスト表示切り替え
* キーバインドカスタマイズ UI

#### 実装済み
* CSS カスタムプロパティによるダーク/ライトテーマ定義（`theme.css`）

#### 未実装
* 設定 UI コンポーネント
* ランタイムでのテーマ切り替え
* フォント・表示設定 UI
* キーバインドカスタマイズ UI

---

## Phase 4: AI ストリーミング

### 目標
Cloudflare AI Gateway 経由で Gemini API 連携。Worker による認証・レート制限とストリーミングレスポンス実装。

### 4.1 Worker 基盤

#### 成果物
* Cloudflare Worker プロジェクト作成
* AI Gateway 設定（Gemini 連携）
* `/synthesize` エンドポイント実装
* JWT 認証・プラン別レート制限

### 4.2 Rust クライアント

#### 成果物
* `crates/core/src/ai/` モジュール作成
* Worker API へのストリーミング HTTP リクエスト
* Tauri Channel によるフロントエンド通知

### 4.3 フロントエンド UI

#### 成果物
* 清書ダイアログコンポーネント
* ストリーミング結果表示
* 結果アクション（コピー、カード追加）
* コマンドパレットへの `AI Draft` 追加

### 4.4 エラーハンドリング・UX

#### 成果物
* エラー表示 UI（認証、レート制限、ネットワーク）
* リトライロジック
* 使用量表示

詳細設計: `005-ai-integration.md`

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
| **Tauri 統合** | Phase 2 | 完了 |
| **ローカル動作版** | Phase 3.1-3.9 | 進行中（3.1-3.6 完了） |
| **AI 機能付き** | Phase 4 | 未着手 |
| **MVP リリース** | Phase 5 | 未着手 |
| **同期機能リリース** | Phase 6 | 未着手 |
