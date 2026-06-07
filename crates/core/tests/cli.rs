//! End-to-end tests for the `jot-deck-cli` binary.
//!
//! Each test drives the compiled binary through stdin/stdout against a fresh
//! temporary database file, exercising the REPL dispatch and every command.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// A temporary database path that deletes itself (and SQLite side files) on drop.
struct TempDb {
    path: PathBuf,
}

impl TempDb {
    fn new() -> Self {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let mut path = std::env::temp_dir();
        path.push(format!("jotdeck_cli_test_{}_{}.db", std::process::id(), n));
        Self { path }
    }

    fn as_str(&self) -> &str {
        self.path.to_str().unwrap()
    }
}

impl Drop for TempDb {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
        for suffix in ["-wal", "-shm"] {
            let mut p = self.path.clone().into_os_string();
            p.push(suffix);
            let _ = std::fs::remove_file(p);
        }
    }
}

/// Run the CLI against `db_path`, feeding `input` on stdin, returning stdout.
fn run(db_path: &str, input: &str) -> String {
    let mut child = Command::new(env!("CARGO_BIN_EXE_jot-deck-cli"))
        .arg(db_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn jot-deck-cli");

    child
        .stdin
        .take()
        .expect("child stdin")
        .write_all(input.as_bytes())
        .expect("write stdin");

    let output = child.wait_with_output().expect("wait for cli");
    String::from_utf8_lossy(&output.stdout).into_owned()
}

/// Extract the id inside the last "(...)" of the first line containing `marker`.
fn id_in_parens(out: &str, marker: &str) -> String {
    let line = out
        .lines()
        .find(|l| l.contains(marker))
        .unwrap_or_else(|| panic!("no line with {marker:?} in:\n{out}"));
    let start = line.rfind('(').unwrap() + 1;
    let end = line.rfind(')').unwrap();
    line[start..end].to_string()
}

/// Extract the token following `prefix` on the first matching line.
fn token_after(out: &str, prefix: &str) -> String {
    let line = out
        .lines()
        .find(|l| l.contains(prefix))
        .unwrap_or_else(|| panic!("no line with {prefix:?} in:\n{out}"));
    line.split(prefix)
        .nth(1)
        .unwrap()
        .split_whitespace()
        .next()
        .unwrap()
        .to_string()
}

#[test]
fn cli_full_happy_path() {
    let db = TempDb::new();

    // help + empty deck listing
    let out = run(db.as_str(), "help\nh\n?\ndeck-list\n\nquit\n");
    assert!(out.contains("Jot Deck CLI Commands:"), "help text:\n{out}");
    assert!(out.contains("No decks found."), "empty list:\n{out}");
    assert!(out.contains("Goodbye!"), "quit:\n{out}");

    // create + show a deck
    let out = run(db.as_str(), "deck-new My Deck\ndeck-list\nquit\n");
    assert!(out.contains("Created deck: My Deck"), "{out}");
    let deck = id_in_parens(&out, "Created deck: My Deck");
    assert!(out.contains("- My Deck"), "deck-list:\n{out}");

    // create columns
    let out = run(
        db.as_str(),
        &format!("col-new {deck} Todo\ncol-new {deck} Done\nquit\n"),
    );
    let col_todo = id_in_parens(&out, "Created column: Todo");
    let col_done = id_in_parens(&out, "Created column: Done");

    // rename + move a column (valid position)
    let out = run(
        db.as_str(),
        &format!("col-rename {col_todo} Backlog\ncol-move {col_done} 0\nquit\n"),
    );
    assert!(out.contains("Renamed column:"), "{out}");
    assert!(out.contains("Moved column"), "{out}");

    // create a card with a tag (covers tag-sync print) and one without
    let out = run(
        db.as_str(),
        &format!("card-new {col_todo} Buy milk #shopping\ncard-new {col_todo} plain note\nquit\n"),
    );
    assert!(out.contains("Created card:"), "{out}");
    assert!(out.contains("Tags: #shopping"), "tag print:\n{out}");
    let card = token_after(&out, "Created card: ");

    // edit, score (explicit delta then default +1), move card, move to other column
    let out = run(
        db.as_str(),
        &format!(
            "card-edit {card} Buy oat milk #shopping #urgent\ncard-fav {card} 3\ncard-fav {card}\ncard-move {card} 0\ncard-movecol {card} {col_done}\nquit\n"
        ),
    );
    assert!(out.contains("Updated card:"), "{out}");
    assert!(out.contains("Tags: #shopping, #urgent"), "{out}");
    assert!(out.contains("score: 3"), "{out}");
    assert!(out.contains("score: 4"), "default delta +1:\n{out}");
    assert!(out.contains("Moved card"), "{out}");

    // tags + tag-search
    let out = run(
        db.as_str(),
        &format!("tags {deck}\ntag-search {deck} shopping\ntag-search {deck} missing\nquit\n"),
    );
    assert!(out.contains("#shopping"), "tags:\n{out}");
    assert!(out.contains("Cards with tag #shopping:"), "{out}");
    assert!(out.contains("No cards found with tag #missing"), "{out}");

    // deck-show renders columns and cards
    let out = run(db.as_str(), &format!("deck-show {deck}\nquit\n"));
    assert!(out.contains("Deck: My Deck"), "{out}");
    assert!(out.contains("Columns:"), "{out}");

    // delete + restore a card, delete + restore a column, then trash + cleanup
    let out = run(
        db.as_str(),
        &format!(
            "card-delete {card}\ncard-restore {card}\ncol-delete {col_todo}\ntrash {deck}\ncol-restore {col_todo}\ncleanup\nquit\n"
        ),
    );
    assert!(out.contains("Deleted card:"), "{out}");
    assert!(out.contains("Restored card:"), "{out}");
    assert!(out.contains("Deleted column:"), "{out}");
    assert!(out.contains("Deleted columns:"), "trash header:\n{out}");
    assert!(out.contains("Restored column:"), "{out}");
    assert!(out.contains("Cleanup complete:"), "{out}");

    // delete the deck
    let out = run(db.as_str(), &format!("deck-delete {deck}\nquit\n"));
    assert!(out.contains("Deleted deck:"), "{out}");
}

#[test]
fn cli_usage_and_error_paths() {
    let db = TempDb::new();

    // Unknown command + usage messages for missing arguments.
    let out = run(
        db.as_str(),
        "totally-unknown\ndeck-show\ndeck-delete\ncol-new\ncol-rename\ncol-delete\ncol-restore\ncol-move\nquit\n",
    );
    assert!(out.contains("Unknown command: totally-unknown"), "{out}");
    assert!(out.contains("Usage: deck-show <deck_id>"), "{out}");
    assert!(out.contains("Usage: deck-delete <deck_id>"), "{out}");
    assert!(out.contains("Usage: col-new <deck_id> [name]"), "{out}");
    assert!(out.contains("Usage: col-rename <column_id> <new_name>"), "{out}");
    assert!(out.contains("Usage: col-delete <column_id>"), "{out}");
    assert!(out.contains("Usage: col-restore <column_id>"), "{out}");
    assert!(out.contains("Usage: col-move <column_id> <position>"), "{out}");

    let out = run(
        db.as_str(),
        "card-new\ncard-edit\ncard-delete\ncard-restore\ncard-fav\ncard-move\ncard-movecol\ntags\ntag-search\ntrash\nquit\n",
    );
    assert!(out.contains("Usage: card-new <column_id> <content>"), "{out}");
    assert!(out.contains("Usage: card-edit <card_id> <content>"), "{out}");
    assert!(out.contains("Usage: card-delete <card_id>"), "{out}");
    assert!(out.contains("Usage: card-restore <card_id>"), "{out}");
    assert!(out.contains("Usage: card-fav <card_id> [delta]"), "{out}");
    assert!(out.contains("Usage: card-move <card_id> <position>"), "{out}");
    assert!(out.contains("Usage: card-movecol <card_id> <column_id>"), "{out}");
    assert!(out.contains("Usage: tags <deck_id>"), "{out}");
    assert!(out.contains("Usage: tag-search <deck_id> <tag_name>"), "{out}");
    assert!(out.contains("Usage: trash <deck_id>"), "{out}");

    // "Invalid position" branch for non-numeric positions.
    let out = run(
        db.as_str(),
        "col-move some-col not-a-number\ncard-move some-card nope\nquit\n",
    );
    assert_eq!(out.matches("Invalid position").count(), 2, "{out}");

    // Error branch: showing a non-existent deck.
    let out = run(db.as_str(), "deck-show does-not-exist\nquit\n");
    assert!(out.contains("Error:"), "{out}");

    // Empty deck has no tags / no cards.
    let out = run(db.as_str(), "deck-new Empty\nquit\n");
    let deck = id_in_parens(&out, "Created deck: Empty");
    let out = run(
        db.as_str(),
        &format!("tags {deck}\ntag-search {deck} whatever\nquit\n"),
    );
    assert!(out.contains("No tags found."), "{out}");
    assert!(out.contains("No cards found with tag #whatever"), "{out}");

    // EOF (stdin closed without "quit") should also terminate the REPL.
    let out = run(db.as_str(), "deck-list\n");
    assert!(out.contains("Empty"), "eof termination:\n{out}");
    assert!(!out.contains("Goodbye!"), "should exit via EOF, not quit:\n{out}");
}
