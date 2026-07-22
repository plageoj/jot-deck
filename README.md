# Jot Deck

**「思考の速度で書き、AIで結晶化させる」**

Jot Deck は、キーボード操作特化型のローカルファースト・メモアプリです。TweetDeck のようなカラム型 UI で、断片的なアイデアを高速に入力・整理します。Deck を MCP サーバとして開き、手元の AI エージェント（Claude 等）から読み書きできます。

## 特徴

- **圧倒的な速度** - 起動 0.5 秒、入力遅延ゼロ。数万件のカードでもサクサク動作
- **思考の断片化** - 140 字程度の「カード」を積み重ねる体験
- **キーボード完結** - Vim + Twitter 風キーバインドでマウス不要
- **AI 連携（ローカルファースト）** - Deck を MCP サーバとして開き、手元の AI エージェントからナレッジベースとして読み書き

## スクリーンショット

<!-- TODO: スクリーンショットを追加 -->

## 技術スタック

| レイヤー | 技術 |
|:---|:---|
| App Shell | Tauri v2 |
| Backend | Rust |
| Frontend | Svelte + TypeScript |
| Database | SQLite (FTS5) |
| Editor | CodeMirror 6 (Vim モード) |

## インストール

[GitHub Releases](https://github.com/plageoj/jot-deck/releases) から OS に合ったインストーラをダウンロードしてください。

| OS | フォーマット |
|:---|:---|
| Windows | `.msi` |
| macOS | `.dmg`（Apple Silicon / Intel ユニバーサル） |
| Linux | `.AppImage` |

インストール後、新しいバージョンがリリースされるとアプリ起動時に通知が表示されます。承諾するとダウンロード→再起動して更新が適用されます。

### Preview チャンネル

次期バージョンを先行して試したい場合は、[`preview` リリース](https://github.com/plageoj/jot-deck/releases/tag/preview) から Preview 版をインストールできます。Preview は **Production とは別のアプリ**（別 identifier・別データディレクトリ）としてインストールされるため、本番のデータを壊さずに新機能を検証できます。

なお、Production / Preview 間のデータ移行は提供していません。Preview で使ったデータを Production で利用したい場合は手動でのコピーが必要です。

### Code signing について

現状、コード署名は導入していません。Windows では SmartScreen、macOS では Gatekeeper の警告が表示されますが、信頼して実行してください。

## 開発

```bash
# 依存関係のインストール
pnpm install

# 開発サーバー起動
pnpm dev

# ビルド
pnpm build
```

## ドキュメント

- [基本設計書](docs/000-spec.md)
- [キーバインド仕様](docs/001-keybindings.md)
- [データ構造](docs/002-data-structure.md)
- [開発ロードマップ](docs/003-roadmap.md)

## ライセンス

[AGPL-3.0](LICENSE)
