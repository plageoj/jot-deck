use thiserror::Error;

#[derive(Error, Debug)]
pub enum JotDeckError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Invalid operation: {0}")]
    InvalidOperation(String),

    /// アクセス範囲外（private / 接続 Deck 外）のリソースを明示指定したときに返す。
    /// 存在を漏らさないため、read_card などでは NotFound を優先する（008 §4.5）。
    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    /// カード編集の競合（002 §5）。占有ロックが他者に握られている、または楽観
    /// ロック（compare-and-swap）の `expected_updated_at` が現在値と一致しない。
    /// 呼び出し側は再読込して再試行する。
    #[error("Conflict: {0}")]
    Conflict(String),
}

pub type Result<T> = std::result::Result<T, JotDeckError>;
