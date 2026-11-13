//! Deck-scoped write operations backing the MCP write surface (008-mcp-server.md §4.1).
//!
//! Like `query.rs`, this is the trust boundary: visibility (deck membership,
//! `private`, deleted) is enforced here in core, never in the untrusted bridge
//! (008 §4.5). Writes only touch columns/cards inside the connection Deck's
//! visible range; anything outside is reported as `NotFound` (cards, to avoid
//! leaking existence) or `Unauthorized` (an explicitly named column).
//!
//! Capability gating (append/edit/delete) and per-connection rate limiting are
//! policy the bridge layers on top — they are about *what a connection may
//! invoke*, not *what data exists* — so they live in the bridge, not here.
//!
//! Numbering (ULID / position) and tag extraction stay centralized in the `card`
//! repository; this module validates scope, resolves move anchors to positions,
//! and delegates the mutation.
//!
//! Each mutation runs in one transaction together with its change-history row
//! (`history`, 008 §5.1), attributed to the caller's [`Author`].

use std::collections::HashSet;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::db::write_tx;
use crate::error::{JotDeckError, Result};
use crate::models::{Card, Column, NewCard};
use crate::repository::history::{self, Author, ChangeOp};
use crate::repository::{card, column, query};

/// 接続の書き込みスコープ（008 §4.5 の write allowlist）。
///
/// `None`＝制限なし（`private` を除く Deck 全体が書き込み可、＝ゼロ設定 KB の既定）。
/// `Some(set)`＝その ULID 集合のカラムだけに絞る（read より狭くてよい write allowlist）。
/// 実効書き込み範囲＝`可視（非 private・非削除）カラム` ∩ `allowlist`。read は絞らない。
#[derive(Debug, Clone, Default)]
pub struct WriteScope {
    allowed_columns: Option<HashSet<String>>,
}

impl WriteScope {
    /// 制限なし（可視カラム全体が書き込み可）。
    pub fn unrestricted() -> Self {
        Self {
            allowed_columns: None,
        }
    }

    /// 指定カラム ULID 集合に書き込みを絞る。空集合は「どこにも書けない」を意味する。
    pub fn allowlist(columns: impl IntoIterator<Item = String>) -> Self {
        Self {
            allowed_columns: Some(columns.into_iter().collect()),
        }
    }

    /// allowlist 未指定（全許可）か。`ensure_column` の新規作成可否に使う
    /// （allowlist 明示時は create 無効 → 008 §4.5）。
    pub fn is_unrestricted(&self) -> bool {
        self.allowed_columns.is_none()
    }

    /// 実効書き込みスコープの報告用。制限なしなら `None`、allowlist ありなら
    /// その column ULID を（安定順で）返す（describe_deck が晒す → 008 §4.6）。
    pub fn allowed_columns(&self) -> Option<Vec<String>> {
        self.allowed_columns.as_ref().map(|set| {
            let mut v: Vec<String> = set.iter().cloned().collect();
            v.sort();
            v
        })
    }

    /// `column_id` が書き込みスコープ内か。allowlist 未指定なら常に true。
    fn allows(&self, column_id: &str) -> bool {
        match &self.allowed_columns {
            None => true,
            Some(set) => set.contains(column_id),
        }
    }
}

/// 指定カラムが接続 Deck の可視範囲（非 private・非削除・当 Deck）にあることを検証する。
/// 範囲外なら Unauthorized。write allowlist は見ない ―― `ensure_column_writable` が
/// これに allowlist チェックを重ねる、可視性ステージ（NotFound ではなく権限拒否）。
fn ensure_column_visible(conn: &Connection, deck_id: &str, column_id: &str) -> Result<()> {
    if query::is_column_visible(conn, deck_id, column_id)? {
        Ok(())
    } else {
        Err(JotDeckError::Unauthorized(format!(
            "Column not accessible: {}",
            column_id
        )))
    }
}

/// 指定カラムが可視かつ **write allowlist 内**（書き込み可能）であることを検証する。
/// 明示指定されたカラムが範囲外なら Unauthorized（008 §4.5 の除外カラム挙動）。
fn ensure_column_writable(
    conn: &Connection,
    deck_id: &str,
    column_id: &str,
    scope: &WriteScope,
) -> Result<()> {
    ensure_column_visible(conn, deck_id, column_id)?;
    if !scope.allows(column_id) {
        return Err(JotDeckError::Unauthorized(format!(
            "Column not in this connection's write allowlist: {}",
            column_id
        )));
    }
    Ok(())
}

/// 指定カードが接続 Deck の可視カラムに属し、生存していることを検証して返す。
/// 可視範囲外・削除済み・別 Deck・不在はいずれも存在を漏らさず NotFound（008 §4.5）。
fn visible_card(conn: &Connection, deck_id: &str, card_id: &str) -> Result<Card> {
    let not_found = || JotDeckError::NotFound(format!("Card not found: {}", card_id));
    let c = card::get_by_id(conn, card_id).map_err(|_| not_found())?;
    if c.deleted_at.is_some() {
        return Err(not_found());
    }
    if !query::is_column_visible(conn, deck_id, &c.column_id)? {
        return Err(not_found());
    }
    Ok(c)
}

/// 書き込み対象のカードを検証して返す。可視でなければ NotFound（存在を漏らさない）。
/// 可視だが write allowlist 外のカラムに属す場合は Unauthorized ―― カードの存在自体は
/// read 面（allowlist で絞られない）で既に辿れるため、漏洩ではなく権限エラーが妥当
/// （008 §4.5 の `patch_card`/`delete_card` 行）。
fn writable_card(
    conn: &Connection,
    deck_id: &str,
    card_id: &str,
    scope: &WriteScope,
) -> Result<Card> {
    let card = visible_card(conn, deck_id, card_id)?;
    if !scope.allows(&card.column_id) {
        return Err(JotDeckError::Unauthorized(format!(
            "Card's column is not in this connection's write allowlist: {}",
            card.column_id
        )));
    }
    Ok(card)
}

/// カード本文の長さ backstop を検査する（008 §5）。これは**外部エージェント書き込みの
/// 抑止**（暴走 append の backstop）であり、GUI/CLI の手編集に課す普遍的な不変条件では
/// ない ―― だから `card::create` / `update_content_cas` ではなく、この MCP 書き込み面に
/// 置く。超過時は分割を促すエラーを返し、エージェントを正しい振る舞いへ誘導する。
fn ensure_card_length(content: &str) -> Result<()> {
    let len = content.chars().count();
    if len > query::MAX_CARD_LENGTH {
        return Err(JotDeckError::InvalidOperation(format!(
            "Card content too long: {} chars (max {}). Split it into several shorter cards.",
            len,
            query::MAX_CARD_LENGTH
        )));
    }
    Ok(())
}

fn lookup_idempotent(conn: &Connection, deck_id: &str, key: &str) -> Result<Option<String>> {
    let id: Option<String> = conn
        .query_row(
            "SELECT card_id FROM idempotency_keys WHERE deck_id = ?1 AND key = ?2",
            params![deck_id, key],
            |row| row.get(0),
        )
        .optional()?;
    Ok(id)
}

/// アンカー（`before` / `after` のどちらか一方）を、生存兄弟 id 列（移動対象を除く、
/// position 昇順）に対する挿入 index に解決する。`before`=そのアンカーの index、
/// `after`=+1、どちらも無し=末尾（len）。`kind` は not-found エラー文言に使う。
/// 呼び出し側が事前に「both anchors 指定」を弾き、必要ならアンカーの可視性を検証する。
/// move_card / move_column が共有する（アンカー→position の意味を 1 か所に持つ）。
fn resolve_anchor_index(
    others: &[String],
    before: Option<&str>,
    after: Option<&str>,
    kind: &str,
) -> Result<usize> {
    let index_of = |anchor: &str| -> Result<usize> {
        others.iter().position(|id| id == anchor).ok_or_else(|| {
            JotDeckError::InvalidOperation(format!("Anchor {} not found: {}", kind, anchor))
        })
    };
    Ok(match (before, after) {
        (Some(b), None) => index_of(b)?,
        (None, Some(a)) => index_of(a)? + 1,
        _ => others.len(),
    })
}

/// 変更前後が異なるときだけ履歴を 1 行記録する（同じ位置への move・同値の patch
/// など、実質 no-op の書き込みで Activity を埋めない）。
fn record_change(
    conn: &Connection,
    deck_id: &str,
    target_id: &str,
    op: ChangeOp,
    before: Option<Value>,
    after: Value,
    author: &Author,
) -> Result<()> {
    if before.as_ref() == Some(&after) {
        return Ok(());
    }
    history::record(conn, deck_id, target_id, op, before, Some(after), author)
}

/// 直前の兄弟の id（先頭なら null）。履歴は位置をこのアンカーで持つ（`history::ChangeOp`）。
fn preceding_id(ordered: &[String], id: &str) -> Value {
    match ordered.iter().position(|x| x == id) {
        Some(i) if i > 0 => json!(ordered[i - 1]),
        _ => Value::Null,
    }
}

/// カードの位置（所属カラム＋直前のカード）。
fn card_placement(conn: &Connection, card_id: &str) -> Result<Value> {
    let c = card::get_by_id(conn, card_id)?;
    let siblings: Vec<String> = card::get_by_column_id(conn, &c.column_id)?
        .into_iter()
        .map(|c| c.id)
        .collect();
    Ok(json!({
        "column_id": c.column_id,
        "after_card_id": preceding_id(&siblings, card_id),
    }))
}

/// カラムの位置（直前のカラム）。
fn column_placement(conn: &Connection, deck_id: &str, column_id: &str) -> Result<Value> {
    let siblings: Vec<String> = column::get_by_deck_id(conn, deck_id)?
        .into_iter()
        .map(|c| c.id)
        .collect();
    Ok(json!({ "after_column_id": preceding_id(&siblings, column_id) }))
}

/// `update_column` が変えうるカラム属性。
fn column_attrs(c: &Column) -> Value {
    json!({ "name": c.name, "description": c.description, "private": c.private })
}

/// カラム末尾にカードを作成する（`append_card`）。
///
/// `idempotency_key` を添えると、同一 (deck, key) の再送は新規作成せず既存カードを
/// 返す（ホスト再送での重複防止 → 008 §5）。position 採番・ULID 発番・`#tag` 抽出は
/// `card` リポジトリが担う。
pub fn append_card(
    conn: &Connection,
    deck_id: &str,
    column_id: &str,
    content: &str,
    idempotency_key: Option<&str>,
    scope: &WriteScope,
    author: &Author,
) -> Result<Card> {
    ensure_column_writable(conn, deck_id, column_id, scope)?;
    ensure_card_length(content)?;

    // 冪等キーが既にあれば、その時点のカードを返す（再送＝no-op）。書き込みゲートを
    // 通すので、写像先カードが private カラムへ移動 / 削除済みなら NotFound、write
    // allowlist 外なら Unauthorized になり、境界からアクセス不可な内容を漏らさない。
    if let Some(key) = idempotency_key {
        if let Some(existing) = lookup_idempotent(conn, deck_id, key)? {
            return writable_card(conn, deck_id, &existing, scope);
        }
    }

    let tx = write_tx(conn)?;
    let created = card::create(
        &tx,
        NewCard {
            column_id: column_id.to_string(),
            content: content.to_string(),
        },
    )?;
    if let Some(key) = idempotency_key {
        // 同一キーで別プロセスが並行に先着した場合、PK 制約で例外にせず OR IGNORE で
        // 0 行を検知し、自分が作ったカードを破棄（tx ロールバック）して先着カードを返す
        // ―― 再送安全の約束を並行下でも保つ。
        let inserted = tx.execute(
            "INSERT OR IGNORE INTO idempotency_keys (deck_id, key, card_id, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![deck_id, key, created.id, Utc::now().to_rfc3339()],
        )?;
        if inserted == 0 {
            drop(tx); // 未 commit のまま破棄 → 作成したカードを取り消す
            let winner = lookup_idempotent(conn, deck_id, key)?.ok_or_else(|| {
                JotDeckError::Conflict("idempotency race left no resolvable key".to_string())
            })?;
            return writable_card(conn, deck_id, &winner, scope);
        }
    }
    record_change(
        &tx,
        deck_id,
        &created.id,
        ChangeOp::AppendCard,
        None,
        json!({ "column_id": created.column_id, "content": created.content }),
        author,
    )?;
    tx.commit()?;
    Ok(created)
}

/// 既存カードの本文を確定 edit する（`patch_card`）。楽観ロック（`expected_updated_at`
/// の compare-and-swap）で lost update を防ぐ（002 §5.3）。
pub fn patch_card(
    conn: &Connection,
    deck_id: &str,
    card_id: &str,
    content: &str,
    expected_updated_at: chrono::DateTime<Utc>,
    scope: &WriteScope,
    author: &Author,
) -> Result<Card> {
    ensure_card_length(content)?;
    let tx = write_tx(conn)?;
    let before = writable_card(&tx, deck_id, card_id, scope)?;
    let card = card::update_content_cas(&tx, card_id, content, expected_updated_at)?;
    record_change(
        &tx,
        deck_id,
        card_id,
        ChangeOp::PatchCard,
        Some(json!({ "content": before.content })),
        json!({ "content": card.content }),
        author,
    )?;
    tx.commit()?;
    Ok(card)
}

/// ストリーム開始 ―― 対象カードを Reporter 占有としてロック取得する（`card.stream.begin`,
/// 007 §6.2 / §7）。可視カード（別 Deck / private / 削除済みは `NotFound`）に対し
/// `card::acquire_lock` を呼び、他者が有効占有中なら `Conflict`。取得成功でロック済みカードを
/// 返す。`holder` は Reporter の識別子（占有ロックの `locked_by`, 002 §5.2）。
pub fn begin_card_stream(
    conn: &Connection,
    deck_id: &str,
    card_id: &str,
    holder: &str,
    scope: &WriteScope,
) -> Result<Card> {
    writable_card(conn, deck_id, card_id, scope)?;
    card::acquire_lock(conn, card_id, holder)
}

/// ストリーム終了 ―― 最終テキストを commit しロックを解放する（`card.stream.end`, 007 §6.2）。
///
/// ストリーム中は占有ロックが排他制御なので、CAS（`patch_card` の `expected_updated_at`）は
/// 取らない ―― 代わりに **`holder` がロックを保持している間だけ書く**。確認・書き込み・解放を
/// `card::commit_stream_and_release` が 1 本の条件付き UPDATE で原子的に行うため、判定と
/// 書き込みの隙に他プロセスがリース失効ロックを奪って書きかけを上書きする TOCTOU が起きない。
/// 失効・奪取済みなら `Conflict`（削除済みなら `InvalidOperation`）を返し、書きかけを黙って
/// 上書きさせない。
pub fn end_card_stream(
    conn: &Connection,
    deck_id: &str,
    card_id: &str,
    holder: &str,
    content: &str,
    scope: &WriteScope,
    author: &Author,
) -> Result<Card> {
    ensure_card_length(content)?;
    let tx = write_tx(conn)?;
    let before = writable_card(&tx, deck_id, card_id, scope)?;
    let card = card::commit_stream_and_release(&tx, card_id, holder, content)?;
    record_change(
        &tx,
        deck_id,
        card_id,
        ChangeOp::StreamCard,
        Some(json!({ "content": before.content })),
        json!({ "content": card.content }),
        author,
    )?;
    tx.commit()?;
    Ok(card)
}

/// カードを論理削除する（`delete_card`）。物理削除・復元はエージェントに公開せず、
/// 30 日後の cleanup とユーザの削除スタックに委ねる（008 §4.1）。
pub fn delete_card(
    conn: &Connection,
    deck_id: &str,
    card_id: &str,
    scope: &WriteScope,
    author: &Author,
) -> Result<Card> {
    let tx = write_tx(conn)?;
    writable_card(&tx, deck_id, card_id, scope)?;
    card::soft_delete(&tx, card_id)?;
    record_change(
        &tx,
        deck_id,
        card_id,
        ChangeOp::DeleteCard,
        Some(json!({ "deleted": false })),
        json!({ "deleted": true }),
        author,
    )?;
    let card = card::get_by_id(&tx, card_id)?;
    tx.commit()?;
    Ok(card)
}

/// カードをカラム間移動 / 並べ替えする（`move_card`）。
///
/// 移動先は接続 Deck 内の可視カラムに限る（Deck 越え不可 → 008 §4.4）。順序は生の
/// position ではなく **アンカー**（`before_card_id` / `after_card_id`）で表明し、実際の
/// position は本体が採番する。どちらも省略すると移動先の末尾。両方指定はエラー。
/// 同じ位置への move は no-op（再送に安全）。
#[allow(clippy::too_many_arguments)] // 引数は tool の引数と 1:1
pub fn move_card(
    conn: &Connection,
    deck_id: &str,
    card_id: &str,
    to_column_id: Option<&str>,
    before_card_id: Option<&str>,
    after_card_id: Option<&str>,
    scope: &WriteScope,
    author: &Author,
) -> Result<Card> {
    if before_card_id.is_some() && after_card_id.is_some() {
        return Err(JotDeckError::InvalidOperation(
            "Specify only one of before_card_id / after_card_id".to_string(),
        ));
    }

    let tx = write_tx(conn)?;
    let conn: &Connection = &tx;
    let card = writable_card(conn, deck_id, card_id, scope)?;
    let target_col = to_column_id.unwrap_or(&card.column_id);
    ensure_column_writable(conn, deck_id, target_col, scope)?;
    let before = card_placement(conn, card_id)?;

    // 移動先カラムの生存カードを position 順に、移動対象を除いて列挙する。card
    // リポジトリの列挙を再利用し、順序/論理削除の規則をここに二重で持たない。カードは
    // 可視カラムに属せば可視なので、アンカーの追加検証は不要（列に無ければ not-found）。
    let others: Vec<String> = card::get_by_column_id(conn, target_col)?
        .into_iter()
        .map(|c| c.id)
        .filter(|id| id != card_id)
        .collect();
    let target_index = resolve_anchor_index(&others, before_card_id, after_card_id, "card")?;

    // カラムを跨ぐ場合はまず移動先の末尾へ運び（採番一元化）、続いて目的 index へ寄せる。
    // 両段は外側の 1 トランザクションに入るので、中間の末尾位置は他から観測されない。
    if target_col != card.column_id {
        card::move_to_column(conn, card_id, target_col)?;
    }
    // このとき対象は移動先カラムに属し、全 len+1 件中の dense index を target_index にする。
    let moved = card::move_to_position(conn, card_id, target_index as i32)?;
    let after = card_placement(conn, card_id)?;
    record_change(conn, deck_id, card_id, ChangeOp::MoveCard, Some(before), after, author)?;
    tx.commit()?;
    Ok(moved)
}

// ---- 構造再編（008 §4.1）: カラムの作成/更新/並べ替え ----

/// `ensure_column` の結果。`created` が true なら新規作成、false なら既存取得（get）。
#[derive(Debug, Clone)]
pub struct EnsureColumnResult {
    pub column: Column,
    pub created: bool,
}

/// 書き込みスコープ内（非削除・非 private ∩ write allowlist）で name に一致する最初の
/// カラムを返す。column リポジトリの列挙（非削除・position 昇順）を再利用し、非 private と
/// allowlist をここで絞る ―― 可視性の SQL 述語を write.rs に二重で持たない。スコープ外の
/// 同名はヒットさせない（allowlist はスコープの一部なので get も allowlist 内で解決）。
/// 列は ULID キーなので見かけ上の重複名は許容し、先頭を返す。
fn find_writable_column_by_name(
    conn: &Connection,
    deck_id: &str,
    name: &str,
    scope: &WriteScope,
) -> Result<Option<Column>> {
    Ok(column::get_by_deck_id(conn, deck_id)?
        .into_iter()
        .find(|c| !c.private && scope.allows(&c.id) && c.name == name))
}

/// カラム名を正規化（前後空白を除去）して返す。空（空白のみ含む）は拒否する。
/// `ensure_column` の lookup/作成キーと `update_column` の改名でこの規則を共有する。
fn normalize_column_name(name: &str) -> Result<&str> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(JotDeckError::InvalidOperation(
            "Column name must not be empty".to_string(),
        ));
    }
    Ok(trimmed)
}

/// 名前キーで get-or-create するべき等なカラム作成（`ensure_column`）。
///
/// 書き込みスコープ内に同名カラムがあればそれを返す（get）。無ければ末尾に作成する
/// （create）。ただし **write allowlist を明示した接続では create は不可**（固定集合の
/// 意図と排他 → 008 §4.5）で `InvalidOperation` を返す ―― この可否は `scope` から導出し、
/// 呼び出し側が別引数で渡さない（両者が食い違い「書けないカラムを作る」不整合を防ぐ）。
/// 既存カラムの get はスコープ内で解決し、allowlist の有無に依らず妨げない。structure
/// capability の deny は bridge が tool を封じるため、ここへは到達しない。
pub fn ensure_column(
    conn: &Connection,
    deck_id: &str,
    name: &str,
    description: &str,
    private: bool,
    scope: &WriteScope,
    author: &Author,
) -> Result<EnsureColumnResult> {
    // 正規化した名前で lookup も作成も行う（raw と trimmed が食い違わないように）。
    let name = normalize_column_name(name)?;

    // get は書き込みロックを取らずに済ませる（他プロセスの書き込みを待たない）。
    // 作成するときだけ書き込みトランザクションに入り、並行作成に備えて引き直す。
    let existing = |conn: &Connection| -> Result<Option<EnsureColumnResult>> {
        Ok(find_writable_column_by_name(conn, deck_id, name, scope)?.map(|column| {
            EnsureColumnResult {
                column,
                created: false,
            }
        }))
    };
    if let Some(found) = existing(conn)? {
        return Ok(found);
    }
    let tx = write_tx(conn)?;
    let conn: &Connection = &tx;
    if let Some(found) = existing(conn)? {
        return Ok(found);
    }

    // allowlist を持つ接続は固定集合の意図なので新規作成しない。
    if !scope.is_unrestricted() {
        return Err(JotDeckError::InvalidOperation(format!(
            "No column named '{}' is writable, and this connection's write allowlist forbids creating one",
            name
        )));
    }

    let desc_arg = if description.is_empty() {
        None
    } else {
        Some(description)
    };
    let column = column::create_with(conn, deck_id, name, desc_arg, private)?;
    record_change(
        conn,
        deck_id,
        &column.id,
        ChangeOp::CreateColumn,
        None,
        column_attrs(&column),
        author,
    )?;
    tx.commit()?;
    Ok(EnsureColumnResult {
        column,
        created: true,
    })
}

/// カラムの name / description / private を更新する（`update_column`）。各引数は None で
/// 据え置き、`description` は `Some(None)` で NULL クリア。対象は接続 Deck の可視・書き込み
/// 可能カラムに限る（private / 別 Deck / 削除済みは Unauthorized）。
#[allow(clippy::too_many_arguments)] // 引数は tool の引数と 1:1
pub fn update_column(
    conn: &Connection,
    deck_id: &str,
    column_id: &str,
    name: Option<&str>,
    description: Option<Option<&str>>,
    private: Option<bool>,
    scope: &WriteScope,
    author: &Author,
) -> Result<Column> {
    // 改名する場合は ensure_column と同じ正規化・空名拒否を適用する。
    let name = name.map(normalize_column_name).transpose()?;
    let tx = write_tx(conn)?;
    ensure_column_writable(&tx, deck_id, column_id, scope)?;
    let before = column_attrs(&column::get_by_id(&tx, column_id)?);
    let updated = column::update(&tx, column_id, name, description, private)?;
    record_change(
        &tx,
        deck_id,
        column_id,
        ChangeOp::UpdateColumn,
        Some(before),
        column_attrs(&updated),
        author,
    )?;
    tx.commit()?;
    Ok(updated)
}

/// カラムを並べ替える（`move_column`）。順序は生の position ではなくアンカー
/// （`before_column_id` / `after_column_id`, どちらか一方）で表明し、position は本体が
/// 採番する。どちらも省略すると末尾。対象・アンカーは接続 Deck の可視カラムに限る。
pub fn move_column(
    conn: &Connection,
    deck_id: &str,
    column_id: &str,
    before_column_id: Option<&str>,
    after_column_id: Option<&str>,
    scope: &WriteScope,
    author: &Author,
) -> Result<Column> {
    if before_column_id.is_some() && after_column_id.is_some() {
        return Err(JotDeckError::InvalidOperation(
            "Specify only one of before_column_id / after_column_id".to_string(),
        ));
    }

    let tx = write_tx(conn)?;
    let conn: &Connection = &tx;
    ensure_column_writable(conn, deck_id, column_id, scope)?;
    // アンカーも書き込みスコープ内に限る（private / allowlist 外を anchor に使わせない）。
    // both-anchors は上で弾いているので Some は高々 1 つ。
    for anchor in [before_column_id, after_column_id].into_iter().flatten() {
        ensure_column_writable(conn, deck_id, anchor, scope)?;
    }

    // Deck の生存カラムを position 順に、移動対象を除いて列挙する（column リポジトリの
    // 列挙を再利用）。move_to_position は同じ全生存集合上で index を解釈するため、その集合で
    // アンカーの index を解決すれば整合する。
    let others: Vec<String> = column::get_by_deck_id(conn, deck_id)?
        .into_iter()
        .map(|c| c.id)
        .filter(|id| id != column_id)
        .collect();
    let target_index = resolve_anchor_index(&others, before_column_id, after_column_id, "column")?;

    let before = column_placement(conn, deck_id, column_id)?;
    let moved = column::move_to_position(conn, column_id, target_index as i32)?;
    let after = column_placement(conn, deck_id, column_id)?;
    record_change(conn, deck_id, column_id, ChangeOp::MoveColumn, Some(before), after, author)?;
    tx.commit()?;
    Ok(moved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_in_memory;
    use crate::models::{NewColumn, NewDeck, SortOrder};
    use crate::repository::{card, column, deck};

    /// テスト用の書き込み主。
    fn au() -> Author {
        Author::mcp("test-conn", None)
    }

    /// 既定の（制限なし）書き込みスコープ。allowlist を試すテストは個別に組む。
    fn sc() -> WriteScope {
        WriteScope::unrestricted()
    }

    struct Fixture {
        conn: Connection,
        deck_id: String,
        public_col: String,
        private_col: String,
    }

    fn setup() -> Fixture {
        let conn = create_in_memory().unwrap();
        let d = deck::create(
            &conn,
            NewDeck {
                name: "KB".to_string(),
                sort_order: SortOrder::default(),
            },
        )
        .unwrap();
        let public_col = column::create(
            &conn,
            NewColumn {
                deck_id: d.id.clone(),
                name: "Public".to_string(),
            },
        )
        .unwrap();
        let private_col = column::create(
            &conn,
            NewColumn {
                deck_id: d.id.clone(),
                name: "Secret".to_string(),
            },
        )
        .unwrap();
        column::update(&conn, &private_col.id, None, None, Some(true)).unwrap();
        Fixture {
            conn,
            deck_id: d.id,
            public_col: public_col.id,
            private_col: private_col.id,
        }
    }

    fn contents(f: &Fixture, col: &str) -> Vec<String> {
        card::get_by_column_id(&f.conn, col)
            .unwrap()
            .into_iter()
            .map(|c| c.content)
            .collect()
    }

    #[test]
    fn append_creates_card_at_tail() {
        let f = setup();
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "first", None, &sc(), &au()).unwrap();
        let b = append_card(&f.conn, &f.deck_id, &f.public_col, "second", None, &sc(), &au()).unwrap();
        assert_eq!(a.position, 0);
        assert_eq!(b.position, 1);
        assert_eq!(contents(&f, &f.public_col), vec!["first", "second"]);
    }

    #[test]
    fn append_to_private_column_is_unauthorized() {
        let f = setup();
        let err = append_card(&f.conn, &f.deck_id, &f.private_col, "x", None, &sc(), &au()).unwrap_err();
        assert!(matches!(err, JotDeckError::Unauthorized(_)));
    }

    #[test]
    fn append_to_other_deck_column_is_unauthorized() {
        let f = setup();
        let other = deck::create(
            &f.conn,
            NewDeck {
                name: "Other".to_string(),
                sort_order: SortOrder::default(),
            },
        )
        .unwrap();
        let other_col = column::create(
            &f.conn,
            NewColumn {
                deck_id: other.id,
                name: "Elsewhere".to_string(),
            },
        )
        .unwrap();
        let err = append_card(&f.conn, &f.deck_id, &other_col.id, "x", None, &sc(), &au()).unwrap_err();
        assert!(matches!(err, JotDeckError::Unauthorized(_)));
    }

    #[test]
    fn append_rejects_too_long_content() {
        let f = setup();
        let long = "a".repeat(query::MAX_CARD_LENGTH + 1);
        let err = append_card(&f.conn, &f.deck_id, &f.public_col, &long, None, &sc(), &au()).unwrap_err();
        assert!(matches!(err, JotDeckError::InvalidOperation(_)));
    }

    #[test]
    fn append_is_idempotent_per_key() {
        let f = setup();
        let first = append_card(&f.conn, &f.deck_id, &f.public_col, "once", Some("k1"), &sc(), &au()).unwrap();
        // 同一キーの再送は新規作成せず同じ id を返す。
        let again = append_card(&f.conn, &f.deck_id, &f.public_col, "ignored", Some("k1"), &sc(), &au()).unwrap();
        assert_eq!(first.id, again.id);
        assert_eq!(again.content, "once");
        assert_eq!(card::get_by_column_id(&f.conn, &f.public_col).unwrap().len(), 1);
    }

    #[test]
    fn idempotent_replay_of_card_moved_to_private_is_not_found() {
        let f = setup();
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "orig", Some("k"), &sc(), &au()).unwrap();
        // The mapped card is later moved into the private column.
        card::move_to_column(&f.conn, &a.id, &f.private_col).unwrap();
        // Resending to the (still writable) public column must not hand back the
        // now-inaccessible card through the write surface.
        let err = append_card(&f.conn, &f.deck_id, &f.public_col, "x", Some("k"), &sc(), &au()).unwrap_err();
        assert!(matches!(err, JotDeckError::NotFound(_)));
    }

    #[test]
    fn idempotency_key_is_purged_when_card_is_physically_deleted() {
        let f = setup();
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "orig", Some("k"), &sc(), &au()).unwrap();
        // Simulate the 30-day cleanup physically removing the card; the ON DELETE
        // CASCADE FK drops the idempotency key with it.
        f.conn
            .execute("DELETE FROM cards WHERE id = ?1", params![a.id])
            .unwrap();
        // The same key now creates a fresh card instead of resolving to the gone one.
        let b = append_card(&f.conn, &f.deck_id, &f.public_col, "again", Some("k"), &sc(), &au()).unwrap();
        assert_ne!(a.id, b.id);
        assert_eq!(b.content, "again");
    }

    #[test]
    fn idempotency_is_scoped_per_deck() {
        let f = setup();
        // 別 Deck で同じキーを使っても衝突しない。
        let other = deck::create(
            &f.conn,
            NewDeck {
                name: "Other".to_string(),
                sort_order: SortOrder::default(),
            },
        )
        .unwrap();
        let other_col = column::create(
            &f.conn,
            NewColumn {
                deck_id: other.id.clone(),
                name: "C".to_string(),
            },
        )
        .unwrap();
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "deck a", Some("dup"), &sc(), &au()).unwrap();
        let b = append_card(&f.conn, &other.id, &other_col.id, "deck b", Some("dup"), &sc(), &au()).unwrap();
        assert_ne!(a.id, b.id);
        assert_eq!(a.content, "deck a");
        assert_eq!(b.content, "deck b");
    }

    #[test]
    fn patch_with_stale_cas_conflicts_and_leaves_no_trace() {
        let f = setup();
        let c = append_card(&f.conn, &f.deck_id, &f.public_col, "orig", None, &sc(), &au()).unwrap();
        patch_card(&f.conn, &f.deck_id, &c.id, "first", c.updated_at, &sc(), &au()).unwrap();
        let history_before = history_of(&f).len();

        // 古い updated_at での patch は Conflict で、内容も履歴も変えない。
        let err = patch_card(&f.conn, &f.deck_id, &c.id, "second", c.updated_at, &sc(), &au()).unwrap_err();
        assert!(matches!(err, JotDeckError::Conflict(_)));
        assert_eq!(contents(&f, &f.public_col), vec!["first"]);
        assert_eq!(history_of(&f).len(), history_before);
    }

    #[test]
    fn patch_on_private_card_is_not_found() {
        let f = setup();
        let hidden = card::create(
            &f.conn,
            NewCard {
                column_id: f.private_col.clone(),
                content: "secret".to_string(),
            },
        )
        .unwrap();
        let err = patch_card(&f.conn, &f.deck_id, &hidden.id, "x", hidden.updated_at, &sc(), &au()).unwrap_err();
        assert!(matches!(err, JotDeckError::NotFound(_)));
    }

    #[test]
    fn delete_soft_deletes_visible_card() {
        let f = setup();
        let c = append_card(&f.conn, &f.deck_id, &f.public_col, "bye", None, &sc(), &au()).unwrap();
        let deleted = delete_card(&f.conn, &f.deck_id, &c.id, &sc(), &au()).unwrap();
        assert!(deleted.deleted_at.is_some());
        assert!(card::get_by_column_id(&f.conn, &f.public_col).unwrap().is_empty());
    }

    #[test]
    fn delete_on_private_card_is_not_found() {
        let f = setup();
        let hidden = card::create(
            &f.conn,
            NewCard {
                column_id: f.private_col.clone(),
                content: "secret".to_string(),
            },
        )
        .unwrap();
        let err = delete_card(&f.conn, &f.deck_id, &hidden.id, &sc(), &au()).unwrap_err();
        assert!(matches!(err, JotDeckError::NotFound(_)));
    }

    #[test]
    fn move_within_column_before_anchor() {
        let f = setup();
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "A", None, &sc(), &au()).unwrap();
        let _b = append_card(&f.conn, &f.deck_id, &f.public_col, "B", None, &sc(), &au()).unwrap();
        let _c = append_card(&f.conn, &f.deck_id, &f.public_col, "C", None, &sc(), &au()).unwrap();

        // A を C の前へ: (A,B,C) -> (B,A,C)
        move_card(&f.conn, &f.deck_id, &a.id, None, Some(&_c.id), None, &sc(), &au()).unwrap();
        assert_eq!(contents(&f, &f.public_col), vec!["B", "A", "C"]);
    }

    #[test]
    fn move_within_column_after_anchor() {
        let f = setup();
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "A", None, &sc(), &au()).unwrap();
        let b = append_card(&f.conn, &f.deck_id, &f.public_col, "B", None, &sc(), &au()).unwrap();
        let _c = append_card(&f.conn, &f.deck_id, &f.public_col, "C", None, &sc(), &au()).unwrap();

        // A を B の後ろへ: (A,B,C) -> (B,A,C)
        move_card(&f.conn, &f.deck_id, &a.id, None, None, Some(&b.id), &sc(), &au()).unwrap();
        assert_eq!(contents(&f, &f.public_col), vec!["B", "A", "C"]);
    }

    #[test]
    fn move_to_tail_when_no_anchor() {
        let f = setup();
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "A", None, &sc(), &au()).unwrap();
        let _b = append_card(&f.conn, &f.deck_id, &f.public_col, "B", None, &sc(), &au()).unwrap();
        let _c = append_card(&f.conn, &f.deck_id, &f.public_col, "C", None, &sc(), &au()).unwrap();

        move_card(&f.conn, &f.deck_id, &a.id, None, None, None, &sc(), &au()).unwrap();
        assert_eq!(contents(&f, &f.public_col), vec!["B", "C", "A"]);
    }

    #[test]
    fn move_across_columns_to_anchor() {
        let f = setup();
        let second = column::create(
            &f.conn,
            NewColumn {
                deck_id: f.deck_id.clone(),
                name: "Second".to_string(),
            },
        )
        .unwrap();
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "A", None, &sc(), &au()).unwrap();
        let x = append_card(&f.conn, &f.deck_id, &second.id, "X", None, &sc(), &au()).unwrap();
        let _y = append_card(&f.conn, &f.deck_id, &second.id, "Y", None, &sc(), &au()).unwrap();

        // A を Second カラムの X の前へ移動: Second -> (A, X, Y)
        let moved = move_card(&f.conn, &f.deck_id, &a.id, Some(&second.id), Some(&x.id), None, &sc(), &au()).unwrap();
        assert_eq!(moved.column_id, second.id);
        assert_eq!(moved.position, 0);
        assert!(contents(&f, &f.public_col).is_empty());
        assert_eq!(contents(&f, &second.id), vec!["A", "X", "Y"]);
    }

    #[test]
    fn move_into_private_column_is_unauthorized() {
        let f = setup();
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "A", None, &sc(), &au()).unwrap();
        let err = move_card(&f.conn, &f.deck_id, &a.id, Some(&f.private_col), None, None, &sc(), &au()).unwrap_err();
        assert!(matches!(err, JotDeckError::Unauthorized(_)));
    }

    #[test]
    fn move_rejects_both_anchors() {
        let f = setup();
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "A", None, &sc(), &au()).unwrap();
        let b = append_card(&f.conn, &f.deck_id, &f.public_col, "B", None, &sc(), &au()).unwrap();
        let c = append_card(&f.conn, &f.deck_id, &f.public_col, "C", None, &sc(), &au()).unwrap();
        let err = move_card(&f.conn, &f.deck_id, &a.id, None, Some(&b.id), Some(&c.id), &sc(), &au()).unwrap_err();
        assert!(matches!(err, JotDeckError::InvalidOperation(_)));
    }

    // ---- 構造再編 ----

    fn column_names(f: &Fixture) -> Vec<String> {
        column::get_by_deck_id(&f.conn, &f.deck_id)
            .unwrap()
            .into_iter()
            .map(|c| c.name)
            .collect()
    }

    #[test]
    fn ensure_column_creates_when_allowed() {
        let f = setup();
        let r = ensure_column(&f.conn, &f.deck_id, "Research", "papers to read", false, &sc(), &au()).unwrap();
        assert!(r.created);
        assert_eq!(r.column.name, "Research");
        assert_eq!(r.column.description.as_deref(), Some("papers to read"));
        assert!(!r.column.private);
    }

    #[test]
    fn ensure_column_is_idempotent_by_name() {
        let f = setup();
        let a = ensure_column(&f.conn, &f.deck_id, "ToDo", "tasks", false, &sc(), &au()).unwrap();
        assert!(a.created);
        // 同名の再呼び出しは新規作成せず既存を返す（get）。
        let b = ensure_column(&f.conn, &f.deck_id, "ToDo", "ignored", false, &sc(), &au()).unwrap();
        assert!(!b.created);
        assert_eq!(a.column.id, b.column.id);
        assert_eq!(b.column.description.as_deref(), Some("tasks")); // 変更されない
    }

    // create の不可（write allowlist 明示時）は allowlist 節のテストで担保する
    // ―― allow_create は scope から導出するようになり、独立引数では作れない。

    #[test]
    fn ensure_column_does_not_match_private_same_name() {
        let f = setup();
        // private カラムを "Hidden" にリネームしておく。
        column::update(&f.conn, &f.private_col, Some("Hidden"), None, None).unwrap();
        // 同名 ensure は private をヒットさせず、新規作成する。
        let r = ensure_column(&f.conn, &f.deck_id, "Hidden", "d", false, &sc(), &au()).unwrap();
        assert!(r.created);
        assert_ne!(r.column.id, f.private_col);
    }

    #[test]
    fn ensure_column_rejects_empty_name() {
        let f = setup();
        let err = ensure_column(&f.conn, &f.deck_id, "   ", "d", false, &sc(), &au()).unwrap_err();
        assert!(matches!(err, JotDeckError::InvalidOperation(_)));
    }

    #[test]
    fn ensure_column_normalizes_name_for_lookup_and_create() {
        let f = setup();
        // Create with surrounding whitespace → stored trimmed.
        let a = ensure_column(&f.conn, &f.deck_id, "  Ideas  ", "d", false, &sc(), &au()).unwrap();
        assert!(a.created);
        assert_eq!(a.column.name, "Ideas");
        // A differently-padded spelling resolves to the same column (get, not create).
        let b = ensure_column(&f.conn, &f.deck_id, "Ideas", "d", false, &sc(), &au()).unwrap();
        assert!(!b.created);
        assert_eq!(a.column.id, b.column.id);
    }

    #[test]
    fn update_column_rejects_whitespace_name() {
        let f = setup();
        let err = update_column(&f.conn, &f.deck_id, &f.public_col, Some("   "), None, None, &sc(), &au()).unwrap_err();
        assert!(matches!(err, JotDeckError::InvalidOperation(_)));
    }

    #[test]
    fn ensure_column_can_create_private() {
        let f = setup();
        let r = ensure_column(&f.conn, &f.deck_id, "Secrets", "sensitive", true, &sc(), &au()).unwrap();
        assert!(r.created);
        assert!(r.column.private);
    }

    #[test]
    fn update_column_changes_fields() {
        let f = setup();
        let updated = update_column(
            &f.conn,
            &f.deck_id,
            &f.public_col,
            Some("Renamed"),
            Some(Some("new axis")),
            None,
        &sc(),
        &au(),
        )
        .unwrap();
        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.description.as_deref(), Some("new axis"));
    }

    #[test]
    fn update_column_on_private_is_unauthorized() {
        let f = setup();
        let err = update_column(&f.conn, &f.deck_id, &f.private_col, Some("x"), None, None, &sc(), &au()).unwrap_err();
        assert!(matches!(err, JotDeckError::Unauthorized(_)));
    }

    #[test]
    fn move_column_reorders_by_anchor() {
        let f = setup();
        // 可視カラム: public_col(A) then create B, C.
        column::update(&f.conn, &f.public_col, Some("A"), None, None).unwrap();
        let b = ensure_column(&f.conn, &f.deck_id, "B", "", false, &sc(), &au()).unwrap().column;
        let c = ensure_column(&f.conn, &f.deck_id, "C", "", false, &sc(), &au()).unwrap().column;

        // A を C の後ろへ。private_col は非表示だが position は全生存集合で一貫。
        move_column(&f.conn, &f.deck_id, &f.public_col, None, Some(&c.id), &sc(), &au()).unwrap();
        let names = column_names(&f);
        // A が C の直後に来る（Secret[private] の相対位置は保存）。
        let pos_a = names.iter().position(|n| n == "A").unwrap();
        let pos_c = names.iter().position(|n| n == "C").unwrap();
        assert_eq!(pos_a, pos_c + 1);
        let _ = b;
    }

    #[test]
    fn move_column_to_tail_without_anchor() {
        let f = setup();
        column::update(&f.conn, &f.public_col, Some("A"), None, None).unwrap();
        ensure_column(&f.conn, &f.deck_id, "B", "", false, &sc(), &au()).unwrap();
        ensure_column(&f.conn, &f.deck_id, "C", "", false, &sc(), &au()).unwrap();

        move_column(&f.conn, &f.deck_id, &f.public_col, None, None, &sc(), &au()).unwrap();
        let names = column_names(&f);
        assert_eq!(names.last().unwrap(), "A");
    }

    #[test]
    fn move_column_on_private_is_unauthorized() {
        let f = setup();
        let err = move_column(&f.conn, &f.deck_id, &f.private_col, None, None, &sc(), &au()).unwrap_err();
        assert!(matches!(err, JotDeckError::Unauthorized(_)));
    }

    #[test]
    fn move_column_rejects_both_anchors() {
        let f = setup();
        let b = ensure_column(&f.conn, &f.deck_id, "B", "", false, &sc(), &au()).unwrap().column;
        let c = ensure_column(&f.conn, &f.deck_id, "C", "", false, &sc(), &au()).unwrap().column;
        let err = move_column(&f.conn, &f.deck_id, &f.public_col, Some(&b.id), Some(&c.id), &sc(), &au()).unwrap_err();
        assert!(matches!(err, JotDeckError::InvalidOperation(_)));
    }

    // ---- write allowlist (008 §4.5) ----

    fn make_column(f: &Fixture, name: &str) -> String {
        column::create(
            &f.conn,
            NewColumn {
                deck_id: f.deck_id.clone(),
                name: name.to_string(),
            },
        )
        .unwrap()
        .id
    }

    fn only(col: &str) -> WriteScope {
        WriteScope::allowlist([col.to_string()])
    }

    #[test]
    fn write_scope_default_is_unrestricted() {
        assert!(WriteScope::default().is_unrestricted());
        assert!(WriteScope::unrestricted().is_unrestricted());
        assert!(!WriteScope::allowlist(["x".to_string()]).is_unrestricted());
    }

    #[test]
    fn allowlist_restricts_append_to_listed_columns() {
        let f = setup();
        let other = make_column(&f, "Other");
        let scope = only(&f.public_col);
        // Allowlisted column → ok.
        append_card(&f.conn, &f.deck_id, &f.public_col, "ok", None, &scope, &au()).unwrap();
        // Visible but not allowlisted → Unauthorized.
        let err = append_card(&f.conn, &f.deck_id, &other, "no", None, &scope, &au()).unwrap_err();
        assert!(matches!(err, JotDeckError::Unauthorized(_)));
    }

    #[test]
    fn allowlist_patch_and_delete_outside_scope_are_unauthorized() {
        let f = setup();
        let other = make_column(&f, "Other");
        let card = card::create(
            &f.conn,
            NewCard {
                column_id: other.clone(),
                content: "x".to_string(),
            },
        )
        .unwrap();
        let scope = only(&f.public_col);
        let e1 = patch_card(&f.conn, &f.deck_id, &card.id, "y", card.updated_at, &scope, &au()).unwrap_err();
        assert!(matches!(e1, JotDeckError::Unauthorized(_)));
        let e2 = delete_card(&f.conn, &f.deck_id, &card.id, &scope, &au()).unwrap_err();
        assert!(matches!(e2, JotDeckError::Unauthorized(_)));
    }

    #[test]
    fn allowlist_patch_on_private_card_is_still_not_found() {
        let f = setup();
        let hidden = card::create(
            &f.conn,
            NewCard {
                column_id: f.private_col.clone(),
                content: "s".to_string(),
            },
        )
        .unwrap();
        // A private column leaks nothing → NotFound wins over the allowlist Unauthorized.
        let err = patch_card(&f.conn, &f.deck_id, &hidden.id, "y", hidden.updated_at, &only(&f.public_col), &au())
            .unwrap_err();
        assert!(matches!(err, JotDeckError::NotFound(_)));
    }

    #[test]
    fn allowlist_disables_ensure_column_create_but_allows_in_scope_get() {
        let f = setup();
        column::update(&f.conn, &f.public_col, Some("Inbox"), None, None).unwrap();
        let scope = only(&f.public_col);
        // allow_create=false (bridge derives it from the allowlist); in-scope get works.
        let got = ensure_column(&f.conn, &f.deck_id, "Inbox", "d", false, &scope, &au()).unwrap();
        assert!(!got.created);
        assert_eq!(got.column.id, f.public_col);
        // A name not resolvable in scope cannot be created.
        let err = ensure_column(&f.conn, &f.deck_id, "BrandNew", "d", false, &scope, &au()).unwrap_err();
        assert!(matches!(err, JotDeckError::InvalidOperation(_)));
    }

    #[test]
    fn allowlist_ensure_column_get_ignores_out_of_scope_same_name() {
        let f = setup();
        // A visible column named "Shared" that is NOT in the allowlist.
        make_column(&f, "Shared");
        // get must not resolve to it; with create disabled → InvalidOperation.
        let err = ensure_column(&f.conn, &f.deck_id, "Shared", "d", false, &only(&f.public_col), &au())
            .unwrap_err();
        assert!(matches!(err, JotDeckError::InvalidOperation(_)));
    }

    #[test]
    fn allowlist_move_column_anchor_must_be_in_scope() {
        let f = setup();
        let other = make_column(&f, "Other");
        let err = move_column(&f.conn, &f.deck_id, &f.public_col, Some(&other), None, &only(&f.public_col), &au())
            .unwrap_err();
        assert!(matches!(err, JotDeckError::Unauthorized(_)));
    }

    #[test]
    fn allowlist_move_card_target_must_be_in_scope() {
        let f = setup();
        let other = make_column(&f, "Other");
        let scope = only(&f.public_col);
        let card = append_card(&f.conn, &f.deck_id, &f.public_col, "A", None, &scope, &au()).unwrap();
        let err = move_card(&f.conn, &f.deck_id, &card.id, Some(&other), None, None, &scope, &au()).unwrap_err();
        assert!(matches!(err, JotDeckError::Unauthorized(_)));
    }

    // ---- card.stream.* (007 §6.2 / §7) ----

    #[test]
    fn begin_stream_locks_visible_card() {
        let f = setup();
        let card = append_card(&f.conn, &f.deck_id, &f.public_col, "draft", None, &sc(), &au()).unwrap();
        let locked = begin_card_stream(&f.conn, &f.deck_id, &card.id, "reporter:1", &sc()).unwrap();
        assert_eq!(locked.locked_by.as_deref(), Some("reporter:1"));
        assert!(locked.locked_at.is_some());
    }

    #[test]
    fn begin_stream_on_private_card_is_not_found() {
        let f = setup();
        // Put a card in the private column directly, then stream against it.
        let hidden = card::create(
            &f.conn,
            NewCard {
                column_id: f.private_col.clone(),
                content: "hidden".to_string(),
            },
        )
        .unwrap();
        let err = begin_card_stream(&f.conn, &f.deck_id, &hidden.id, "reporter:1", &sc()).unwrap_err();
        assert!(matches!(err, JotDeckError::NotFound(_)));
    }

    #[test]
    fn begin_stream_conflicts_when_held_by_another() {
        let f = setup();
        let card = append_card(&f.conn, &f.deck_id, &f.public_col, "draft", None, &sc(), &au()).unwrap();
        begin_card_stream(&f.conn, &f.deck_id, &card.id, "reporter:1", &sc()).unwrap();
        let err = begin_card_stream(&f.conn, &f.deck_id, &card.id, "reporter:2", &sc()).unwrap_err();
        assert!(matches!(err, JotDeckError::Conflict(_)));
    }

    #[test]
    fn end_stream_commits_content_and_releases_lock() {
        let f = setup();
        let card = append_card(&f.conn, &f.deck_id, &f.public_col, "draft", None, &sc(), &au()).unwrap();
        begin_card_stream(&f.conn, &f.deck_id, &card.id, "reporter:1", &sc()).unwrap();
        let committed =
            end_card_stream(&f.conn, &f.deck_id, &card.id, "reporter:1", "final text #done", &sc(), &au()).unwrap();
        assert_eq!(committed.content, "final text #done");
        assert!(committed.locked_by.is_none());
        assert!(committed.locked_at.is_none());
        assert!(committed.updated_at > card.updated_at);
    }

    #[test]
    fn end_stream_conflicts_after_lease_takeover() {
        let f = setup();
        let card = append_card(&f.conn, &f.deck_id, &f.public_col, "draft", None, &sc(), &au()).unwrap();
        begin_card_stream(&f.conn, &f.deck_id, &card.id, "reporter:1", &sc()).unwrap();
        // Expire reporter:1's lease so a second holder can take over (as the lock
        // primitive tests do), then reporter:2 acquires.
        f.conn
            .execute(
                "UPDATE cards SET locked_at = '2000-01-01T00:00:00.000000000Z' WHERE id = ?1",
                params![card.id],
            )
            .unwrap();
        card::acquire_lock(&f.conn, &card.id, "reporter:2").unwrap();
        // reporter:1 can no longer commit its stream — the lock moved on.
        let err = end_card_stream(&f.conn, &f.deck_id, &card.id, "reporter:1", "x", &sc(), &au()).unwrap_err();
        assert!(matches!(err, JotDeckError::Conflict(_)));
        // The conflicting end must NOT have overwritten content or stolen the
        // lock: the atomic `WHERE locked_by = holder` guard leaves reporter:2's
        // takeover intact (the whole point of the single-statement commit).
        let after = card::get_by_id(&f.conn, &card.id).unwrap();
        assert_eq!(after.content, "draft");
        assert_eq!(after.locked_by.as_deref(), Some("reporter:2"));
    }

    #[test]
    fn end_stream_conflicts_after_own_lease_expiry() {
        let f = setup();
        let card = append_card(&f.conn, &f.deck_id, &f.public_col, "draft", None, &sc(), &au()).unwrap();
        begin_card_stream(&f.conn, &f.deck_id, &card.id, "reporter:1", &sc()).unwrap();
        // Expire reporter:1's own lease with nobody taking over. An expired lease
        // is no longer exclusive (acquire_lock would let another editor in), so
        // the holder loses the right to commit — content must stay untouched.
        f.conn
            .execute(
                "UPDATE cards SET locked_at = '2000-01-01T00:00:00.000000000Z' WHERE id = ?1",
                params![card.id],
            )
            .unwrap();
        let err = end_card_stream(&f.conn, &f.deck_id, &card.id, "reporter:1", "late", &sc(), &au()).unwrap_err();
        assert!(matches!(err, JotDeckError::Conflict(_)));
        let after = card::get_by_id(&f.conn, &card.id).unwrap();
        assert_eq!(after.content, "draft");
    }

    #[test]
    fn end_stream_rejects_too_long_content() {
        let f = setup();
        let card = append_card(&f.conn, &f.deck_id, &f.public_col, "draft", None, &sc(), &au()).unwrap();
        begin_card_stream(&f.conn, &f.deck_id, &card.id, "reporter:1", &sc()).unwrap();
        let long = "a".repeat(query::MAX_CARD_LENGTH + 1);
        let err = end_card_stream(&f.conn, &f.deck_id, &card.id, "reporter:1", &long, &sc(), &au()).unwrap_err();
        assert!(matches!(err, JotDeckError::InvalidOperation(_)));
    }

    // ---- change history (008 §5.1) ----

    /// Deck の履歴を古い順に (op, target_id, before, after) で。
    fn history_of(f: &Fixture) -> Vec<(ChangeOp, String, Option<Value>, Option<Value>)> {
        let mut rows = history::list_by_deck(&f.conn, &f.deck_id, 100).unwrap();
        rows.reverse();
        rows.into_iter()
            .map(|r| (r.op, r.target_id, r.before, r.after))
            .collect()
    }

    #[test]
    fn card_writes_record_before_and_after() {
        let f = setup();
        let card = append_card(&f.conn, &f.deck_id, &f.public_col, "v1", None, &sc(), &au()).unwrap();
        let patched = patch_card(&f.conn, &f.deck_id, &card.id, "v2", card.updated_at, &sc(), &au()).unwrap();
        // Re-patching with identical content is not worth an Activity row.
        patch_card(&f.conn, &f.deck_id, &card.id, "v2", patched.updated_at, &sc(), &au()).unwrap();
        delete_card(&f.conn, &f.deck_id, &card.id, &sc(), &au()).unwrap();

        assert_eq!(
            history_of(&f),
            vec![
                (
                    ChangeOp::AppendCard,
                    card.id.clone(),
                    None,
                    Some(json!({ "column_id": f.public_col, "content": "v1" })),
                ),
                (
                    ChangeOp::PatchCard,
                    card.id.clone(),
                    Some(json!({ "content": "v1" })),
                    Some(json!({ "content": "v2" })),
                ),
                (
                    ChangeOp::DeleteCard,
                    card.id.clone(),
                    Some(json!({ "deleted": false })),
                    Some(json!({ "deleted": true })),
                ),
            ]
        );
        let row = &history::list_by_target(&f.conn, &card.id).unwrap()[0];
        assert_eq!(row.author, au());
    }

    #[test]
    fn stream_end_records_the_overwrite() {
        let f = setup();
        let card = append_card(&f.conn, &f.deck_id, &f.public_col, "draft", None, &sc(), &au()).unwrap();
        begin_card_stream(&f.conn, &f.deck_id, &card.id, "rep", &sc()).unwrap();
        let reporter = Author::reporter("rep");
        end_card_stream(&f.conn, &f.deck_id, &card.id, "rep", "final", &sc(), &reporter).unwrap();

        let rows = history::list_by_target(&f.conn, &card.id).unwrap();
        assert_eq!(rows.len(), 2, "begin (lock only) is not recorded");
        assert_eq!(rows[0].op, ChangeOp::StreamCard);
        assert_eq!(rows[0].before, Some(json!({ "content": "draft" })));
        assert_eq!(rows[0].after, Some(json!({ "content": "final" })));
        assert_eq!(rows[0].author, reporter);
    }

    #[test]
    fn move_card_records_placement_by_preceding_card() {
        let f = setup();
        let other = ensure_column(&f.conn, &f.deck_id, "Other", "", false, &sc(), &au())
            .unwrap()
            .column;
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "A", None, &sc(), &au()).unwrap();
        let b = append_card(&f.conn, &f.deck_id, &f.public_col, "B", None, &sc(), &au()).unwrap();
        let x = append_card(&f.conn, &f.deck_id, &other.id, "X", None, &sc(), &au()).unwrap();

        move_card(&f.conn, &f.deck_id, &b.id, Some(&other.id), Some(&x.id), None, &sc(), &au()).unwrap();
        // Moving to where it already is records nothing.
        move_card(&f.conn, &f.deck_id, &b.id, None, Some(&x.id), None, &sc(), &au()).unwrap();

        let moves: Vec<_> = history_of(&f)
            .into_iter()
            .filter(|(op, ..)| *op == ChangeOp::MoveCard)
            .collect();
        assert_eq!(
            moves,
            vec![(
                ChangeOp::MoveCard,
                b.id.clone(),
                Some(json!({ "column_id": f.public_col, "after_card_id": a.id })),
                Some(json!({ "column_id": other.id, "after_card_id": null })),
            )]
        );
    }

    #[test]
    fn column_writes_record_attrs_and_placement() {
        let f = setup();
        let created = ensure_column(&f.conn, &f.deck_id, "Ideas", "raw", false, &sc(), &au())
            .unwrap()
            .column;
        // A get (no create) records nothing.
        ensure_column(&f.conn, &f.deck_id, "Ideas", "raw", false, &sc(), &au()).unwrap();
        update_column(&f.conn, &f.deck_id, &created.id, Some("Ideas!"), None, None, &sc(), &au()).unwrap();
        move_column(&f.conn, &f.deck_id, &created.id, Some(&f.public_col), None, &sc(), &au()).unwrap();

        assert_eq!(
            history_of(&f),
            vec![
                (
                    ChangeOp::CreateColumn,
                    created.id.clone(),
                    None,
                    Some(json!({ "name": "Ideas", "description": "raw", "private": false })),
                ),
                (
                    ChangeOp::UpdateColumn,
                    created.id.clone(),
                    Some(json!({ "name": "Ideas", "description": "raw", "private": false })),
                    Some(json!({ "name": "Ideas!", "description": "raw", "private": false })),
                ),
                (
                    ChangeOp::MoveColumn,
                    created.id.clone(),
                    // Visible order was Public, Secret(private), Ideas.
                    Some(json!({ "after_column_id": f.private_col })),
                    Some(json!({ "after_column_id": null })),
                ),
            ]
        );
    }

    #[test]
    fn ensure_column_get_does_not_wait_for_another_writer() {
        let path = std::env::temp_dir().join(format!("jot-deck-ensure-{}.db", ulid::Ulid::generate()));
        let path_str = path.to_str().unwrap().to_string();
        let a = crate::db::create_file_db(&path_str).unwrap();
        let d = deck::create(
            &a,
            NewDeck {
                name: "D".to_string(),
                sort_order: SortOrder::default(),
            },
        )
        .unwrap();
        ensure_column(&a, &d.id, "Inbox", "", false, &sc(), &au()).unwrap();

        let b = crate::db::create_file_db(&path_str).unwrap();
        b.busy_timeout(std::time::Duration::ZERO).unwrap();
        let lock = write_tx(&a).unwrap();
        let got = ensure_column(&b, &d.id, "Inbox", "", false, &sc(), &au()).unwrap();
        assert!(!got.created);
        drop(lock);

        drop((a, b));
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{path_str}{suffix}"));
        }
    }

    #[test]
    fn failed_or_replayed_writes_record_nothing() {
        let f = setup();
        let card = append_card(&f.conn, &f.deck_id, &f.public_col, "A", None, &sc(), &au()).unwrap();
        append_card(&f.conn, &f.deck_id, &f.public_col, "K", Some("k"), &sc(), &au()).unwrap();
        let before = history_of(&f).len();

        // Idempotent replay, stale CAS, unknown anchor, out-of-scope column.
        append_card(&f.conn, &f.deck_id, &f.public_col, "K", Some("k"), &sc(), &au()).unwrap();
        patch_card(&f.conn, &f.deck_id, &card.id, "B", card.updated_at - chrono::Duration::seconds(1), &sc(), &au())
            .unwrap_err();
        move_card(&f.conn, &f.deck_id, &card.id, None, Some("missing"), None, &sc(), &au()).unwrap_err();
        append_card(&f.conn, &f.deck_id, &f.private_col, "P", None, &sc(), &au()).unwrap_err();

        assert_eq!(history_of(&f).len(), before);
        assert_eq!(contents(&f, &f.public_col), vec!["A", "K"]);
    }

    #[test]
    fn failed_cross_column_move_rolls_back_both_steps() {
        let f = setup();
        let other = ensure_column(&f.conn, &f.deck_id, "Other", "", false, &sc(), &au())
            .unwrap()
            .column;
        let card = append_card(&f.conn, &f.deck_id, &f.public_col, "A", None, &sc(), &au()).unwrap();
        // Moving A out would shift B up; the rollback must undo that too.
        append_card(&f.conn, &f.deck_id, &f.public_col, "B", None, &sc(), &au()).unwrap();
        // Fail after both move steps ran: the history insert aborts.
        f.conn
            .execute_batch(
                "CREATE TEMP TRIGGER fail_history BEFORE INSERT ON change_history
                 BEGIN SELECT RAISE(ABORT, 'boom'); END;",
            )
            .unwrap();
        move_card(&f.conn, &f.deck_id, &card.id, Some(&other.id), None, None, &sc(), &au()).unwrap_err();

        assert_eq!(card::get_by_id(&f.conn, &card.id).unwrap().column_id, f.public_col);
        let positions: Vec<(String, i32)> = card::get_by_column_id(&f.conn, &f.public_col)
            .unwrap()
            .into_iter()
            .map(|c| (c.content, c.position))
            .collect();
        assert_eq!(positions, vec![("A".to_string(), 0), ("B".to_string(), 1)]);
        assert!(contents(&f, &other.id).is_empty());
        assert!(f.conn.is_autocommit(), "no transaction left open");
    }
}
