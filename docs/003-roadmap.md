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

> `search_cards` の本文検索は当面 substring 一致で動く。第一級の FTS5 インデックスは全文検索（Phase 10）で導入し、tool 面はそのままに実装だけ差し替える。

> power user は手元のエージェントで清書・要約を行うため、AI 連携は自社クラウドではなく MCP 読み取り面で提供する。立ち上げコスト（Worker / 認証 / レート制限 / 推論コスト）を負わずに「Deck を AI KB として開く」狙いを最短で満たす。

詳細設計: `008-mcp-server.md`

---

## Phase 5: Reporter 基盤 + MCP 書き込み面

### 目標
Reporter（外部ストリーミング入力アダプタ）と汎用エージェントの書き込みを可能にする。トランスポートは spawn 主体で分岐する ―― Reporter はホストが spawn し stdio パイプ 1 本で両チャネルを運ぶ（ローカル書き込み口）、MCP ブリッジは Claude が spawn し直接 DB へ書く。有料 Reporter 製品ラインの土台。

### 先行タスク（書き込み共通の土台）✅
Reporter・MCP 書き込みのどちらより先に入れる。両パスが依存する。
* `cards` テーブルへ `locked_by` / `locked_at` を追加するスキーマ移行（既存 DB 向けの移行ガード付き）
* カード編集の競合制御（占有ロック＋楽観ロック、`002` §5）― core の `acquire_lock` / `release_lock` / `commit_stream_and_release` / `update_content_cas` に集約し、Reporter の streaming 占有・MCP patch の楽観ロックが共通で乗る
* GUI の**外部変更観測**: `PRAGMA data_version` の約 1s ポーリングで `external-db-change` を emit し、frontend 側で 250ms コアレスしてカラムを再読み込みする（ブリッジ/CLI の外部書き込み用）。ホスト内 Reporter の書き込みはホストが `reporter-change` イベントで直接通知する

#### 未実装
* GUI 自身の編集パスが占有ロック / CAS に参加していない（`update_card_content` は `expected_updated_at` を取らず、ロックも取得しない）。エージェント間・Reporter 間の競合は制御されるが、人間の GUI 編集と外部書き込みの競合は未制御

### 成果物（Reporter 基盤）
* ローカル書き込み口 ✅（ホスト spawn ＋ stdio、認証スコープ・採番一元化・変更通知。`crates/reporter-host`）
* 2 チャネル（committed / ephemeral）とカード長 commit 制約 ✅。ストリーミング表示はフォーカスモードではなく**カード単位のオーバーレイ**で表現する（当該カードだけを読み取り専用化し生成中バッジを出す。複数カラムのカードが同時にストリームし得るため。`001-keybindings.md` §1.2）
* frontend の外部起因カード追加/更新の差分描画（delta コアレス）✅。加えて 30s 無通信のオーバーレイは破棄し、Reporter が落ちてもカードが読み取り専用のまま残らないようにする
* Reporter 登録 UI ✅（バイナリのフルパス登録・起動/停止・実行状態表示。`ReportersDialog`、`g r`）

#### 残作業
* **参照実装 Reporter ―― 別のプライベートリポジトリで開発中**（Python。例: 議事録、Whisper ベースの音声認識）。本リポジトリには配置しない。Reporter プロトコルを実際に話す唯一のクライアント実装であり、下記の配管パッケージはここから切り出す
* **配管パッケージの切り出し ―― 本リポジトリへ配置予定**: stdio JSON-RPC ループ / `stream.*` 状態機械 / backstop 遵守を、permissive ライセンス（MIT / Apache-2.0）の独立パッケージに分離する。一次実装は **Python**（`007` §9.5）。**Reporter プロトコルが固まってから**切り出す方針のため、それまでは本リポジトリに置かない。したがって現状、本リポジトリにあるプロトコル実装はホスト側（Rust、`crates/reporter-host`）のみで、パイプの反対側にあたるクライアント側の配管は存在しない
* Reporter 登録 UI からの認証スコープ編集（`deny` / `max_writes_per_min` / `allowed_columns` はバックエンドで強制されるが、GUI では編集できず既定値のまま保持される）

### 成果物（MCP 書き込み面 ―― 直接 DB リンク）✅
* カード書き込み: `append_card`（idempotency key）/ `patch_card`（`expected_updated_at` 楽観ロック）/ `move_card` / `delete_card`
* 構造再編: `ensure_column` / `update_column` / `move_column`（Deck 内フル再編・Deck 越え不可）。`ensure_column` の新規作成は structure 有効かつ write allowlist 未指定のときのみ（deny structure / allowlist 明示ではエラー、既存取得は可）
* 安全域（`008` §5）: capability opt-out（既定 full write、機微な接続は個別に deny。deny した verb は `tools/list` からも隠す）・接続ごとレート制限・接続 id 帰属・回復性（論理削除のみを公開し、物理削除と復元はエージェントに開かない。ユーザー向けの復元は削除スタック UI が担う）

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

## Phase 9: サードパーティ Reporter SDK / エコシステム開放

### 目標
Phase 5 で内部的に切り出した配管パッケージ（`007` §9.5）を、第三者が自作 Reporter を書けるよう**公開 SDK に昇格**させ、Reporter エコシステムを開放する。フル MCP 準拠は不要 ―― サードパーティ Reporter も本体 spawn で Reporter プロトコルを話す（`007` §2.2 / §3.2）。

### 成果物
* 配管パッケージの公開 SDK 化（publish ＋ API ドキュメント ＋ サンプル Reporter）
* Reporter プロトコル仕様の外部向け文書化（`007` を実装リファレンスとして整備）
* per-Reporter 書き込みスコープの**編集 UI**（書けるカラム/デッキの制限。強制自体は Phase 5 でバックエンドに入っているが、GUI から設定できないとサードパーティ Reporter には使えない。本体 spawn は「自分が起動した」ことしか保証せず登録バイナリの良性は保証しないため必須。`007` §10）

詳細設計: `007-reporter-protocol.md` §9.5 / §3.2

---

## 将来の Phase

* **Phase 10:** 全文検索
* **Phase 11:** macOS / Linux の動作検証（バイナリは既に 3 プラットフォーム分を配信しているが、検証は Windows のみ。`000-spec.md` §8.1）
* **Phase 12:** エクスポート機能
* **Phase 13:** 共有機能

---

## マイルストーン

| マイルストーン | 含まれる Phase | 状態 |
|:---|:---|:---|
| **データ層完成** | Phase 1 | 完了 |
| **Tauri 統合** | Phase 2 | 完了 |
| **ローカル動作版** | Phase 3.1-3.9 | 完了 |
| **AI KB 化（MCP 読み取り面）** | Phase 4 | 完了 |
| **Reporter 基盤** | Phase 5 | 一部完了（残: Python 配管パッケージの切り出し / GUI 編集パスの競合制御。参照実装 Reporter は別リポジトリで開発中） |
| **MVP リリース（Reporter 課金）** | Phase 6 | 未着手 |
| **チュートリアル** | Phase 7 | 未着手 |
| **同期機能リリース** | Phase 8 | 未着手 |
| **Reporter エコシステム開放（SDK 公開）** | Phase 9 | 未着手 |
