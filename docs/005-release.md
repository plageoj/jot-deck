# リリース戦略

## 概要

Jot Deck はタグ push を起点とした GitHub Releases 配信と、Tauri updater による自動アップデート機構を採用する。Preview / Production の 2 チャンネルを **別 identifier の別アプリ**として並行配信し、ユーザーのローカルデータ（SQLite）を保護しながら早期検証を可能にする。

---

## チャンネル設計

| 項目 | Production | Preview |
|---|---|---|
| バンドル identifier | `com.jot-deck.app` | `com.jot-deck.app.preview` |
| productName | `Jot Deck` | `Jot Deck Preview` |
| データディレクトリ | `<AppData>/com.jot-deck.app/` | `<AppData>/com.jot-deck.app.preview/` |
| トリガ | `v*.*.*` タグ push | `main` ブランチへの push |
| GitHub Release | 通常 release | `prerelease: true` |
| updater マニフェスト | `latest.json` | `latest-preview.json` |
| バージョン表記 | `1.2.3` | `1.2.3-<n>`（`<n>` = base からのコミット数） |

### A 案を採用する理由

* Production と Preview を**別アプリとしてインストール**するため、データディレクトリが完全分離される
* Preview で破壊的な SQLite マイグレーションを試しても Production のローカルデータが壊れない
* ユーザーは両方を併存させて、本番データを守りつつ次バージョンを試せる
* チャンネル間「乗り換え」は手動インストールが必要になるが、local-first アプリではこの安全性のほうが重要

---

## リポジトリ構成

```text
packages/app/src-tauri/
├── tauri.conf.json              # 共通設定 (production が既定)
├── tauri.conf.preview.json      # preview チャンネル上書き
└── ...
.github/workflows/
├── ci.yml                       # 既存
├── release-production.yml       # タグ push 用
└── release-preview.yml          # main push 用
```

### `tauri.conf.preview.json`（上書き例）

```jsonc
{
  "productName": "Jot Deck Preview",
  "identifier": "com.jot-deck.app.preview",
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/<owner>/jot-deck/releases/download/preview/latest.json"
      ]
    }
  }
}
```

ビルド時に `tauri build --config src-tauri/tauri.conf.preview.json` でマージ上書きする。

---

## GitHub Actions ワークフロー

### Production (`release-production.yml`)

* **トリガ**: `push: tags: ['v*.*.*']`
* **matrix**: `windows-latest` / `macos-latest` / `ubuntu-latest`
* **action**: `tauri-apps/tauri-action`
* **出力**: 通常 release（タグ名 = バージョン）+ `latest.json`
* **オプション**: `includeUpdaterJson: true`, `prerelease: false`

### Preview (`release-preview.yml`)

* **トリガ**: `push: branches: [main]`, `paths-ignore: ['docs/**', '*.md']`
* **タグ運用**: rolling tag 方式（固定タグ `preview` を force-update）
* **アセット命名**: `latest.json` ではなく `latest-preview.json` として配置（production と URL を分離）
* **オプション**: `prerelease: true`, `make_latest: false`
* **バージョン採番**: base バージョンに `-<n>`（`base-version.txt` 最終更新からのコミット数）を付与。Windows MSI/WiX は pre-release 識別子が数字のみであることを要求するため、`-preview.<n>` のような非数値接頭辞は使えない

### 共通シークレット

| Secret | 用途 |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | updater 用秘密鍵（両チャンネル共通） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 同上パスワード |
| `GITHUB_TOKEN` | Release 作成（標準提供） |

OS の code signing 証明書（Windows EV / Apple Developer ID）は初期は導入せず、SmartScreen / Gatekeeper の警告は受容する。導入時に追加シークレットを定義する。

---

## Updater 統合

### Rust 側

```toml
# packages/app/src-tauri/Cargo.toml
[dependencies]
tauri-plugin-updater = "2"
```

```rust
// lib.rs
tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    // ...
```

### フロント側

```bash
pnpm --filter app add @tauri-apps/plugin-updater @tauri-apps/plugin-process
```

起動時に `check()` し、利用可能なら設定 dialog で通知 → ユーザー承諾後に DL & インストール → `relaunch()`。

サイレント自動更新ではなく**ユーザー承認方式**とする（power-user 向けで、編集中のカードを失う事故を避けるため）。

### 鍵生成

```bash
pnpm tauri signer generate -w ~/.tauri/jot-deck-updater.key
```

公開鍵は `tauri.conf.json` の `plugins.updater.pubkey` に commit、秘密鍵は GH Secrets に格納。

---

## バージョニング規約

* Production: [Semantic Versioning](https://semver.org/) を採用。`v1.2.3`
* Preview: `1.2.3-<n>` 形式（`<n>` は base バージョンファイル最終更新からのコミット数）。`1.2.3` が次の production リリース予定であることを示す。pre-release 識別子を数字のみにするのは Windows MSI/WiX の制約（非数値・>65535 の pre-release を拒否する）に従うため
* `package.json` / `Cargo.toml` / `tauri.conf.json` の version を統一する仕組み（`pnpm version` + 同期スクリプト）は別途整備

---

## バンドルターゲット

| OS | フォーマット | updater 対応 |
|---|---|---|
| Windows | `.msi` (WiX) | ✅ |
| macOS | `.dmg` + `.app.tar.gz` | ✅ |
| Linux | `.AppImage` | ✅ |

Linux は AppImage を updater 経路の主とする。

---

## 実装フェーズ

### Phase R.1: Updater 機構の組み込み
* `tauri-plugin-updater` 追加
* 署名鍵生成 + GH Secrets 登録
* フロント側で起動時チェック + 通知 UI

### Phase R.2: Production リリース workflow
* `release-production.yml` 作成
* 初回 `v0.0.0` タグで動作確認

### Phase R.3: Preview チャンネル分離
* `tauri.conf.preview.json` 追加
* `release-preview.yml` 作成
* rolling `preview` タグ運用開始

### Phase R.4: バージョン同期ツール
* `package.json` / `Cargo.toml` / `tauri.conf.json` の version を一括更新するスクリプト

### Phase R.5（将来）: OS code signing
* Windows EV 証明書 or Apple Developer ID 取得
* CI への組み込み

---

## 既知の制約と運用上の注意

* **チャンネル間移行は手動**: Preview から Production へ「乗り換える」場合、ユーザーは手動で Production をインストールし、必要なら手動でデータを移行する必要がある（自動データ移行は提供しない）
* **CI コスト**: macOS runner は分単価が高い。`paths-ignore` で docs / 設定変更は除外する
* **Release 一覧の肥大化**: Preview は rolling tag なので 1 件に収まるが、過去の preview を保持したい場合は別運用が必要
* **updater 鍵の漏洩リスク**: 漏洩した場合は新鍵を発行して全ユーザーに手動再インストールを促す必要がある（updater の信頼チェーンが切れるため）
