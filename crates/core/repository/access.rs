//! Agent access layer shared by the MCP bridge (008) and the Reporter host (007).
//!
//! Both transports let an external program read and write Decks; this module
//! is the one place that decides *what* such a connection may do and *how* each
//! operation answers. A transport only frames messages (MCP `tools/call` or
//! Reporter JSON-RPC methods), maps [`AccessError`] onto its own error shape,
//! and adds what is genuinely its own (MCP tool schemas and resources, Reporter
//! change events). Keeping the policy and the result shapes here means a new
//! field or rule lands on both transports at once (007 §3.2: auth semantics
//! must not diverge).
//!
//! A connection's [`AccessPolicy`] combines four limits:
//! - [`DeckScope`]: which Decks it may address (pinned list or any Deck),
//! - [`Capabilities`]: which write verbs are enabled (append/edit/delete/structure),
//! - a sliding-window write rate limit,
//! - [`WriteScope`]: an optional write allowlist by column.
//!
//! `private` columns, deletion and the Deck boundary are enforced further down
//! by `query`/`write`, which stay the trust boundary.

use std::collections::VecDeque;
use std::fmt;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use chrono::Utc;
use rusqlite::Connection;
use serde::{Deserialize, Deserializer};
use serde_json::{json, Value};

use crate::error::JotDeckError;
use crate::repository::deck_scope::DeckScope;
use crate::repository::history::Author;
use crate::repository::query;
use crate::repository::write::{self, WriteScope};

/// 1 接続あたりの書き込み上限（回/分）の既定値（007 §8 / 008 §5）。
pub const DEFAULT_MAX_WRITES_PER_MIN: usize = 120;

// ---- errors ----

/// 操作の失敗。トランスポートが自分のエラー形式（MCP の `isError` 結果、
/// Reporter の JSON-RPC エラーコード）へ写す。
#[derive(Debug)]
pub enum AccessError {
    /// capability 無効、またはレート制限超過（接続ポリシーによる拒否）。
    Denied(String),
    /// 引数の欠落・型不一致（core を呼ぶ前に弾いたもの）。
    InvalidArgs(String),
    /// core（`query` / `write` / `deck_scope`）が返したドメインエラー。
    Core(JotDeckError),
}

impl fmt::Display for AccessError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Denied(msg) | Self::InvalidArgs(msg) => f.write_str(msg),
            Self::Core(e) => write!(f, "{}", e),
        }
    }
}

impl From<JotDeckError> for AccessError {
    fn from(e: JotDeckError) -> Self {
        Self::Core(e)
    }
}

pub type AccessResult<T> = std::result::Result<T, AccessError>;

// ---- policy ----

/// 接続が使える書き込み動詞。既定はすべて ON で、登録・環境変数で個別に無効化する。
/// `append` → カード追加、`edit` → 編集・移動・ストリーム、`delete` → カード削除、
/// `structure` → カラムの作成・更新・並べ替え。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Capabilities {
    pub append: bool,
    pub edit: bool,
    pub delete: bool,
    pub structure: bool,
}

impl Default for Capabilities {
    fn default() -> Self {
        Self {
            append: true,
            edit: true,
            delete: true,
            structure: true,
        }
    }
}

impl Capabilities {
    /// deny リスト（大文字小文字・前後空白は無視、空要素は飛ばす）を適用する。
    /// 知らない名前は `unknown` として返す ―― 環境変数（MCP）は警告して続行、
    /// 保存済み登録（Reporter）は fail-closed で拒否、と呼び出し側が扱いを決める。
    pub fn from_deny<'a>(deny: impl IntoIterator<Item = &'a str>) -> (Self, Vec<String>) {
        let mut caps = Self::default();
        let mut unknown = Vec::new();
        for raw in deny {
            let name = raw.trim().to_ascii_lowercase();
            match name.as_str() {
                "" => {}
                "append" => caps.append = false,
                "edit" => caps.edit = false,
                "delete" => caps.delete = false,
                "structure" => caps.structure = false,
                _ => unknown.push(raw.trim().to_string()),
            }
        }
        (caps, unknown)
    }

    fn allows(&self, verb: Verb) -> bool {
        match verb {
            Verb::Append => self.append,
            Verb::Edit => self.edit,
            Verb::Delete => self.delete,
            Verb::Structure => self.structure,
        }
    }
}

/// 書き込み操作の種別（どの capability で許可するか）。
#[derive(Debug, Clone, Copy)]
pub enum Verb {
    Append,
    Edit,
    Delete,
    Structure,
}

impl Verb {
    fn name(self) -> &'static str {
        match self {
            Self::Append => "append",
            Self::Edit => "edit",
            Self::Delete => "delete",
            Self::Structure => "structure",
        }
    }
}

/// 直近 60 秒の書き込み回数で上限を判定するスライディングウィンドウ。
struct RateLimiter {
    max_per_min: usize,
    events: Mutex<VecDeque<Instant>>,
}

impl RateLimiter {
    fn new(max_per_min: usize) -> Self {
        Self {
            max_per_min,
            events: Mutex::new(VecDeque::new()),
        }
    }

    /// 書き込みを 1 回記録する。上限を超えるなら記録せずに false。
    fn try_record(&self) -> bool {
        let now = Instant::now();
        let mut events = self.events.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(cutoff) = now.checked_sub(Duration::from_secs(60)) {
            while events.front().is_some_and(|&t| t < cutoff) {
                events.pop_front();
            }
        }
        if events.len() >= self.max_per_min {
            return false;
        }
        events.push_back(now);
        true
    }
}

/// 1 接続（MCP ブリッジ 1 本、または起動中の Reporter 1 つ）に掛かる制約一式。
pub struct AccessPolicy {
    deck_scope: DeckScope,
    capabilities: Capabilities,
    rate_limiter: RateLimiter,
    write_scope: WriteScope,
    /// 拒否メッセージで接続を指す語（"connection" / "Reporter"）。
    subject: &'static str,
}

impl AccessPolicy {
    pub fn new(
        deck_scope: DeckScope,
        capabilities: Capabilities,
        max_writes_per_min: usize,
        write_scope: WriteScope,
        subject: &'static str,
    ) -> Self {
        Self {
            deck_scope,
            capabilities,
            rate_limiter: RateLimiter::new(max_writes_per_min),
            write_scope,
            subject,
        }
    }

    pub fn deck_scope(&self) -> &DeckScope {
        &self.deck_scope
    }

    pub fn capabilities(&self) -> Capabilities {
        self.capabilities
    }

    pub fn max_writes_per_min(&self) -> usize {
        self.rate_limiter.max_per_min
    }

    pub fn write_scope(&self) -> &WriteScope {
        &self.write_scope
    }

    /// すべての書き込みの前置き: capability を確認してからレート制限に 1 回数える。
    /// 2 つの関門とその順序を全操作で揃えるため、ここに一本化する。
    pub fn begin_write(&self, verb: Verb) -> AccessResult<()> {
        if !self.capabilities.allows(verb) {
            return Err(AccessError::Denied(format!(
                "The '{}' capability is disabled for this {}.",
                verb.name(),
                self.subject
            )));
        }
        if !self.rate_limiter.try_record() {
            return Err(AccessError::Denied(format!(
                "Rate limit exceeded: max {} writes/min for this {}. Slow down and retry.",
                self.rate_limiter.max_per_min, self.subject
            )));
        }
        Ok(())
    }

    /// この接続の実効ポリシー（`describe_deck` の `capabilities`、Reporter の
    /// `initialize`）。`write_columns` は null＝可視カラム全体、配列＝その ULID
    /// だけ。`pinned_deck_ids` は null＝任意の Deck、配列＝その Deck だけ。
    pub fn capabilities_json(&self) -> Value {
        json!({
            "read": true,
            "append": self.capabilities.append,
            "edit": self.capabilities.edit,
            "delete": self.capabilities.delete,
            "structure": self.capabilities.structure,
            "write_columns": self.write_scope.allowed_columns(),
            "pinned_deck_ids": self.deck_scope.pinned(),
        })
    }

    // ---- target resolution ----

    fn resolve_deck(&self, conn: &Connection, requested: Option<&str>) -> AccessResult<String> {
        Ok(self.deck_scope.resolve(conn, requested)?)
    }

    fn deck_of_card(&self, conn: &Connection, card_id: &str) -> AccessResult<String> {
        Ok(self.deck_scope.deck_for_card(conn, card_id)?)
    }

    fn deck_of_column(&self, conn: &Connection, column_id: &str) -> AccessResult<String> {
        Ok(self.deck_scope.deck_for_column(conn, column_id)?)
    }
}

// ---- arguments ----

/// 引数を型付き構造体へ。`null`（引数なし）は空オブジェクトとして扱う。
fn parse_args<T: for<'de> Deserialize<'de>>(args: &Value) -> AccessResult<T> {
    let args = if args.is_null() { json!({}) } else { args.clone() };
    serde_json::from_value(args).map_err(|e| AccessError::InvalidArgs(format!("Invalid arguments: {}", e)))
}

/// 任意の文字列引数。空文字は省略と同じに扱う。
fn non_empty<'de, D: Deserializer<'de>>(de: D) -> Result<Option<String>, D::Error> {
    Ok(Option::<String>::deserialize(de)?.filter(|s| !s.is_empty()))
}

/// 既定値のある任意引数。`null` は省略と同じに扱う（LLM クライアントは任意の欄に
/// `null` を送りがち）。`default` と組で使う。
fn null_as_default<'de, D, T>(de: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(de)?.unwrap_or_default())
}

/// 省略・`null`（変更しない）と空文字（クリア）を区別する。LLM クライアントは任意引数に
/// `null` を送りがちなので、`null` でクリアすると意図せず説明を消してしまう ―― クリアは
/// 明示的な空文字だけに限る。`default` と組で使う。
fn clearable<'de, D: Deserializer<'de>>(de: D) -> Result<Option<Option<String>>, D::Error> {
    Ok(Option::<String>::deserialize(de)?.map(|s| Some(s).filter(|s| !s.is_empty())))
}

#[derive(Deserialize)]
struct DeckArgs {
    #[serde(default, deserialize_with = "non_empty")]
    deck_id: Option<String>,
}

#[derive(Deserialize)]
struct CardArgs {
    card_id: String,
}

#[derive(Deserialize)]
struct SearchArgs {
    #[serde(default, deserialize_with = "non_empty")]
    deck_id: Option<String>,
    #[serde(default, deserialize_with = "non_empty")]
    query: Option<String>,
    #[serde(default, deserialize_with = "non_empty")]
    column_id: Option<String>,
    #[serde(default, deserialize_with = "null_as_default")]
    tags: Vec<String>,
    #[serde(default)]
    min_score: Option<i32>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Deserialize)]
struct RecentArgs {
    #[serde(default, deserialize_with = "non_empty")]
    deck_id: Option<String>,
    #[serde(default, deserialize_with = "non_empty")]
    column_id: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Deserialize)]
struct AppendArgs {
    column_id: String,
    content: String,
    #[serde(default, deserialize_with = "non_empty")]
    idempotency_key: Option<String>,
}

#[derive(Deserialize)]
struct PatchArgs {
    card_id: String,
    content: String,
    expected_updated_at: String,
}

#[derive(Deserialize)]
struct MoveCardArgs {
    card_id: String,
    #[serde(default, deserialize_with = "non_empty")]
    to_column_id: Option<String>,
    #[serde(default, deserialize_with = "non_empty")]
    before_card_id: Option<String>,
    #[serde(default, deserialize_with = "non_empty")]
    after_card_id: Option<String>,
}

#[derive(Deserialize)]
struct StreamEndArgs {
    card_id: String,
    content: String,
}

#[derive(Deserialize)]
struct EnsureColumnArgs {
    #[serde(default, deserialize_with = "non_empty")]
    deck_id: Option<String>,
    name: String,
    #[serde(default, deserialize_with = "null_as_default")]
    description: String,
    #[serde(default, deserialize_with = "null_as_default")]
    private: bool,
}

#[derive(Deserialize)]
struct UpdateColumnArgs {
    column_id: String,
    #[serde(default, deserialize_with = "non_empty")]
    name: Option<String>,
    #[serde(default, deserialize_with = "clearable")]
    description: Option<Option<String>>,
    #[serde(default)]
    private: Option<bool>,
}

#[derive(Deserialize)]
struct MoveColumnArgs {
    column_id: String,
    #[serde(default, deserialize_with = "non_empty")]
    before_column_id: Option<String>,
    #[serde(default, deserialize_with = "non_empty")]
    after_column_id: Option<String>,
}

// ---- reads ----

/// 接続が扱える Deck の一覧: `{ decks: [{ deck_id, name, active }] }`。
pub fn list_decks(conn: &Connection, policy: &AccessPolicy) -> AccessResult<Value> {
    let decks = policy.deck_scope.list_decks(conn)?;
    Ok(json!({ "decks": decks }))
}

/// `{ deck_id, columns }`。
pub fn list_columns(conn: &Connection, policy: &AccessPolicy, args: &Value) -> AccessResult<Value> {
    let a: DeckArgs = parse_args(args)?;
    let deck_id = policy.resolve_deck(conn, a.deck_id.as_deref())?;
    let columns = query::list_columns(conn, &deck_id)?;
    Ok(json!({ "deck_id": deck_id, "columns": columns }))
}

/// カード 1 枚（所属 Deck はカードから決まる）。
pub fn read_card(conn: &Connection, policy: &AccessPolicy, args: &Value) -> AccessResult<Value> {
    let a: CardArgs = parse_args(args)?;
    let deck_id = policy.deck_of_card(conn, &a.card_id)?;
    Ok(json!(query::read_card(conn, &deck_id, &a.card_id)?))
}

/// `{ deck_id, cards }`。
pub fn search_cards(conn: &Connection, policy: &AccessPolicy, args: &Value) -> AccessResult<Value> {
    let a: SearchArgs = parse_args(args)?;
    let deck_id = policy.resolve_deck(conn, a.deck_id.as_deref())?;
    let params = query::SearchParams {
        query: a.query,
        column_id: a.column_id,
        tags: a.tags,
        min_score: a.min_score,
        limit: a.limit,
    };
    let cards = query::search_cards(conn, &deck_id, &params)?;
    Ok(json!({ "deck_id": deck_id, "cards": cards }))
}

/// `{ deck_id, cards }`。
pub fn recent_cards(conn: &Connection, policy: &AccessPolicy, args: &Value) -> AccessResult<Value> {
    let a: RecentArgs = parse_args(args)?;
    let deck_id = policy.resolve_deck(conn, a.deck_id.as_deref())?;
    let cards = query::recent_cards(conn, &deck_id, a.column_id.as_deref(), a.limit)?;
    Ok(json!({ "deck_id": deck_id, "cards": cards }))
}

/// `describe_deck`（引数の `deck_id` で対象を解決する）。
pub fn describe_deck(conn: &Connection, policy: &AccessPolicy, args: &Value) -> AccessResult<Value> {
    let a: DeckArgs = parse_args(args)?;
    let deck_id = policy.resolve_deck(conn, a.deck_id.as_deref())?;
    describe(conn, policy, &deck_id)
}

/// 解決済み Deck の説明に、この接続の実効ポリシーと書き込み上限を足したもの。
pub fn describe(conn: &Connection, policy: &AccessPolicy, deck_id: &str) -> AccessResult<Value> {
    let mut v = json!(query::describe_deck(conn, deck_id)?);
    v["capabilities"] = policy.capabilities_json();
    if let Some(obj) = v.get_mut("constraints").and_then(Value::as_object_mut) {
        obj.insert("max_writes_per_min".to_string(), json!(policy.max_writes_per_min()));
    }
    Ok(v)
}

// ---- writes ----

/// 書き込みが何を変えたか。トランスポートが監査ログや GUI への変更通知に使う。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    /// カードの内容・位置・削除状態が変わった。
    Card { card_id: String, column_id: String },
    /// カラム構成が変わった（作成・更新・並べ替え）。
    Structure { column_id: String },
    /// カードのストリームが始まった（AI 生成中として占有）。
    StreamBegin { card_id: String, column_id: String },
    /// カードのストリームが確定した（占有を解除）。
    StreamEnd { card_id: String, column_id: String },
}

impl Effect {
    /// 変更したカードまたはカラムの ULID。
    pub fn target(&self) -> &str {
        match self {
            Self::Card { card_id, .. }
            | Self::StreamBegin { card_id, .. }
            | Self::StreamEnd { card_id, .. } => card_id,
            Self::Structure { column_id } => column_id,
        }
    }
}

/// 書き込みの結果: 返り値、対象 Deck、変更内容。
#[derive(Debug)]
pub struct Written {
    pub result: Value,
    pub deck_id: String,
    pub effect: Effect,
}

fn card_effect(card: &crate::models::Card) -> Effect {
    Effect::Card {
        card_id: card.id.clone(),
        column_id: card.column_id.clone(),
    }
}

/// カラム末尾にカードを追加する（`append`）。
pub fn append_card(
    conn: &Connection,
    policy: &AccessPolicy,
    author: &Author,
    args: &Value,
) -> AccessResult<Written> {
    policy.begin_write(Verb::Append)?;
    let a: AppendArgs = parse_args(args)?;
    let deck_id = policy.deck_of_column(conn, &a.column_id)?;
    let card = write::append_card(
        conn,
        &deck_id,
        &a.column_id,
        &a.content,
        a.idempotency_key.as_deref(),
        &policy.write_scope,
        author,
    )?;
    Ok(Written {
        result: json!({
            "card_id": card.id,
            "column_id": card.column_id,
            "position": card.position,
            "created_at": card.created_at.to_rfc3339(),
        }),
        effect: card_effect(&card),
        deck_id,
    })
}

/// カード本文を楽観ロック付きで書き換える（`edit`）。
pub fn patch_card(
    conn: &Connection,
    policy: &AccessPolicy,
    author: &Author,
    args: &Value,
) -> AccessResult<Written> {
    policy.begin_write(Verb::Edit)?;
    let a: PatchArgs = parse_args(args)?;
    let expected_updated_at = chrono::DateTime::parse_from_rfc3339(&a.expected_updated_at)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|_| {
            AccessError::InvalidArgs(
                "expected_updated_at must be an RFC3339 timestamp (the updated_at you last read)"
                    .to_string(),
            )
        })?;
    let deck_id = policy.deck_of_card(conn, &a.card_id)?;
    let card = write::patch_card(
        conn,
        &deck_id,
        &a.card_id,
        &a.content,
        expected_updated_at,
        &policy.write_scope,
        author,
    )?;
    Ok(Written {
        result: json!({ "card_id": card.id, "updated_at": card.updated_at.to_rfc3339() }),
        effect: card_effect(&card),
        deck_id,
    })
}

/// カードを並べ替える・別カラムへ移す（`edit`）。移動先はカードと同じ Deck に限る。
pub fn move_card(
    conn: &Connection,
    policy: &AccessPolicy,
    author: &Author,
    args: &Value,
) -> AccessResult<Written> {
    policy.begin_write(Verb::Edit)?;
    let a: MoveCardArgs = parse_args(args)?;
    let deck_id = policy.deck_of_card(conn, &a.card_id)?;
    let card = write::move_card(
        conn,
        &deck_id,
        &a.card_id,
        a.to_column_id.as_deref(),
        a.before_card_id.as_deref(),
        a.after_card_id.as_deref(),
        &policy.write_scope,
        author,
    )?;
    Ok(Written {
        result: json!({
            "card_id": card.id,
            "column_id": card.column_id,
            "position": card.position,
        }),
        effect: card_effect(&card),
        deck_id,
    })
}

/// カードを論理削除する（`delete`）。
pub fn delete_card(
    conn: &Connection,
    policy: &AccessPolicy,
    author: &Author,
    args: &Value,
) -> AccessResult<Written> {
    policy.begin_write(Verb::Delete)?;
    let a: CardArgs = parse_args(args)?;
    let deck_id = policy.deck_of_card(conn, &a.card_id)?;
    let card = write::delete_card(conn, &deck_id, &a.card_id, &policy.write_scope, author)?;
    let deleted_at = card.deleted_at.map(|d| d.to_rfc3339()).unwrap_or_default();
    Ok(Written {
        result: json!({ "card_id": card.id, "deleted_at": deleted_at }),
        effect: card_effect(&card),
        deck_id,
    })
}

/// 既存カードの占有ロックを取ってストリームを始める（`edit`）。`holder` はロック保持者。
pub fn begin_card_stream(
    conn: &Connection,
    policy: &AccessPolicy,
    holder: &str,
    args: &Value,
) -> AccessResult<Written> {
    policy.begin_write(Verb::Edit)?;
    let a: CardArgs = parse_args(args)?;
    let deck_id = policy.deck_of_card(conn, &a.card_id)?;
    let card = write::begin_card_stream(conn, &deck_id, &a.card_id, holder, &policy.write_scope)?;
    Ok(Written {
        result: json!({
            "card_id": card.id,
            "column_id": card.column_id,
            "locked_by": card.locked_by,
        }),
        effect: Effect::StreamBegin {
            card_id: card.id.clone(),
            column_id: card.column_id.clone(),
        },
        deck_id,
    })
}

/// ストリームの最終本文を確定してロックを外す（`edit`）。
pub fn end_card_stream(
    conn: &Connection,
    policy: &AccessPolicy,
    holder: &str,
    author: &Author,
    args: &Value,
) -> AccessResult<Written> {
    policy.begin_write(Verb::Edit)?;
    let a: StreamEndArgs = parse_args(args)?;
    let deck_id = policy.deck_of_card(conn, &a.card_id)?;
    let card = write::end_card_stream(
        conn,
        &deck_id,
        &a.card_id,
        holder,
        &a.content,
        &policy.write_scope,
        author,
    )?;
    Ok(Written {
        result: json!({ "card_id": card.id, "updated_at": card.updated_at.to_rfc3339() }),
        effect: Effect::StreamEnd {
            card_id: card.id.clone(),
            column_id: card.column_id.clone(),
        },
        deck_id,
    })
}

/// 名前キーでカラムを get-or-create する（`structure`）。作成可否（allowlist 明示時は
/// 作成不可）は `write::ensure_column` が書き込みスコープから決める。
pub fn ensure_column(
    conn: &Connection,
    policy: &AccessPolicy,
    author: &Author,
    args: &Value,
) -> AccessResult<Written> {
    policy.begin_write(Verb::Structure)?;
    let a: EnsureColumnArgs = parse_args(args)?;
    let deck_id = policy.resolve_deck(conn, a.deck_id.as_deref())?;
    let result = write::ensure_column(
        conn,
        &deck_id,
        &a.name,
        &a.description,
        a.private,
        &policy.write_scope,
        author,
    )?;
    Ok(Written {
        result: json!({
            "deck_id": deck_id,
            "column_id": result.column.id,
            "name": result.column.name,
            "position": result.column.position,
            "created": result.created,
        }),
        effect: Effect::Structure {
            column_id: result.column.id.clone(),
        },
        deck_id,
    })
}

/// カラムの name / description / private を指定分だけ更新する（`structure`）。
pub fn update_column(
    conn: &Connection,
    policy: &AccessPolicy,
    author: &Author,
    args: &Value,
) -> AccessResult<Written> {
    policy.begin_write(Verb::Structure)?;
    let a: UpdateColumnArgs = parse_args(args)?;
    let deck_id = policy.deck_of_column(conn, &a.column_id)?;
    let column = write::update_column(
        conn,
        &deck_id,
        &a.column_id,
        a.name.as_deref(),
        a.description.as_ref().map(|d| d.as_deref()),
        a.private,
        &policy.write_scope,
        author,
    )?;
    Ok(Written {
        result: json!({
            "column_id": column.id,
            "name": column.name,
            "description": column.description,
            "private": column.private,
        }),
        effect: Effect::Structure {
            column_id: column.id.clone(),
        },
        deck_id,
    })
}

/// カラムをアンカー指定で並べ替える（`structure`）。
pub fn move_column(
    conn: &Connection,
    policy: &AccessPolicy,
    author: &Author,
    args: &Value,
) -> AccessResult<Written> {
    policy.begin_write(Verb::Structure)?;
    let a: MoveColumnArgs = parse_args(args)?;
    let deck_id = policy.deck_of_column(conn, &a.column_id)?;
    let column = write::move_column(
        conn,
        &deck_id,
        &a.column_id,
        a.before_column_id.as_deref(),
        a.after_column_id.as_deref(),
        &policy.write_scope,
        author,
    )?;
    Ok(Written {
        result: json!({ "column_id": column.id, "position": column.position }),
        effect: Effect::Structure {
            column_id: column.id.clone(),
        },
        deck_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_in_memory;
    use crate::models::{NewCard, NewColumn, NewDeck, SortOrder};
    use crate::repository::{card, column, deck};

    struct Fixture {
        conn: Connection,
        deck_a: String,
        deck_b: String,
        col_a: String,
        col_b: String,
        card_a: String,
    }

    fn fixture() -> Fixture {
        let conn = create_in_memory().unwrap();
        let mk_deck = |name: &str| {
            deck::create(
                &conn,
                NewDeck {
                    name: name.to_string(),
                    sort_order: SortOrder::default(),
                },
            )
            .unwrap()
            .id
        };
        let deck_a = mk_deck("A");
        let deck_b = mk_deck("B");
        let mk_col = |deck_id: &str| {
            column::create(
                &conn,
                NewColumn {
                    deck_id: deck_id.to_string(),
                    name: "Inbox".to_string(),
                },
            )
            .unwrap()
            .id
        };
        let col_a = mk_col(&deck_a);
        let col_b = mk_col(&deck_b);
        let card_a = card::create(
            &conn,
            NewCard {
                column_id: col_a.clone(),
                content: "hello #x".to_string(),
            },
        )
        .unwrap()
        .id;
        Fixture {
            conn,
            deck_a,
            deck_b,
            col_a,
            col_b,
            card_a,
        }
    }

    fn policy(scope: DeckScope) -> AccessPolicy {
        AccessPolicy::new(
            scope,
            Capabilities::default(),
            DEFAULT_MAX_WRITES_PER_MIN,
            WriteScope::unrestricted(),
            "connection",
        )
    }

    fn author() -> Author {
        Author::reporter("r1")
    }

    #[test]
    fn from_deny_normalizes_and_reports_unknown_names() {
        let (caps, unknown) = Capabilities::from_deny([" Delete", "", "structure", "bogus "]);
        assert!(caps.append && caps.edit);
        assert!(!caps.delete && !caps.structure);
        assert_eq!(unknown, vec!["bogus".to_string()]);
    }

    #[test]
    fn begin_write_checks_capability_then_rate() {
        let (caps, _) = Capabilities::from_deny(["append"]);
        let p = AccessPolicy::new(DeckScope::AnyDeck, caps, 1, WriteScope::unrestricted(), "Reporter");
        let denied = p.begin_write(Verb::Append).unwrap_err().to_string();
        assert_eq!(denied, "The 'append' capability is disabled for this Reporter.");
        assert!(p.begin_write(Verb::Edit).is_ok());
        let limited = p.begin_write(Verb::Edit).unwrap_err();
        assert!(matches!(limited, AccessError::Denied(ref m) if m.contains("max 1 writes/min for this Reporter")));
    }

    #[test]
    fn reads_report_the_resolved_deck() {
        let f = fixture();
        let p = policy(DeckScope::AnyDeck);
        let cols = list_columns(&f.conn, &p, &json!({ "deck_id": f.deck_a })).unwrap();
        assert_eq!(cols["deck_id"], f.deck_a);
        let recent = recent_cards(&f.conn, &p, &json!({ "deck_id": f.deck_a })).unwrap();
        assert_eq!(recent["deck_id"], f.deck_a);
        assert_eq!(recent["cards"].as_array().unwrap().len(), 1);
        let found = search_cards(&f.conn, &p, &json!({ "deck_id": f.deck_a, "tags": ["x"] })).unwrap();
        assert_eq!(found["cards"].as_array().unwrap().len(), 1);
        // A sole pinned Deck may be omitted.
        let pinned = policy(DeckScope::from_ids(Some(&[f.deck_b.clone()])));
        let cols = list_columns(&f.conn, &pinned, &Value::Null).unwrap();
        assert_eq!(cols["deck_id"], f.deck_b);
    }

    #[test]
    fn describe_carries_the_full_policy() {
        let f = fixture();
        let p = AccessPolicy::new(
            DeckScope::from_ids(Some(&[f.deck_a.clone()])),
            Capabilities::default(),
            30,
            WriteScope::allowlist([f.col_a.clone()]),
            "Reporter",
        );
        let d = describe_deck(&f.conn, &p, &json!({})).unwrap();
        assert_eq!(d["deck_id"], f.deck_a);
        assert_eq!(d["capabilities"]["write_columns"], json!([f.col_a]));
        assert_eq!(d["capabilities"]["pinned_deck_ids"], json!([f.deck_a]));
        assert_eq!(d["constraints"]["max_writes_per_min"], 30);
    }

    #[test]
    fn pinned_scope_hides_other_decks_from_every_operation() {
        let f = fixture();
        let p = policy(DeckScope::from_ids(Some(&[f.deck_b.clone()])));
        assert!(matches!(
            list_columns(&f.conn, &p, &json!({ "deck_id": f.deck_a })),
            Err(AccessError::Core(JotDeckError::Unauthorized(_)))
        ));
        assert!(matches!(
            read_card(&f.conn, &p, &json!({ "card_id": f.card_a })),
            Err(AccessError::Core(JotDeckError::NotFound(_)))
        ));
        assert!(matches!(
            append_card(&f.conn, &p, &author(), &json!({ "column_id": f.col_a, "content": "x" })),
            Err(AccessError::Core(JotDeckError::Unauthorized(_)))
        ));
        let decks = list_decks(&f.conn, &p).unwrap();
        assert_eq!(decks["decks"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn writes_follow_the_target_deck_and_report_their_effect() {
        let f = fixture();
        let p = policy(DeckScope::AnyDeck);
        let w = append_card(&f.conn, &p, &author(), &json!({ "column_id": f.col_b, "content": "b" })).unwrap();
        assert_eq!(w.deck_id, f.deck_b);
        assert!(matches!(w.effect, Effect::Card { ref column_id, .. } if *column_id == f.col_b));
        assert_eq!(w.effect.target(), w.result["card_id"].as_str().unwrap());

        let ensured = ensure_column(&f.conn, &p, &author(), &json!({ "deck_id": f.deck_a, "name": "Todo" })).unwrap();
        assert_eq!(ensured.result["deck_id"], f.deck_a);
        assert_eq!(ensured.result["created"], true);
        // ensure_column needs a Deck when the connection may address several.
        assert!(matches!(
            ensure_column(&f.conn, &p, &author(), &json!({ "name": "Todo" })),
            Err(AccessError::Core(JotDeckError::InvalidOperation(_)))
        ));
    }

    #[test]
    fn update_column_distinguishes_absent_from_cleared_description() {
        let f = fixture();
        let p = policy(DeckScope::AnyDeck);
        update_column(&f.conn, &p, &author(), &json!({ "column_id": f.col_a, "description": "papers" })).unwrap();
        let kept = update_column(&f.conn, &p, &author(), &json!({ "column_id": f.col_a, "name": "Reading" })).unwrap();
        assert_eq!(kept.result["description"], "papers");
        let null_kept = update_column(&f.conn, &p, &author(), &json!({ "column_id": f.col_a, "description": null })).unwrap();
        assert_eq!(null_kept.result["description"], "papers");
        let cleared = update_column(&f.conn, &p, &author(), &json!({ "column_id": f.col_a, "description": "" })).unwrap();
        assert!(cleared.result["description"].is_null());
    }

    #[test]
    fn null_optional_arguments_count_as_omitted() {
        let f = fixture();
        let p = policy(DeckScope::AnyDeck);
        let found = search_cards(
            &f.conn,
            &p,
            &json!({ "deck_id": f.deck_a, "query": null, "column_id": null, "tags": null, "min_score": null, "limit": null }),
        )
        .unwrap();
        assert_eq!(found["cards"].as_array().unwrap().len(), 1);
        let ensured = ensure_column(
            &f.conn,
            &p,
            &author(),
            &json!({ "deck_id": f.deck_a, "name": "Todo", "description": null, "private": null }),
        )
        .unwrap();
        assert_eq!(ensured.result["created"], true);
        assert!(move_card(
            &f.conn,
            &p,
            &author(),
            &json!({ "card_id": f.card_a, "to_column_id": null, "before_card_id": null, "after_card_id": null }),
        )
        .is_ok());
    }

    #[test]
    fn missing_arguments_are_invalid_args() {
        let f = fixture();
        let p = policy(DeckScope::AnyDeck);
        assert!(matches!(
            read_card(&f.conn, &p, &json!({})),
            Err(AccessError::InvalidArgs(ref m)) if m.contains("card_id")
        ));
        assert!(matches!(
            patch_card(&f.conn, &p, &author(), &json!({ "card_id": f.card_a, "content": "x", "expected_updated_at": "yesterday" })),
            Err(AccessError::InvalidArgs(_))
        ));
    }
}
