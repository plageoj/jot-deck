//! Jot Deck MCP bridge binary.
//!
//! Spawned by an MCP host (Claude Desktop / Claude Code) via its `mcpServers`
//! config. Configuration is passed through environment variables — the host
//! does not hand ULIDs on argv:
//!
//! - `JOT_DECK_DB_PATH`  — path to the `jot-deck.db` file to open.
//! - `JOT_DECK_DECK_ID`  — ULID of the Deck to serve (copy it from the GUI's
//!   Deck management UI: "Copy MCP deck id").
//!
//! Speaks JSON-RPC 2.0 over stdio, one JSON message per line (the newline-
//! delimited stdio transport). Reads only; write tools arrive in Phase 5.

use std::io::{self, BufRead, Write};
use std::process::ExitCode;

use jot_deck_core::create_file_db;
use jot_deck_mcp::Bridge;

fn main() -> ExitCode {
    let db_path = match std::env::var("JOT_DECK_DB_PATH") {
        Ok(p) if !p.is_empty() => p,
        _ => {
            eprintln!("jot-deck-mcp: JOT_DECK_DB_PATH is required (path to jot-deck.db)");
            return ExitCode::FAILURE;
        }
    };
    let deck_id = match std::env::var("JOT_DECK_DECK_ID") {
        Ok(d) if !d.is_empty() => d,
        _ => {
            eprintln!("jot-deck-mcp: JOT_DECK_DECK_ID is required (the Deck ULID to serve)");
            return ExitCode::FAILURE;
        }
    };

    // Same open path as the CLI/GUI: WAL + busy_timeout let us share the file
    // with a running GUI. We issue only read queries.
    let conn = match create_file_db(&db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("jot-deck-mcp: failed to open {}: {}", db_path, e);
            return ExitCode::FAILURE;
        }
    };

    let bridge = Bridge::new(conn, deck_id);
    serve(&bridge);
    ExitCode::SUCCESS
}

/// Read messages line-by-line from stdin, write each response as one line to
/// stdout. Exits cleanly on EOF (host closed the pipe).
fn serve(bridge: &Bridge) {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        if let Some(response) = bridge.handle_message(&line) {
            // One JSON object per line.
            if writeln!(out, "{}", response).is_err() {
                break;
            }
            let _ = out.flush();
        }
    }
}
