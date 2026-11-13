//! Per-Reporter authorization scope (007 §2.3).
//!
//! Spawning only guarantees the parent/child relationship, not that the
//! registered binary is benign, so identity and write permission are carried by
//! this scope — not by the fact that the host spawned the Reporter. The policy
//! itself is `jot_deck_core::access::AccessPolicy`, the same type the MCP bridge
//! uses (008 §5), so the two transports can't drift apart (007 §3.2): a
//! registration's Decks, capabilities, rate limit and column allowlist become
//! exactly the limits an MCP connection configured the same way would get.
//!
//! `private` columns are excluded by the core trust boundary itself
//! (`jot_deck_core::write`/`query`), so this scope never has to re-check them.

use jot_deck_core::access::{AccessPolicy, Capabilities, DEFAULT_MAX_WRITES_PER_MIN};
use jot_deck_core::deck_scope::DeckScope;
use jot_deck_core::history::Author;
use jot_deck_core::write::WriteScope;

/// The authorization scope applied to one running Reporter.
pub struct ReporterScope {
    policy: AccessPolicy,
    /// Opaque id identifying this Reporter in the change history and as the
    /// occupancy-lock holder while it streams (002 §5.2 `locked_by`).
    pub reporter_id: String,
}

impl Default for ReporterScope {
    /// Every Deck, every capability, the default rate, no column allowlist.
    fn default() -> Self {
        Self::new(
            None,
            Capabilities::default(),
            DEFAULT_MAX_WRITES_PER_MIN,
            None,
            ulid::Ulid::generate().to_string(),
        )
    }
}

impl ReporterScope {
    /// `deck_ids`: `None` lets each call address any Deck; a list limits the
    /// Reporter to those Decks (one Deck lets calls omit `deck_id`).
    /// `allowed_columns`: `None` = every visible column; a list narrows writes
    /// to those columns and disables `column.ensure` creation (008 §4.5).
    pub fn new(
        deck_ids: Option<Vec<String>>,
        capabilities: Capabilities,
        max_writes_per_min: usize,
        allowed_columns: Option<Vec<String>>,
        reporter_id: String,
    ) -> Self {
        let write_scope = match allowed_columns {
            None => WriteScope::unrestricted(),
            Some(cols) => WriteScope::allowlist(cols),
        };
        Self {
            policy: AccessPolicy::new(
                DeckScope::from_ids(deck_ids.as_deref()),
                capabilities,
                max_writes_per_min,
                write_scope,
                "Reporter",
            ),
            reporter_id,
        }
    }

    /// The access policy every Reporter method runs under.
    pub fn policy(&self) -> &AccessPolicy {
        &self.policy
    }

    pub fn capabilities(&self) -> Capabilities {
        self.policy.capabilities()
    }

    pub fn max_writes_per_min(&self) -> usize {
        self.policy.max_writes_per_min()
    }

    /// Who this Reporter's writes are attributed to in the change history
    /// (008 §5.1). The GUI labels it from the registration.
    pub fn author(&self) -> Author {
        Author::reporter(self.reporter_id.clone())
    }
}
