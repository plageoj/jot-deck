# Jot Deck 開発ロードマップ

## 完了済み（Phase 1–4）

| Phase | 内容 | 詳細 |
|:---|:---|:---|
| **1: データ層** | SQLite の Deck / Column / Card CRUD、論理削除・復元、30 日経過後の物理削除 | `002-data-structure.md` |
| **2: Tauri 統合** | Tauri v2 + Svelte 5 + TypeScript、pnpm workspace、core の IPC 公開 | `000-spec.md` §2 |
| **3: フロントエンド** | マルチカラム UI、CodeMirror 6 によるカード編集（Vim モード任意）、キーバインドとフォーカスモデル、コマンドパレット / チートシート、タグとタグフィルタ、Deck 管理とオンボーディング Deck、削除スタック（ゴミ箱）、セッション内 Undo/Redo、フォーカス位置の復元、設定画面（テーマ・フォント・Markdown・Vim・キーバインドカスタマイズ） | `000-spec.md` §3 / `001-keybindings.md` |
| **4: MCP 読み取り面** | WAL による並行アクセス、stdio MCP ブリッジ（Tauri サイドカー同梱）、読み取り tool と `describe_deck`、`private` カラムの除外、GUI からの設定スニペット生成 | `008-mcp-server.md` |

---

## Phase 5: Reporter 基盤 + MCP 書き込み面

### 目標
Reporter（外部ストリーミング入力アダプタ）と汎用エージェントの書き込みを可能にする。有料 Reporter 製品ラインの土台。

### 完了済み
* 書き込み共通の土台: カードの占有ロック＋楽観ロック（`002` §5）、GUI の外部変更観測
* Reporter 基盤: ホスト spawn ＋ stdio のローカル書き込み口（`crates/reporter-host`）、committed / ephemeral の 2 チャネル、カード単位のストリーミングオーバーレイ、Reporter 登録・認証スコープ編集 UI（`g r`）
* MCP 書き込み面: カード書き込み・構造再編 tool、capability opt-out・レート制限・論理削除のみ公開の安全域（`008` §5）

### 残作業
* **参照実装 Reporter ―― 別のプライベートリポジトリで開発中**（Python。例: 議事録、Whisper ベースの音声認識）。本リポジトリには配置しない。Reporter プロトコルを実際に話す唯一のクライアント実装であり、下記の配管パッケージはここから切り出す
* **配管パッケージの切り出し ―― 本リポジトリへ配置予定**: stdio JSON-RPC ループ / `stream.*` 状態機械 / backstop 遵守を、permissive ライセンス（MIT / Apache-2.0）の独立パッケージに分離する。一次実装は **Python**（`007` §9.5）。**Reporter プロトコルが固まってから**切り出す方針のため、それまでは本リポジトリに置かない。したがって現状、本リポジトリにあるプロトコル実装はホスト側（Rust、`crates/reporter-host`）のみで、パイプの反対側にあたるクライアント側の配管は存在しない

詳細設計: `007-reporter-protocol.md` / `008-mcp-server.md`

---

## Phase 6: Web デモ

### 目標
インストール前にブラウザで操作感を試せる、保存しないサンドボックスを `app.jot-deck.com` に公開し、ランディングページからデスクトップ版のダウンロードへつなぐ。既存フロントエンドを WASM SQLite バックエンドで静的配信する。Web 版（Phase 15）の第一段階であり、同じ URL で Web 版に置き換わる。

### 成果物
* `app.jot-deck.com` への静的配信と `main` マージ時の自動デプロイ
* デモバナー（保存されない旨とダウンロード導線）、小画面向けの案内
* Tauri 専用機能（Reporters / MCP 設定 / アップデータ）の非表示・案内への置き換え
* ブラウザに奪われるキーのチートシート注記
* ランディングページからのリンク

詳細設計: `009-web-demo.md`

---

## Phase 7: 認証・課金（Reporter 課金）

### 目標
Google OAuth + Stripe 連携。Cloudflare Workers で API を構築。音声認識（Whisper 等）の実コストと独自ロジックを内包する有料 Reporter のサブスク課金・ライセンス検証を実現する。

### 成果物
* 認証・課金が動作する MVP 完成
* Reporter 単位のサブスク / ライセンス検証

> Reporter は Whisper 等の実コスト・独自チャンキング/分類ロジックを内包するため、サブスク課金に合理性がある（`007-reporter-protocol.md` §9.4）。本体（表示・検索・MCP 読み取り面）は無料で power user に広く行き渡らせ、Reporter で稼ぐ構造とする。

---

## Phase 8: チュートリアル

### 目標
初回起動時および任意のタイミングで呼び出せるインタラクティブチュートリアルを実装。フォーカスモデルと主要操作をハンズオンで学べるようにする。Web デモでも同じものが動く。

### 成果物
* 初回起動時の起動促しダイアログ（Start / Skip）
* コマンドパレット「Tutorial」からの手動起動
* コアトラック（フォーカスモデル＋カラム管理＋削除・復元＋ゴミ箱 UI のハンズオン）
* 拡張トラック（任意・スキップ可能）
* スポットライト + コーチマーク + キーヒントのオーバーレイ UI（`tutorial` フォーカスモード）
* 完了 / 中断 / 途中再開フラグの永続化（`SettingsStore` 相乗り、DB スキーマ変更なし）

詳細設計: `006-tutorial.md`

---

## Phase 9: クラウド同期

### 目標
Automerge + PartyKit でリアルタイム同期。

### 成果物
* リアルタイム同期が動作

---

## Phase 10: サードパーティ Reporter SDK / エコシステム開放

### 目標
Phase 5 で切り出す配管パッケージ（`007` §9.5）を、第三者が自作 Reporter を書けるよう**公開 SDK に昇格**させ、Reporter エコシステムを開放する。フル MCP 準拠は不要 ―― サードパーティ Reporter も本体 spawn で Reporter プロトコルを話す（`007` §2.2 / §3.2）。

### 成果物
* 配管パッケージの公開 SDK 化（publish ＋ API ドキュメント ＋ サンプル Reporter）
* Reporter プロトコル仕様の外部向け文書化（`007` を実装リファレンスとして整備）

詳細設計: `007-reporter-protocol.md` §9.5 / §3.2

---

## 将来の Phase

* **Phase 11:** 全文検索（FTS5 インデックス。MCP の `search_cards` は tool 面を変えずに実装を差し替える）
* **Phase 12:** macOS / Linux の動作検証（バイナリは既に 3 プラットフォーム分を配信しているが、検証は Windows のみ。`000-spec.md` §8.1）
* **Phase 13:** エクスポート機能
* **Phase 14:** 共有機能
* **Phase 15:** Web 版（ブラウザ内永続化と複数タブの書き込み安全を入れ、`app.jot-deck.com` の Web デモを置き換える。`009-web-demo.md` §8）
* **未定:** カードが数千件規模になった場合の仮想スクロール（推定高さでレンダリングし実測で補正する）

---

## マイルストーン

| マイルストーン | 含まれる Phase | 状態 |
|:---|:---|:---|
| **ローカル動作版** | Phase 1–3 | 完了 |
| **AI KB 化（MCP 読み取り面）** | Phase 4 | 完了 |
| **Reporter 基盤** | Phase 5 | 一部完了（残: Python 配管パッケージの切り出し。参照実装 Reporter は別リポジトリで開発中） |
| **Web デモ公開** | Phase 6 | 未着手 |
| **MVP リリース（Reporter 課金）** | Phase 7 | 未着手 |
| **チュートリアル** | Phase 8 | 未着手 |
| **同期機能リリース** | Phase 9 | 未着手 |
| **Reporter エコシステム開放（SDK 公開）** | Phase 10 | 未着手 |
