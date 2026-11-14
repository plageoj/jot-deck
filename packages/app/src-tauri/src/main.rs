// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    jot_deck_tauri_lib::startup_trace::mark("main");
    jot_deck_tauri_lib::run()
}
