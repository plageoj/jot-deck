use std::env;
use std::io::{self, BufRead, Write};

use jot_deck_core::{
    card, column, create_file_db, deck, run_cleanup_batch, tag, Connection, NewCard, NewColumn,
    NewDeck, SortOrder,
};

fn main() {
    let args: Vec<String> = env::args().collect();

    let db_path = args.get(1).map(|s| s.as_str()).unwrap_or("jot-deck.db");

    println!("Jot Deck CLI - データ層テスト");
    println!("Database: {}", db_path);
    println!("----------------------------------------");

    let mut conn = create_file_db(db_path).expect("Failed to open database");
    run_repl(&mut conn);
}

/// Read-eval-print loop: read a command line and dispatch it.
fn run_repl(conn: &mut Connection) {
    loop {
        print!("> ");
        io::stdout().flush().unwrap();

        let mut input = String::new();
        // Stop on read error or EOF (0 bytes), e.g. when stdin is a closed pipe.
        match io::stdin().lock().read_line(&mut input) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }

        let input = input.trim();
        if input.is_empty() {
            continue;
        }

        let parts: Vec<&str> = input.split_whitespace().collect();
        let cmd = parts.first().copied().unwrap_or("");

        if !dispatch(cmd, &parts, conn) {
            break;
        }
    }
}

/// Dispatch a single command. Returns `false` when the REPL should exit.
fn dispatch(cmd: &str, parts: &[&str], conn: &mut Connection) -> bool {
    match cmd {
        "help" | "h" | "?" => print_help(),

        // Deck commands
        "deck-new" | "dn" => cmd_deck_new(parts, conn),
        "deck-list" | "dl" => cmd_deck_list(conn),
        "deck-show" | "ds" => cmd_deck_show(parts, conn),
        "deck-delete" | "dd" => cmd_deck_delete(parts, conn),

        // Column commands
        "col-new" | "cn" => cmd_col_new(parts, conn),
        "col-rename" | "cr" => cmd_col_rename(parts, conn),
        "col-delete" | "cd" => cmd_col_delete(parts, conn),
        "col-restore" => cmd_col_restore(parts, conn),
        "col-move" | "cm" => cmd_col_move(parts, conn),

        // Card commands
        "card-new" | "an" => cmd_card_new(parts, conn),
        "card-edit" | "ae" => cmd_card_edit(parts, conn),
        "card-delete" | "ad" => cmd_card_delete(parts, conn),
        "card-restore" => cmd_card_restore(parts, conn),
        "card-fav" | "af" => cmd_card_fav(parts, conn),
        "card-move" | "am" => cmd_card_move(parts, conn),
        "card-movecol" => cmd_card_movecol(parts, conn),

        // Tag commands
        "tags" | "t" => cmd_tags(parts, conn),
        "tag-search" | "ts" => cmd_tag_search(parts, conn),

        // Trash commands
        "trash" => cmd_trash(parts, conn),

        // Cleanup
        "cleanup" => cmd_cleanup(conn),

        "quit" | "exit" | "q" => {
            println!("Goodbye!");
            return false;
        }

        _ => println!("Unknown command: {}. Type 'help' for available commands.", cmd),
    }
    true
}

// ============================================
// Deck commands
// ============================================

fn cmd_deck_new(parts: &[&str], conn: &Connection) {
    let name = parts.get(1..).map(|p| p.join(" ")).unwrap_or_default();
    let name = if name.is_empty() {
        "New Deck".to_string()
    } else {
        name
    };
    match deck::create(
        conn,
        NewDeck {
            name: name.clone(),
            sort_order: SortOrder::default(),
        },
    ) {
        Ok(d) => println!("Created deck: {} ({})", d.name, d.id),
        Err(e) => println!("Error: {}", e),
    }
}

fn cmd_deck_list(conn: &Connection) {
    match deck::get_all(conn) {
        Ok(decks) => {
            if decks.is_empty() {
                println!("No decks found.");
            } else {
                for d in decks {
                    println!("  {} - {}", d.id, d.name);
                }
            }
        }
        Err(e) => println!("Error: {}", e),
    }
}

fn cmd_deck_show(parts: &[&str], conn: &Connection) {
    let Some(id) = parts.get(1) else {
        println!("Usage: deck-show <deck_id>");
        return;
    };
    let d = match deck::get_by_id(conn, id) {
        Ok(d) => d,
        Err(e) => {
            println!("Error: {}", e);
            return;
        }
    };

    println!("Deck: {}", d.name);
    println!("  ID: {}", d.id);
    println!("  Sort: {:?}", d.sort_order);
    println!("  Created: {}", d.created_at);
    println!("  Updated: {}", d.updated_at);

    println!("\nColumns:");
    let columns = match column::get_by_deck_id(conn, &d.id) {
        Ok(columns) => columns,
        Err(e) => {
            println!("Error: {}", e);
            return;
        }
    };
    for col in columns {
        println!("  [{}] {} (pos: {})", col.id, col.name, col.position);
        match card::get_by_column_id(conn, &col.id) {
            Ok(cards) => {
                for c in cards {
                    let preview: String = c.content.chars().take(40).collect();
                    println!("    - {} (score: {}) {}", c.id, c.score, preview);
                }
            }
            Err(e) => println!("    Error loading cards: {}", e),
        }
    }
}

fn cmd_deck_delete(parts: &[&str], conn: &Connection) {
    if let Some(id) = parts.get(1) {
        match deck::delete(conn, id) {
            Ok(()) => println!("Deleted deck: {}", id),
            Err(e) => println!("Error: {}", e),
        }
    } else {
        println!("Usage: deck-delete <deck_id>");
    }
}

// ============================================
// Column commands
// ============================================

fn cmd_col_new(parts: &[&str], conn: &Connection) {
    if let Some(deck_id) = parts.get(1) {
        let name = parts.get(2..).map(|p| p.join(" ")).unwrap_or_default();
        match column::create(
            conn,
            NewColumn {
                deck_id: deck_id.to_string(),
                name,
            },
        ) {
            Ok(col) => println!("Created column: {} ({})", col.name, col.id),
            Err(e) => println!("Error: {}", e),
        }
    } else {
        println!("Usage: col-new <deck_id> [name]");
    }
}

fn cmd_col_rename(parts: &[&str], conn: &Connection) {
    if let (Some(id), Some(name)) = (parts.get(1), parts.get(2..)) {
        let name = name.join(" ");
        match column::update(conn, id, Some(&name)) {
            Ok(col) => println!("Renamed column: {} -> {}", col.id, col.name),
            Err(e) => println!("Error: {}", e),
        }
    } else {
        println!("Usage: col-rename <column_id> <new_name>");
    }
}

fn cmd_col_delete(parts: &[&str], conn: &Connection) {
    if let Some(id) = parts.get(1) {
        match column::soft_delete(conn, id) {
            Ok(()) => println!("Deleted column: {}", id),
            Err(e) => println!("Error: {}", e),
        }
    } else {
        println!("Usage: col-delete <column_id>");
    }
}

fn cmd_col_restore(parts: &[&str], conn: &Connection) {
    if let Some(id) = parts.get(1) {
        match column::restore(conn, id) {
            Ok(col) => println!("Restored column: {} ({})", col.name, col.id),
            Err(e) => println!("Error: {}", e),
        }
    } else {
        println!("Usage: col-restore <column_id>");
    }
}

fn cmd_col_move(parts: &[&str], conn: &Connection) {
    if let (Some(id), Some(pos)) = (parts.get(1), parts.get(2)) {
        if let Ok(pos) = pos.parse::<i32>() {
            match column::move_to_position(conn, id, pos) {
                Ok(col) => println!("Moved column {} to position {}", col.id, pos),
                Err(e) => println!("Error: {}", e),
            }
        } else {
            println!("Invalid position");
        }
    } else {
        println!("Usage: col-move <column_id> <position>");
    }
}

// ============================================
// Card commands
// ============================================

fn cmd_card_new(parts: &[&str], conn: &Connection) {
    if let Some(column_id) = parts.get(1) {
        let content = parts.get(2..).map(|p| p.join(" ")).unwrap_or_default();
        match card::create(
            conn,
            NewCard {
                column_id: column_id.to_string(),
                content: content.clone(),
            },
        ) {
            Ok(c) => {
                println!("Created card: {}", c.id);
                print_synced_tags(conn, &c.id, &content);
            }
            Err(e) => println!("Error: {}", e),
        }
    } else {
        println!("Usage: card-new <column_id> <content>");
    }
}

fn cmd_card_edit(parts: &[&str], conn: &Connection) {
    if let (Some(id), Some(content)) = (parts.get(1), parts.get(2..)) {
        let content = content.join(" ");
        match card::update_content(conn, id, &content) {
            Ok(c) => {
                println!("Updated card: {}", c.id);
                print_synced_tags(conn, &c.id, &content);
            }
            Err(e) => println!("Error: {}", e),
        }
    } else {
        println!("Usage: card-edit <card_id> <content>");
    }
}

/// Sync a card's tags and print them if any were extracted.
fn print_synced_tags(conn: &Connection, card_id: &str, content: &str) {
    if let Ok(tags) = tag::sync_card_tags(conn, card_id, content) {
        if !tags.is_empty() {
            let tag_names: Vec<_> = tags.iter().map(|t| format!("#{}", t.name)).collect();
            println!("  Tags: {}", tag_names.join(", "));
        }
    }
}

fn cmd_card_delete(parts: &[&str], conn: &Connection) {
    if let Some(id) = parts.get(1) {
        match card::soft_delete(conn, id) {
            Ok(()) => println!("Deleted card: {}", id),
            Err(e) => println!("Error: {}", e),
        }
    } else {
        println!("Usage: card-delete <card_id>");
    }
}

fn cmd_card_restore(parts: &[&str], conn: &Connection) {
    if let Some(id) = parts.get(1) {
        match card::restore(conn, id) {
            Ok(c) => println!("Restored card: {}", c.id),
            Err(e) => println!("Error: {}", e),
        }
    } else {
        println!("Usage: card-restore <card_id>");
    }
}

fn cmd_card_fav(parts: &[&str], conn: &Connection) {
    if let Some(id) = parts.get(1) {
        let delta: i32 = parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(1);
        match card::update_score(conn, id, delta) {
            Ok(c) => println!("Card {} score: {}", c.id, c.score),
            Err(e) => println!("Error: {}", e),
        }
    } else {
        println!("Usage: card-fav <card_id> [delta]");
    }
}

fn cmd_card_move(parts: &[&str], conn: &Connection) {
    if let (Some(id), Some(pos)) = (parts.get(1), parts.get(2)) {
        if let Ok(pos) = pos.parse::<i32>() {
            match card::move_to_position(conn, id, pos) {
                Ok(c) => println!("Moved card {} to position {}", c.id, pos),
                Err(e) => println!("Error: {}", e),
            }
        } else {
            println!("Invalid position");
        }
    } else {
        println!("Usage: card-move <card_id> <position>");
    }
}

fn cmd_card_movecol(parts: &[&str], conn: &Connection) {
    if let (Some(id), Some(col_id)) = (parts.get(1), parts.get(2)) {
        match card::move_to_column(conn, id, col_id) {
            Ok(c) => println!("Moved card {} to column {}", c.id, col_id),
            Err(e) => println!("Error: {}", e),
        }
    } else {
        println!("Usage: card-movecol <card_id> <column_id>");
    }
}

// ============================================
// Tag commands
// ============================================

fn cmd_tags(parts: &[&str], conn: &Connection) {
    if let Some(deck_id) = parts.get(1) {
        match tag::get_tags_by_deck(conn, deck_id) {
            Ok(tags) => {
                if tags.is_empty() {
                    println!("No tags found.");
                } else {
                    for t in tags {
                        println!("  #{} ({})", t.name, t.id);
                    }
                }
            }
            Err(e) => println!("Error: {}", e),
        }
    } else {
        println!("Usage: tags <deck_id>");
    }
}

fn cmd_tag_search(parts: &[&str], conn: &Connection) {
    if let (Some(deck_id), Some(tag_name)) = (parts.get(1), parts.get(2)) {
        match tag::get_cards_by_tag(conn, deck_id, tag_name) {
            Ok(card_ids) => {
                if card_ids.is_empty() {
                    println!("No cards found with tag #{}", tag_name);
                } else {
                    println!("Cards with tag #{}:", tag_name);
                    for id in card_ids {
                        if let Ok(c) = card::get_by_id(conn, &id) {
                            let preview: String = c.content.chars().take(50).collect();
                            println!("  {} - {}", c.id, preview);
                        }
                    }
                }
            }
            Err(e) => println!("Error: {}", e),
        }
    } else {
        println!("Usage: tag-search <deck_id> <tag_name>");
    }
}

// ============================================
// Trash & cleanup commands
// ============================================

fn cmd_trash(parts: &[&str], conn: &Connection) {
    let Some(deck_id) = parts.get(1) else {
        println!("Usage: trash <deck_id>");
        return;
    };

    println!("Deleted columns:");
    match column::get_deleted(conn, deck_id) {
        Ok(columns) => {
            for col in columns {
                println!("  {} - {} (deleted: {:?})", col.id, col.name, col.deleted_at);
            }
        }
        Err(e) => println!("Error: {}", e),
    }

    println!("\nDeleted cards:");
    match card::get_deleted_by_deck(conn, deck_id) {
        Ok(cards) => {
            for c in cards {
                let preview: String = c.content.chars().take(30).collect();
                let with_col = if c.deleted_with_column {
                    " [with column]"
                } else {
                    ""
                };
                println!(
                    "  {} - {}{} (deleted: {:?})",
                    c.id, preview, with_col, c.deleted_at
                );
            }
        }
        Err(e) => println!("Error: {}", e),
    }
}

fn cmd_cleanup(conn: &mut Connection) {
    match run_cleanup_batch(conn) {
        Ok(result) => {
            println!("Cleanup complete:");
            println!("  Deleted columns: {}", result.deleted_columns);
            println!("  Deleted cards: {}", result.deleted_cards);
            println!("  Deleted orphan tags: {}", result.deleted_orphan_tags);
        }
        Err(e) => println!("Error: {}", e),
    }
}

fn print_help() {
    println!(
        r#"
Jot Deck CLI Commands:

Deck:
  deck-new [name]         (dn)  Create a new deck
  deck-list               (dl)  List all decks
  deck-show <id>          (ds)  Show deck details
  deck-delete <id>        (dd)  Delete a deck

Column:
  col-new <deck_id> [name]      (cn)  Create a new column
  col-rename <id> <name>        (cr)  Rename a column
  col-delete <id>               (cd)  Soft delete a column
  col-restore <id>                    Restore a deleted column
  col-move <id> <position>      (cm)  Move column to position

Card:
  card-new <col_id> <content>   (an)  Create a new card
  card-edit <id> <content>      (ae)  Edit card content
  card-delete <id>              (ad)  Soft delete a card
  card-restore <id>                   Restore a deleted card
  card-fav <id> [delta]         (af)  Update card score (+1 default)
  card-move <id> <position>     (am)  Move card to position
  card-movecol <id> <col_id>          Move card to another column

Tags:
  tags <deck_id>                (t)   List tags in deck
  tag-search <deck_id> <tag>    (ts)  Find cards with tag

Other:
  trash <deck_id>                     Show deleted items
  cleanup                             Run physical delete batch
  help                          (h)   Show this help
  quit                          (q)   Exit
"#
    );
}
