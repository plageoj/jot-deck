use jot_deck_core::{
    create_file_db,
    repository::{card, column, deck},
    Card, Column, Connection, Deck, NewCard, NewColumn, NewDeck, SortOrder,
};
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, MutexGuard};
use tauri::{Manager, State};

/// アプリケーションの状態
struct AppState {
    conn: Mutex<Connection>,
}

/// エラーをシリアライズ可能な形式に変換する
#[derive(Debug, Serialize)]
struct CommandError {
    message: String,
}

impl From<jot_deck_core::JotDeckError> for CommandError {
    fn from(e: jot_deck_core::JotDeckError) -> Self {
        CommandError {
            message: e.to_string(),
        }
    }
}

type CommandResult<T> = Result<T, CommandError>;

/// Mutex ロックを取得するヘルパー関数（poisoning 対応）
fn get_conn<'a>(state: &'a State<'a, AppState>) -> CommandResult<MutexGuard<'a, Connection>> {
    state.conn.lock().map_err(|e| CommandError {
        message: format!("Database lock poisoned: {}", e),
    })
}

// ========== Deck Commands ==========

#[tauri::command]
fn get_all_decks(state: State<AppState>) -> CommandResult<Vec<Deck>> {
    let conn = get_conn(&state)?;
    deck::get_all(&conn).map_err(Into::into)
}

#[tauri::command]
fn get_deck(state: State<AppState>, id: String) -> CommandResult<Deck> {
    let conn = get_conn(&state)?;
    deck::get_by_id(&conn, &id).map_err(Into::into)
}

#[derive(Debug, Deserialize)]
struct CreateDeckParams {
    name: String,
    sort_order: Option<String>,
}

#[tauri::command]
fn create_deck(state: State<AppState>, params: CreateDeckParams) -> CommandResult<Deck> {
    let conn = get_conn(&state)?;
    let sort_order = params
        .sort_order
        .map(|s| SortOrder::from_db_value(&s))
        .unwrap_or_default();
    deck::create(
        &conn,
        NewDeck {
            name: params.name,
            sort_order,
        },
    )
    .map_err(Into::into)
}

#[tauri::command]
fn update_deck(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    sort_order: Option<String>,
) -> CommandResult<Deck> {
    let conn = get_conn(&state)?;
    let sort_order = sort_order.map(|s| SortOrder::from_db_value(&s));
    deck::update(&conn, &id, name.as_deref(), sort_order).map_err(Into::into)
}

#[tauri::command]
fn delete_deck(state: State<AppState>, id: String) -> CommandResult<()> {
    let conn = get_conn(&state)?;
    deck::delete(&conn, &id).map_err(Into::into)
}

// ========== Column Commands ==========

#[tauri::command]
fn get_columns_by_deck(state: State<AppState>, deck_id: String) -> CommandResult<Vec<Column>> {
    let conn = get_conn(&state)?;
    column::get_by_deck_id(&conn, &deck_id).map_err(Into::into)
}

#[tauri::command]
fn get_column(state: State<AppState>, id: String) -> CommandResult<Column> {
    let conn = get_conn(&state)?;
    column::get_by_id(&conn, &id).map_err(Into::into)
}

#[derive(Debug, Deserialize)]
struct CreateColumnParams {
    deck_id: String,
    name: Option<String>,
    position: Option<i32>,
}

#[tauri::command]
fn create_column(state: State<AppState>, params: CreateColumnParams) -> CommandResult<Column> {
    let conn = get_conn(&state)?;
    let new_column = NewColumn {
        deck_id: params.deck_id,
        name: params.name.unwrap_or_default(),
    };
    match params.position {
        Some(pos) => column::create_at_position(&conn, new_column, pos),
        None => column::create(&conn, new_column),
    }
    .map_err(Into::into)
}

#[tauri::command]
fn update_column(state: State<AppState>, id: String, name: String) -> CommandResult<Column> {
    let conn = get_conn(&state)?;
    column::update(&conn, &id, Some(&name)).map_err(Into::into)
}

#[tauri::command]
fn move_column(state: State<AppState>, id: String, position: i32) -> CommandResult<Column> {
    let conn = get_conn(&state)?;
    column::move_to_position(&conn, &id, position).map_err(Into::into)
}

#[tauri::command]
fn delete_column(state: State<AppState>, id: String) -> CommandResult<()> {
    let conn = get_conn(&state)?;
    column::soft_delete(&conn, &id).map_err(Into::into)
}

#[tauri::command]
fn restore_column(state: State<AppState>, id: String) -> CommandResult<Column> {
    let conn = get_conn(&state)?;
    column::restore(&conn, &id).map_err(Into::into)
}

#[tauri::command]
fn get_deleted_columns(state: State<AppState>, deck_id: String) -> CommandResult<Vec<Column>> {
    let conn = get_conn(&state)?;
    column::get_deleted(&conn, &deck_id).map_err(Into::into)
}

// ========== Card Commands ==========

#[tauri::command]
fn get_cards_by_column(state: State<AppState>, column_id: String) -> CommandResult<Vec<Card>> {
    let conn = get_conn(&state)?;
    card::get_by_column_id(&conn, &column_id).map_err(Into::into)
}

#[tauri::command]
fn get_card(state: State<AppState>, id: String) -> CommandResult<Card> {
    let conn = get_conn(&state)?;
    card::get_by_id(&conn, &id).map_err(Into::into)
}

#[derive(Debug, Deserialize)]
struct CreateCardParams {
    column_id: String,
    content: String,
    position: Option<i32>,
}

#[tauri::command]
fn create_card(state: State<AppState>, params: CreateCardParams) -> CommandResult<Card> {
    let conn = get_conn(&state)?;
    let new_card = NewCard {
        column_id: params.column_id,
        content: params.content,
    };
    match params.position {
        Some(pos) => card::create_at_position(&conn, new_card, pos),
        None => card::create(&conn, new_card),
    }
    .map_err(Into::into)
}

#[tauri::command]
fn update_card_content(
    state: State<AppState>,
    id: String,
    content: String,
) -> CommandResult<Card> {
    let conn = get_conn(&state)?;
    card::update_content(&conn, &id, &content).map_err(Into::into)
}

#[tauri::command]
fn update_card_score(state: State<AppState>, id: String, delta: i32) -> CommandResult<Card> {
    let conn = get_conn(&state)?;
    card::update_score(&conn, &id, delta).map_err(Into::into)
}

#[tauri::command]
fn move_card_to_column(
    state: State<AppState>,
    id: String,
    column_id: String,
) -> CommandResult<Card> {
    let conn = get_conn(&state)?;
    card::move_to_column(&conn, &id, &column_id).map_err(Into::into)
}

#[tauri::command]
fn move_card(state: State<AppState>, id: String, position: i32) -> CommandResult<Card> {
    let conn = get_conn(&state)?;
    card::move_to_position(&conn, &id, position).map_err(Into::into)
}

#[tauri::command]
fn delete_card(state: State<AppState>, id: String) -> CommandResult<()> {
    let conn = get_conn(&state)?;
    card::soft_delete(&conn, &id).map_err(Into::into)
}

#[tauri::command]
fn restore_card(state: State<AppState>, id: String) -> CommandResult<Card> {
    let conn = get_conn(&state)?;
    card::restore(&conn, &id).map_err(Into::into)
}

#[tauri::command]
fn get_deleted_cards(state: State<AppState>, deck_id: String) -> CommandResult<Vec<Card>> {
    let conn = get_conn(&state)?;
    card::get_deleted_by_deck(&conn, &deck_id).map_err(Into::into)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // データベースのパスを設定
            let app_data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data dir");
            let db_path = app_data_dir.join("jot-deck.db");

            let conn = create_file_db(db_path.to_str().unwrap())
                .expect("Failed to create database");

            app.manage(AppState {
                conn: Mutex::new(conn),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Deck commands
            get_all_decks,
            get_deck,
            create_deck,
            update_deck,
            delete_deck,
            // Column commands
            get_columns_by_deck,
            get_column,
            create_column,
            update_column,
            move_column,
            delete_column,
            restore_column,
            get_deleted_columns,
            // Card commands
            get_cards_by_column,
            get_card,
            create_card,
            update_card_content,
            update_card_score,
            move_card_to_column,
            move_card,
            delete_card,
            restore_card,
            get_deleted_cards,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
