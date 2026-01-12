# E2E テスト設定

## 概要

Jot Deck は Playwright を使用した E2E テストと、WASM SQLite フォールバックによるブラウザ内データベース機能を備えています。これにより、Tauri バックエンドなしでもリアルな E2E テストが可能になり、将来的な Web 版への道も開けます。

---

## アーキテクチャ

### データベース抽象化レイヤー

```
src/lib/db/
├── index.ts          # 環境検出とバックエンド選択
├── types.ts          # DatabaseBackend インターフェース定義
├── tauri-backend.ts  # Tauri/Rust バックエンド実装（デスクトップ用）
└── wasm-backend.ts   # WASM SQLite バックエンド実装（Web/テスト用）
```

### 環境検出

`src/lib/db/index.ts` は自動的に実行環境を検出します：

* **Tauri 環境**（`__TAURI_INTERNALS__` が存在）: `TauriBackend` を使用
* **ブラウザ環境**（Tauri なし）: `WasmBackend` を使用

```typescript
import { getDatabase } from "$lib/db";

// 自動的に適切なバックエンドを選択
const db = await getDatabase();
await db.createCard({ column_id: "...", content: "Hello" });
```

---

## WASM SQLite バックエンド

### 使用ライブラリ

* **sql.js**: SQLite を WebAssembly にコンパイルしたライブラリ
* **ulid**: Rust バックエンドと同じ ULID 生成

### 特徴

* Rust バックエンドと完全互換の SQL スキーマ
* 論理削除（soft delete）対応
* 位置管理（position）対応
* タグ同期機能

### 制限事項

* インメモリデータベース（ページリロードでデータが消える）
* 永続化なし（E2E テスト用途を想定）

---

## Playwright 設定

### 設定ファイル

`packages/app/playwright.config.ts`:

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120000,          // テストタイムアウト（2分）
  workers: 1,               // シリアル実行
  use: {
    baseURL: "http://localhost:1420",
    video: "on",            // 動画録画を有効化
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
```

### テストファイル構成

```
packages/app/e2e/
└── demo.spec.ts    # デモ用 E2E テスト
```

---

## npm スクリプト

| コマンド | 説明 |
|:---|:---|
| `pnpm test:e2e` | すべての E2E テストを実行（ヘッドレス） |
| `pnpm test:e2e:demo` | デモテストをブラウザ表示付きで実行 |
| `pnpm test:e2e:ui` | Playwright UI モードで実行 |

---

## デモテスト

`e2e/demo.spec.ts` は Jot Deck の主要機能をデモンストレーションします：

### テストシナリオ

1. **初期セットアップ**: Deck と Column の作成
2. **カラム操作**: `c` キーでカラム追加、`h`/`l` でナビゲーション
3. **カード作成**: `o` キーで新規カード、Vim モードで編集
4. **カード操作**:
   - `j`/`k`: 上下移動
   - `gg`/`G`: 先頭/末尾へジャンプ
   - `yy`/`p`: コピー/ペースト
   - `dd`/`u`: 削除/アンドゥ
   - `J`/`K`: カード並び替え
   - `H`/`L`: カラム間移動
   - `f`: スコアアップ
5. **カラムジャンプ**: `g1`〜`g9` で直接移動
6. **カラム並び替え**: `Shift+H`/`Shift+L`

### Vim モード対応

CodeMirror の Vim モードと連携するため、ヘルパー関数を用意：

```typescript
// エディタ内でテキストを入力
async function typeInEditor(page: Page, text: string) {
  await page.keyboard.press("i");  // インサートモードへ
  await page.keyboard.type(text, { delay: 30 });
}

// 保存して終了
async function saveAndExitEditor(page: Page) {
  await page.keyboard.press("Control+Enter");
}
```

---

## 動画録画

### 出力先

テスト実行後、動画は以下に保存されます：

```
packages/app/test-results/
├── demo-Jot-Deck-Demo-full-demo-walkthrough-chromium/
│   └── video.webm
├── demo-Feature-Highlights-quick-card-creation-workflow-chromium/
│   └── video.webm
└── demo-Feature-Highlights-keyboard-navigation-demo-chromium/
    └── video.webm
```

### デモ動画の作成

```bash
cd packages/app
pnpm test:e2e:demo
```

`--headed` オプションにより、ブラウザが表示された状態でテストが実行され、動画が録画されます。

---

## 依存パッケージ

### 本番依存

| パッケージ | 用途 |
|:---|:---|
| `sql.js` | WASM SQLite 実装 |
| `ulid` | ULID 生成（Rust 互換） |

### 開発依存

| パッケージ | 用途 |
|:---|:---|
| `@playwright/test` | E2E テストフレームワーク |
| `@types/sql.js` | sql.js の型定義 |

---

## CI/CD 対応

### 環境変数

* `CI=true`: CI 環境では `reuseExistingServer: false` となり、毎回新しい開発サーバーを起動

### GitHub Actions での実行例

```yaml
- name: Install Playwright Browsers
  run: pnpm exec playwright install chromium

- name: Run E2E Tests
  run: pnpm test:e2e
```

---

## トラブルシューティング

### WASM ファイルの読み込みエラー

sql.js の WASM バイナリは CDN から読み込まれます。ネットワーク接続を確認してください。

```typescript
const SQL_WASM_URL = "https://sql.js.org/dist/sql-wasm.wasm";
```

### タイムアウトエラー

テストがタイムアウトする場合、`playwright.config.ts` の `timeout` 値を調整してください。

### 動画が録画されない

`video: "on"` が設定されていることを確認してください。

---

## 将来の拡張

### Web 版への展開

WASM SQLite バックエンドを使用することで、以下の展開が可能：

* **PWA 版**: IndexedDB と組み合わせてデータ永続化
* **静的ホスティング**: Cloudflare Pages / Vercel などにデプロイ
* **オフライン対応**: Service Worker と組み合わせ

### 永続化オプション

現在はインメモリのみですが、以下の拡張が可能：

* **IndexedDB 永続化**: sql.js の export/import 機能を使用
* **Origin Private File System (OPFS)**: より高性能な永続化
