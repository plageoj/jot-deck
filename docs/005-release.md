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

### チャンネルを別アプリとして分ける理由

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
├── ci.yml                       # main push / PR の検査
├── release-production.yml       # タグ push 用
└── release-preview.yml          # main push 用
```

### `tauri.conf.preview.json`（上書き内容）

```jsonc
{
  "productName": "Jot Deck Preview",
  "identifier": "com.jot-deck.app.preview",
  "app": {
    "windows": [{ "title": "Jot Deck Preview" }]
  },
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/plageoj/jot-deck/releases/download/preview/latest-preview.json"
      ]
    }
  }
}
```

ビルド時に `tauri build --config src-tauri/tauri.conf.preview.json` でマージ上書きする。Production の updater endpoint は `tauri.conf.json` の `https://github.com/plageoj/jot-deck/releases/latest/download/latest.json`。

---

## GitHub Actions ワークフロー

#### 並列ビルド + assemble 方式（両チャンネル共通）

3 プラットフォームのビルドは**完全並列**で走らせる。`tauri-action` の `includeUpdaterJson` は同一リリースタグ上の `latest.json` を read-modify-write するため、並列で同じタグへ書くとマニフェストが競合する。これを避けるため各プラットフォームは**自分専用の使い捨て draft staging リリース**（`<tag>-staging-<os>`）へ出力する。draft リリースは git タグを生成せずユーザーにも見えない。

その後 `assemble` ジョブが 3 つの staging から生成された**プラットフォーム完結の `latest.json`** を回収し、`.platforms` をマージ + URL のタグ部分を本番タグへ書き換えて 1 本のマニフェストにまとめ、バンドルとともに本番リリースへ昇格させてから staging draft を削除する。プラットフォームキーの対応表は `tauri-action` の出力をそのまま使うため手書きしない。

これによりリリースの待ち時間は、最も遅い 1 プラットフォーム分 + assemble で済む。

### Production (`release-production.yml`)

* **トリガ**: `push: tags: ['v*.*.*']`
* **matrix**: `windows-latest` / `macos-latest`（`--target universal-apple-darwin`）/ `ubuntu-latest`（並列、staging draft へ出力）
* **バージョン**: タグから先頭の `v` を除いた値を `node scripts/sync-version.mjs` で各ファイルへ書き込んでからビルドする（タグ前にバージョン更新コミットは不要）
* **action**: `tauri-apps/tauri-action`（`includeUpdaterJson: true`, `prerelease: false`）
* **assemble**: staging を本番タグ（= バージョン）の draft release へ昇格し `latest.json` を合成
* **publish**: 全ビルド + assemble 成功時のみ draft を publish（`--latest`）。1 プラットフォームでも失敗すれば publish されない

### Preview (`release-preview.yml`)

* **トリガ**: `push: branches: [main]`, `paths-ignore: ['docs/**', '**/*.md', '.github/ISSUE_TEMPLATE/**']`
* **matrix**: 並列、`preview-staging-<os>` draft へ出力。Linux は `--bundles deb,appimage`（`.rpm` なし。「バンドルターゲット」参照）
* **タグ運用**: rolling tag 方式（固定タグ `preview` を force-update）。タグの移動は assemble の昇格が完全成功したときのみ行い、部分ビルドを指さない
* **assemble**: staging を `preview` リリースへ昇格。`latest.json` ではなく `latest-preview.json` として配置（production と URL を分離）。1 プラットフォームでも失敗した場合は昇格をスキップし、直近の完全ビルドを配信し続ける。旧バージョンのバンドルはこのジョブで掃除する
* **オプション**: `preview` リリースは `--prerelease` で作成し、Latest 扱いにしない
* **バージョン採番**: `packages/app/preview-base-version.txt` の base バージョンに `-<n>`（同ファイル最終更新からのコミット数、`git rev-list --count`）を付与し、`node scripts/sync-version.mjs --preview <n>` で書き込む。`<n>` が 65535 を超えるとジョブは失敗する。Windows MSI/WiX は pre-release 識別子が数字のみであることを要求するため、`-preview.<n>` のような非数値接頭辞は使えない

### 共通シークレット

| Secret | 用途 |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | updater 用秘密鍵（両チャンネル共通） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 同上パスワード |
| `GITHUB_TOKEN` | Release 作成（標準提供） |

OS の code signing 証明書（Windows EV / Apple Developer ID）は導入しておらず、SmartScreen / Gatekeeper の警告は受容する。導入時に追加シークレットを定義する。

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

起動時に `check()` し、利用可能ならバナーで通知 → ユーザー承諾後に DL & インストール → `relaunch()`。

起動時チェックの失敗（オフライン等）は通知せず、ネットワーク復帰（`online` イベント）時に再チェックする。チェックのエラーは About ダイアログ（開いた時点と「Check for Updates」で再チェックする）にだけ表示し、バナーに出すエラーはユーザーが始めたインストールの失敗に限る。

サイレント自動更新ではなく**ユーザー承認方式**とする（power-user 向けで、編集中のカードを失う事故を避けるため）。

### 鍵生成

```bash
pnpm tauri signer generate -w ~/.tauri/jot-deck-updater.key
```

公開鍵は `tauri.conf.json` の `plugins.updater.pubkey` に commit、秘密鍵は GH Secrets に格納。

---

## バージョニング規約

* Production: [Semantic Versioning](https://semver.org/) を採用。`v1.2.3`
* Preview: `1.2.3-<n>` 形式（`<n>` は `packages/app/preview-base-version.txt` 最終更新からのコミット数）。`1.2.3` が次の production リリース予定であることを示す。pre-release 識別子を数字のみにするのは Windows MSI/WiX の制約（非数値・>65535 の pre-release を拒否する）に従うため
* `package.json` / `Cargo.toml` / `tauri.conf.json` の version は `scripts/sync-version.mjs` で統一する。base バージョンを上げるときは `node scripts/sync-version.mjs <new-version>` を実行してコミットする（`preview-base-version.txt` も同時に更新され、Preview の `<n>` は 0 から数え直しになる）

---

## バンドルターゲット

| OS | フォーマット | updater 対応 |
|---|---|---|
| Windows | `.msi` (WiX) | ✅ |
| macOS | `.dmg` + `.app.tar.gz` | ✅ |
| Linux | `.AppImage` / `.deb` / `.rpm`（Preview は `.rpm` なし） | ✅ |

Linux は AppImage を updater 経路の主とする。`.deb` / `.rpm` でインストールした場合も updater が `linux-x86_64-deb` / `linux-x86_64-rpm` のバンドルを取得し、`pkexec` 経由の `dpkg -i` / `rpm -U` で更新する。

Preview の Linux ビルドは `.AppImage` と `.deb` のみを生成し、`.rpm` は生成しない。RPM のバージョンには `-` を含められないため、Preview のバージョン（`1.2.3-<n>`）では RPM バンドラーが失敗する。

---

## 実装フェーズ

### Phase R.1: Updater 機構の組み込み（完了）
* `tauri-plugin-updater` 追加
* 署名鍵生成 + GH Secrets 登録
* フロント側で起動時チェック + 通知 UI

### Phase R.2: Production リリース workflow
* `release-production.yml` 作成（完了）
* 初回 `v*.*.*` タグで動作確認（未実施。Production リリースはまだない）

### Phase R.3: Preview チャンネル分離（完了）
* `tauri.conf.preview.json` 追加
* `release-preview.yml` 作成
* rolling `preview` タグ運用

### Phase R.4: バージョン同期ツール（完了）
* `package.json` / `Cargo.toml` / `tauri.conf.json` の version を一括更新するスクリプト（`scripts/sync-version.mjs`）

### Phase R.5（将来）: OS code signing
* Windows EV 証明書 or Apple Developer ID 取得
* CI への組み込み

---

## 既知の制約と運用上の注意

* **チャンネル間移行は手動**: Preview から Production へ「乗り換える」場合、ユーザーは手動で Production をインストールし、必要なら手動でデータを移行する必要がある（自動データ移行は提供しない）
* **CI コスト**: macOS runner は分単価が高い。Preview は `paths-ignore` で docs / Markdown / Issue テンプレートのみの変更を除外する
* **Release 一覧の肥大化**: Preview は rolling tag なので 1 件に収まるが、過去の preview を保持したい場合は別運用が必要
* **updater 鍵の漏洩リスク**: 漏洩した場合は新鍵を発行して全ユーザーに手動再インストールを促す必要がある（updater の信頼チェーンが切れるため）
