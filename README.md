# Jot Deck

**「思考の速度で書き、AIで結晶化させる」**

Jot Deck は、キーボード操作特化型のローカルファースト・メモアプリです。TweetDeck のようなカラム型 UI で、断片的なアイデアを高速に入力・整理し、AI が文章として清書します。

## 特徴

- **圧倒的な速度** - 起動 0.5 秒、入力遅延ゼロ。数万件のカードでもサクサク動作
- **思考の断片化** - 140 字程度の「カード」を積み重ねる体験
- **キーボード完結** - Vim + Twitter 風キーバインドでマウス不要
- **AI による収束** - 散らばった断片を AI が統合・清書

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

> 現在開発中です。リリース時にインストール方法を公開します。

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
