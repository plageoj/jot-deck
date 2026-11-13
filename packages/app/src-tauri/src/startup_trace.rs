//! Opt-in startup timing trace.
//!
//! Set `JOT_DECK_STARTUP_TRACE=<file>` to append one JSON line per launch with
//! wall-clock timestamps (Unix epoch ms) for each startup stage, from both the
//! Rust side and the frontend. Epoch timestamps let an external launcher
//! (`scripts/measure-startup.ps1`) measure from the moment it spawned the
//! process. Unset, every function here is a no-op.

use serde::Deserialize;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const ENV_VAR: &str = "JOT_DECK_STARTUP_TRACE";

struct Trace {
    path: PathBuf,
    marks: Mutex<Vec<(&'static str, f64)>>,
    written: AtomicBool,
}

fn trace() -> Option<&'static Trace> {
    static TRACE: OnceLock<Option<Trace>> = OnceLock::new();
    TRACE
        .get_or_init(|| {
            std::env::var_os(ENV_VAR)
                .filter(|v| !v.is_empty())
                .map(|path| Trace {
                    path: PathBuf::from(path),
                    marks: Mutex::new(Vec::new()),
                    written: AtomicBool::new(false),
                })
        })
        .as_ref()
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// Record a Rust-side startup stage. The first mark of a name wins, so
/// repeated events (e.g. a later page reload) don't overwrite startup values.
pub fn mark(name: &'static str) {
    let Some(t) = trace() else { return };
    let at = now_ms();
    if let Ok(mut marks) = t.marks.lock() {
        if !marks.iter().any(|(n, _)| *n == name) {
            marks.push((name, at));
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct FrontendTrace {
    /// `[name, epoch ms]` pairs recorded by the frontend.
    marks: Vec<(String, f64)>,
    /// Free-form context (column/card counts, etc.).
    info: serde_json::Value,
}

/// Called once by the frontend when the first board has painted; writes the
/// combined trace line. Later calls (and calls with tracing off) are ignored.
#[tauri::command]
pub fn report_startup_trace(trace_data: FrontendTrace) {
    let Some(t) = trace() else { return };
    if t.written.swap(true, Ordering::SeqCst) {
        return;
    }
    let rust: serde_json::Map<String, serde_json::Value> = t
        .marks
        .lock()
        .map(|marks| {
            marks
                .iter()
                .map(|(n, at)| (n.to_string(), serde_json::json!(at)))
                .collect()
        })
        .unwrap_or_default();
    let js: serde_json::Map<String, serde_json::Value> = trace_data
        .marks
        .into_iter()
        .map(|(n, at)| (n, serde_json::json!(at)))
        .collect();
    let line = serde_json::json!({
        "rust": rust,
        "js": js,
        "info": trace_data.info,
    });
    let result = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&t.path)
        .and_then(|mut f| writeln!(f, "{line}"));
    if let Err(e) = result {
        eprintln!("[jot-deck] failed to write startup trace: {e}");
    }
}
