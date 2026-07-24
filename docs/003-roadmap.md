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

### 3.6 Deck 管理 UI ✅

#### 成果物
* Deck の作成・削除・名前変更
* `Ctrl+p` によるコマンドパレットからの Deck 切り替え（VS Code の Recent Workspaces 風）
* Deckスイッチャー UI（Chrome の Profile Switcher 風）
* 起動時に最後に開いていた Deck を自動で開く
* 初回起動時のオンボーディング Deck 読み込み（「Getting Started」: Welcome / Navigation / Tips カラム付き）

### 3.7 削除スタック（ゴミ箱）UI ✅

#### 成果物
* 削除操作の永続化（`deleted_at` から SQLite で導出されるためアプリ再起動後も保持）
* `u` で直近の削除から順に復元
* `g t` で削除スタック一覧表示、任意の項目を選択して復元

### 3.8 セッション状態の永続化 ✅

#### 成果物
* フォーカス位置（最後にフォーカスされた Column インデックス）の保存・復元
* カラム別カードフォーカス（各 Column で最後にフォーカスされた Card インデックス）の保存・復元
* 保存先: ブラウザ `localStorage`（Deck ごとに `jot-deck:focus:<deckId>` キー）
* 保存値が現在のカラム数 / カード数を超える場合はクランプする

### 3.9 設定画面・テーマ切り替え ✅

#### 成果物
* ダーク / ライトモード（OS 設定追従）
* フォント設定（family / size / line-height）
* Markdown / プレーンテキスト表示切り替え
* Codemirror の Vim mode ON/OFF 切り替え（OFF 時は `Ctrl+Enter` で保存して終了、`Escape` で保存せず終了）
* 設定は SQLite の `app` 設定 JSON に保存（将来的なオンライン同期のため。DB スキーマ変更なし）
* キーバインドカスタマイズ UI: デフォルトの上書き（リマップ / 無効化 / リセット）と新規バインドの追加。Column / Card / Common スコープ別に一覧・フィルタし、競合を検出（重複=エラー、プレフィックス重複=警告）

---

## Phase 4: MCP サーバ（読み取り面）✅

### 目標
Deck の読み取り面を MCP サーバとして公開し、power user が手元の汎用エージェント（Claude Desktop / Claude Code 等）から Deck を AI ナレッジベースとして参照できるようにする。ローカル完結・バックエンド不要・課金不要。

MCP ブリッジは CLI 同型の**別プロセスから同一 `jot-deck.db` を直接開く**。読み取り専用でも GUI と同時オープンになるため、並行アクセス基盤の整備を先行タスクとして成果物に含める。

### 成果物
* 並行アクセス基盤: `create_file_db` を **WAL モード＋busy_timeout** 化（GUI 側 `Mutex<Connection>` は書き込みトランザクションを長く握らない）
* スキーマ移行: `columns` テーブルへ `private` / `description` を追加
* stdio MCP ブリッジ server（`jot_deck_core` をリンクし DB を直接オープン・読み取り専用）
* 読み取り tool: `list_columns` / `read_card` / `search_cards` / `recent_cards`
* オンボーディング面: `describe_deck` tool（＋補助の `deck://schema` resource）と MCP `instructions`
* KB resource: `deck://{deck_id}`
* Deck 既定スコープ（接続＝1 Deck、設定ゼロで KB）と `private` 除外による read 可視性制御
* 本番配布: ブリッジを Tauri サイドカー（`externalBin`）として同梱。DB パスは本体と同じ固定 app data dir をブリッジが導出（env は不要）
* Deck 管理 UI に deck id の表示/コピーと、貼り付け可能な `mcpServers` 設定スニペット生成

> `search_cards` の本文検索は当面 substring 一致で動く。第一級の FTS5 インデックスは全文検索（Phase 9）で導入し、tool 面はそのままに実装だけ差し替える。

> power user は手元のエージェントで清書・要約を行うため、AI 連携は自社クラウドではなく MCP 読み取り面で提供する。立ち上げコスト（Worker / 認証 / レート制限 / 推論コスト）を負わずに「Deck を AI KB として開く」狙いを最短で満たす。

詳細設計: `008-mcp-server.md`

---

## Phase 5: Reporter 基盤 + MCP 書き込み面

### 目標
Reporter（外部ストリーミング入力アダプタ）と汎用エージェントの書き込みを可能にする。トランスポートは spawn 主体で分岐する ―― Reporter はホストが spawn し stdio パイプ 1 本で両チャネルを運ぶ（ローカル書き込み口）、MCP ブリッジは Claude が spawn し直接 DB へ書く。有料 Reporter 製品ラインの土台。

### 先行タスク（書き込み共通の土台）
Reporter・MCP 書き込みのどちらより先に入れる。両パスが依存する。
* `cards` テーブルへ `locked_by` / `locked_at` を追加するスキーマ移行
* カード編集の競合制御（占有ロック＋楽観ロック、`002` §5）― Reporter の streaming 占有・MCP patch の楽観ロックが共通で乗る
* GUI の**外部変更観測**: `PRAGMA data_version` の約 1s ポーリング＋`updated_at`/`deleted_at` 差分描画（ブリッジ/CLI の外部書き込み用。ホスト内 Reporter の書き込みは `update_hook` で即時描画）

### 成果物（Reporter 基盤）
* ローカル書き込み口（ホスト spawn ＋ stdio、認証スコープ・採番一元化・変更通知）
* 2 チャネル（committed / ephemeral）とカード長 commit 制約、`streaming` フォーカス状態
* frontend の外部起因カード追加/更新の差分描画（delta コアレス）
* 参照実装 Reporter 1 種（例: 議事録、Whisper ベースの音声認識）

### 成果物（MCP 書き込み面 ―― 直接 DB リンク）
* カード書き込み: `append_card`（idempotency key）/ `patch_card`（`expected_updated_at` 楽観ロック）/ `move_card` / `delete_card`
* 構造再編: `ensure_column` / `update_column` / `move_column`（Deck 内フル再編・Deck 越え不可）。`ensure_column` の新規作成は structure 有効かつ write allowlist 未指定のときのみ（deny structure / allowlist 明示ではエラー、既存取得は可）
* 安全域（`008` §5）: capability opt-out（既定 full write、機微な接続は個別に deny）・接続ごとレート制限・接続 id 帰属・回復性（論理削除＋アンドゥ）

詳細設計: `007-reporter-protocol.md` / `008-mcp-server.md`

---

## Phase 6: 認証・課金（Reporter 課金）

### 目標
Google OAuth + Stripe 連携。Cloudflare Workers で API を構築。音声認識（Whisper 等）の実コストと独自ロジックを内包する有料 Reporter のサブスク課金・ライセンス検証を実現する。

### 成果物
* 認証・課金が動作する MVP 完成
* Reporter 単位のサブスク / ライセンス検証

> Reporter は Whisper 等の実コスト・独自チャンキング/分類ロジックを内包するため、サブスク課金に合理性がある（`007-reporter-protocol.md` §9.4）。本体（表示・検索・MCP 読み取り面）は無料で power user に広く行き渡らせ、Reporter で稼ぐ構造とする。

---

## Phase 7: チュートリアル

### 目標
初回起動時および任意のタイミングで呼び出せるインタラクティブチュートリアルを実装。フォーカスモデルと主要操作をハンズオンで学べるようにする。

### 成果物
* 初回起動時の起動促しダイアログ（Start / Skip）
* コマンドパレット「Tutorial」からの手動起動
* コアトラック（フォーカスモデル＋カラム管理＋削除・復元＋ゴミ箱 UI のハンズオン）
* 拡張トラック（任意・スキップ可能）
* スポットライト + コーチマーク + キーヒントのオーバーレイ UI（`tutorial` フォーカスモード）
* 完了 / 中断 / 途中再開フラグの永続化（`SettingsStore` 相乗り、DB スキーマ変更なし）

詳細設計: `006-tutorial.md`

---

## Phase 8: クラウド同期

### 目標
Automerge + PartyKit でリアルタイム同期。

### 成果物
* リアルタイム同期が動作

---

## 将来の Phase

* **Phase 9:** 全文検索
* **Phase 10:** macOS / Linux 対応
* **Phase 11:** エクスポート機能
* **Phase 12:** 共有機能

---

## マイルストーン

| マイルストーン | 含まれる Phase | 状態 |
|:---|:---|:---|
| **データ層完成** | Phase 1 | 完了 |
| **Tauri 統合** | Phase 2 | 完了 |
| **ローカル動作版** | Phase 3.1-3.9 | 完了 |
| **AI KB 化（MCP 読み取り面）** | Phase 4 | 完了 |
| **Reporter 基盤** | Phase 5 | 未着手 |
| **MVP リリース（Reporter 課金）** | Phase 6 | 未着手 |
| **チュートリアル** | Phase 7 | 未着手 |
| **同期機能リリース** | Phase 8 | 未着手 |
