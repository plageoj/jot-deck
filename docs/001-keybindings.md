# Jot Deck キーバインド仕様

## 1. 設計方針

### 1.1 基本原則
* **Vim ライク:** `h/j/k/l` によるナビゲーションを基本とする。
* **モード切り替え:** Normal / Insert モードを持つ（CodeMirror の Vim モード）。
* **修飾キー最小化:** 頻繁な操作は修飾キーなしで実行可能。
* **カスタマイズ可能:** ユーザーが全キーバインドを変更可能。

### 1.2 モード定義

| モード | 説明 |
|:---|:---|
| **Normal** | カード間・カラム間のナビゲーション。カード編集なし。 |
| **Insert** | カード内テキスト編集中。CodeMirror がフォーカス状態。 |
| **Command** | コマンドパレット表示中。 |

---

## 2. Normal モード

### 2.1 カードナビゲーション

| キー | 動作 |
|:---|:---|
| `j` | 下のカードへ移動 |
| `k` | 上のカードへ移動 |
| `h` | 左のカラムへ移動（同じ行位置を維持） |
| `l` | 右のカラムへ移動（同じ行位置を維持） |
| `g g` | カラム内の最初のカードへ |
| `G` | カラム内の最後のカードへ |
| `Ctrl+u` | 半ページ上へスクロール |
| `Ctrl+d` | 半ページ下へスクロール |

### 2.2 カード操作

| キー | 動作 |
|:---|:---|
| `i` | Insert モードへ（カーソル位置維持） |
| `a` | Insert モードへ（カーソルを末尾に移動） |
| `o` | 現在のカードの下に新規カード作成 → Insert モード |
| `O` | 現在のカードの上に新規カード作成 → Insert モード |
| `Enter` | 現在のカードを編集（= `i`） |
| `d d` | カードを削除（論理削除） |
| `y y` | カードをコピー |
| `p` | カードを下にペースト |
| `P` | カードを上にペースト |
| `+` / `=` | カードの score を +1 |
| `-` | カードの score を -1 |

### 2.3 カラム操作

| キー | 動作 |
|:---|:---|
| `H` | カラムを左へ移動（並び替え） |
| `L` | カラムを右へ移動（並び替え） |
| `Ctrl+n` | 新規カラム作成（現在のカラムの右） |
| `Ctrl+w` | カラムを削除（確認ダイアログ） |
| `r` | カラム名を編集 |

### 2.4 Deck 操作

| キー | 動作 |
|:---|:---|
| `Ctrl+r` | Deck 切り替え（コマンドパレット） |
| `Ctrl+Shift+n` | 新規 Deck 作成 |

### 2.5 検索・フィルタ

| キー | 動作 |
|:---|:---|
| `/` | 検索モード（Deck 内検索） |
| `#` | タグフィルタモード |
| `Escape` | フィルタ解除 |

### 2.6 その他

| キー | 動作 |
|:---|:---|
| `Ctrl+p` | コマンドパレット表示 |
| `?` または `F1` | キーバインドチートシート表示 |
| `Ctrl+,` | 設定画面を開く |
| `Ctrl+z` | Undo |
| `Ctrl+Shift+z` | Redo |
| `u` | Undo（Vim 風） |
| `Ctrl+r` | Redo（Vim 風、Deck 切り替えと競合 → 要検討） |

---

## 3. Insert モード

### 3.1 テキスト編集
CodeMirror の Vim モードがそのまま適用される。

| キー | 動作 |
|:---|:---|
| `Escape` | Normal モードへ戻る |
| `Ctrl+[` | Normal モードへ戻る（Vim 互換） |
| 通常のVimキー | CodeMirror Vim モードの標準動作 |

### 3.2 特殊操作

| キー | 動作 |
|:---|:---|
| `#` + 文字入力 | タグ補完候補を表示 |
| `Tab` | 補完候補を確定 |
| `Ctrl+Enter` | カードを保存して次のカードを新規作成 |
| `Shift+Enter` | カードを保存して Normal モードへ |

---

## 4. Command モード（コマンドパレット）

### 4.1 ナビゲーション

| キー | 動作 |
|:---|:---|
| `Escape` | コマンドパレットを閉じる |
| `Enter` | 選択中のコマンドを実行 |
| `j` / `↓` | 次の候補へ |
| `k` / `↑` | 前の候補へ |
| 文字入力 | コマンド絞り込み |

### 4.2 利用可能なコマンド

| コマンド | 説明 |
|:---|:---|
| `Switch Deck` | Deck 一覧を表示して切り替え |
| `New Deck` | 新規 Deck 作成 |
| `New Column` | 新規 Column 作成 |
| `Delete Column` | Column 削除 |
| `Settings` | 設定画面を開く |
| `AI Draft` | AI 清書を開始 |
| `Toggle Theme` | ダーク/ライトモード切り替え |
| `Export Deck` | Deck をエクスポート（将来実装） |
| `Keyboard Shortcuts` | キーバインド一覧表示 |

---

## 5. カスタマイズ

### 5.1 設定ファイル形式

```json
{
  "keybindings": {
    "normal": {
      "j": "card.next",
      "k": "card.prev",
      "h": "column.prev",
      "l": "column.next",
      "o": "card.create.below",
      "O": "card.create.above",
      "dd": "card.delete",
      "yy": "card.copy",
      "p": "card.paste.below",
      "P": "card.paste.above"
    },
    "insert": {
      "Escape": "mode.normal",
      "Ctrl+[": "mode.normal",
      "Ctrl+Enter": "card.save.and.create",
      "Shift+Enter": "card.save"
    },
    "command": {
      "Escape": "palette.close",
      "Enter": "palette.execute",
      "j": "palette.next",
      "k": "palette.prev"
    }
  }
}
```

### 5.2 コマンド一覧

| コマンドID | 説明 |
|:---|:---|
| `card.next` | 下のカードへ |
| `card.prev` | 上のカードへ |
| `card.create.below` | 下に新規カード |
| `card.create.above` | 上に新規カード |
| `card.delete` | カード削除 |
| `card.copy` | カードコピー |
| `card.paste.below` | 下にペースト |
| `card.paste.above` | 上にペースト |
| `card.score.up` | スコア +1 |
| `card.score.down` | スコア -1 |
| `column.next` | 右のカラムへ |
| `column.prev` | 左のカラムへ |
| `column.create` | 新規カラム |
| `column.delete` | カラム削除 |
| `column.rename` | カラム名変更 |
| `column.move.left` | カラムを左へ |
| `column.move.right` | カラムを右へ |
| `deck.switch` | Deck 切り替え |
| `deck.create` | 新規 Deck |
| `mode.normal` | Normal モードへ |
| `mode.insert` | Insert モードへ |
| `mode.command` | コマンドパレット表示 |
| `search.open` | 検索 |
| `filter.tag` | タグフィルタ |
| `filter.clear` | フィルタ解除 |
| `settings.open` | 設定を開く |
| `ai.draft` | AI 清書 |
| `theme.toggle` | テーマ切り替え |
| `undo` | 元に戻す |
| `redo` | やり直し |
| `help.shortcuts` | ショートカット一覧 |
| `palette.close` | パレットを閉じる |
| `palette.execute` | 選択コマンド実行 |
| `palette.next` | 次の候補 |
| `palette.prev` | 前の候補 |

---

## 6. 競合・未解決事項

| 項目 | 問題 | 案 |
|:---|:---|:---|
| `Ctrl+r` | Vim の Redo と Deck 切り替えが競合 | Deck 切り替えを `Ctrl+Shift+r` に変更、または Normal モード限定で `Ctrl+r` を Deck 切り替えに |
| `#` | Normal モードでタグジャンプ vs Insert モードでタグ入力 | Normal では `/` + `#tag` で検索、Insert では `#` でタグ補完 |
| マルチカーソル | CodeMirror の Vim モードではサポート限定的 | MVP では対応しない |
