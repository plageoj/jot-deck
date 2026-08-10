//! Per-Reporter authorization scope (007 §10 / §3.1).
//!
//! Spawning only guarantees the parent/child relationship, not that the
//! registered binary is benign, so identity and write permission are carried by
//! this scope — not by the fact that the host spawned the Reporter. The scope
//! contract is deliberately the same shape as the MCP bridge's connection policy
//! (008 §5): auth semantics must not diverge between the two transports (007 §3.2).
//!
//! `private` columns are excluded by the core trust boundary itself
//! (`jot_deck_core::write`/`query`), so this scope never has to re-check them.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use jot_deck_core::write::WriteScope;

use crate::protocol::RpcError;

/// Default per-Reporter write cap (writes/minute). Bounds the "many tiny writes"
/// runaway the card-length backstop can't catch (007 §5 / §8).
pub const DEFAULT_MAX_WRITES_PER_MIN: usize = 120;

/// Which write verbs a Reporter may invoke. All default ON; a registration opts
/// out per verb. `card.append` → `append`; `card.patch` / `card.move` /
/// `card.stream.*` → `edit`; `card.delete` → `delete`; the `column.*` structure
/// methods → `structure`. Matches the MCP surface's verb mapping (008 §5)
/// one-for-one.
#[derive(Debug, Clone, Copy)]
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
    /// Parse a deny list like `"append, delete"` into capabilities (default all
    /// on). An unknown token is logged to the host's stderr (audited via the
    /// spawned child's inherited stderr) and otherwise ignored — the mistyped
    /// verb keeps its default-on state. The registration is authored by the
    /// power-user who owns the host (007 §2.2), so a typo is a diagnosable
    /// operator mistake, not an untrusted input; fail-closed rejection (returning
    /// the unknown tokens so a caller can refuse the registration) is a possible
    /// future hardening once deny lists are surfaced in the registration UI.
    pub fn from_deny_list(deny: &str) -> Self {
        let mut c = Self::default();
        for tok in deny
            .split(',')
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty())
        {
            match tok.as_str() {
                "append" => c.append = false,
                "edit" => c.edit = false,
                "delete" => c.delete = false,
                "structure" => c.structure = false,
                other => eprintln!(
                    "[jot-deck-reporter-host] deny: ignoring unknown capability '{}' (expected append/edit/delete/structure)",
                    other
                ),
            }
        }
        c
    }
}

/// Per-Reporter sliding-window write rate limiter (007 §8, 008 §5).
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

    /// Record a write attempt; err if it would exceed the per-minute cap.
    fn check_and_record(&self) -> Result<(), String> {
        let now = Instant::now();
        let mut events = self.events.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(cutoff) = now.checked_sub(Duration::from_secs(60)) {
            while events.front().is_some_and(|&t| t < cutoff) {
                events.pop_front();
            }
        }
        if events.len() >= self.max_per_min {
            return Err(format!(
                "Rate limit exceeded: max {} writes/min for this Reporter. Slow down and retry.",
                self.max_per_min
            ));
        }
        events.push_back(now);
        Ok(())
    }
}

/// The authorization scope applied to one Reporter over one Deck.
pub struct ReporterScope {
    capabilities: Capabilities,
    rate_limiter: RateLimiter,
    /// Write allowlist by column ULID, in the form core enforces it. Unrestricted
    /// = the whole Deck (minus `private`) is writable; an allowlist narrows writes
    /// to those columns and, per 008 §4.5, disables `column.ensure` *creation*
    /// (a fixed set is intended). Core is the only place that checks it — this
    /// scope carries the policy, it does not re-implement the gate.
    write_scope: WriteScope,
    /// Opaque id identifying this Reporter in write-attribution logs and as the
    /// occupancy-lock holder in Phase 2 (002 §5.2 `locked_by`).
    pub reporter_id: String,
}

impl Default for ReporterScope {
    fn default() -> Self {
        Self {
            capabilities: Capabilities::default(),
            rate_limiter: RateLimiter::new(DEFAULT_MAX_WRITES_PER_MIN),
            write_scope: WriteScope::unrestricted(),
            reporter_id: ulid::Ulid::generate().to_string(),
        }
    }
}

impl ReporterScope {
    pub fn new(
        capabilities: Capabilities,
        max_writes_per_min: usize,
        allowed_columns: Option<Vec<String>>,
        reporter_id: String,
    ) -> Self {
        Self {
            capabilities,
            rate_limiter: RateLimiter::new(max_writes_per_min),
            write_scope: match allowed_columns {
                None => WriteScope::unrestricted(),
                Some(cols) => WriteScope::allowlist(cols),
            },
            reporter_id,
        }
    }

    pub fn capabilities(&self) -> Capabilities {
        self.capabilities
    }

    pub fn max_writes_per_min(&self) -> usize {
        self.rate_limiter.max_per_min
    }

    /// Common prelude for every write method: enforce the verb's capability,
    /// then the rate limit. Centralized so the two gates and their order never
    /// drift between methods (mirrors the MCP bridge's `begin_write`).
    pub fn begin_write(&self, enabled: bool, verb: &str) -> Result<(), RpcError> {
        if !enabled {
            return Err(RpcError::policy_denied(format!(
                "The '{}' capability is disabled for this Reporter.",
                verb
            )));
        }
        self.rate_limiter
            .check_and_record()
            .map_err(RpcError::policy_denied)
    }

    /// This Reporter's write allowlist, to hand to every `jot_deck_core::write`
    /// call. The allowlist gate (and the `column.ensure` create-vs-get rule it
    /// implies) lives in core with the visibility gate, so the two can never
    /// drift apart here — 008 §4.5 / write.rs's trust boundary.
    pub fn write_scope(&self) -> &WriteScope {
        &self.write_scope
    }
}
