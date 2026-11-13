//! The deck-scoped read layer never surfaces soft-deleted cards, whether a
//! card was deleted on its own or together with its column.

use jot_deck_core::query::{self, SearchParams};
use jot_deck_core::{card, column, create_in_memory, deck, JotDeckError, NewCard, NewColumn, NewDeck, SortOrder};

struct Board {
    conn: rusqlite::Connection,
    deck_id: String,
    live_card: String,
    standalone_deleted: String,
    cascaded: String,
}

fn setup() -> Board {
    let conn = create_in_memory().unwrap();
    let d = deck::create(
        &conn,
        NewDeck {
            name: "KB".to_string(),
            sort_order: SortOrder::default(),
        },
    )
    .unwrap();
    let new_column = |name: &str| NewColumn {
        deck_id: d.id.clone(),
        name: name.to_string(),
    };
    let kept = column::create(&conn, new_column("Kept")).unwrap();
    let dropped = column::create(&conn, new_column("Dropped")).unwrap();
    let new_card = |column_id: &str, content: &str| NewCard {
        column_id: column_id.to_string(),
        content: content.to_string(),
    };
    let live = card::create(&conn, new_card(&kept.id, "needle live")).unwrap();
    let standalone = card::create(&conn, new_card(&kept.id, "needle standalone")).unwrap();
    let cascaded = card::create(&conn, new_card(&dropped.id, "needle cascaded")).unwrap();
    card::soft_delete(&conn, &standalone.id).unwrap();
    column::soft_delete(&conn, &dropped.id).unwrap();

    Board {
        conn,
        deck_id: d.id,
        live_card: live.id,
        standalone_deleted: standalone.id,
        cascaded: cascaded.id,
    }
}

#[test]
fn read_card_hides_soft_deleted_cards() {
    let b = setup();
    assert!(query::read_card(&b.conn, &b.deck_id, &b.live_card).is_ok());
    for id in [&b.standalone_deleted, &b.cascaded] {
        let err = query::read_card(&b.conn, &b.deck_id, id).unwrap_err();
        assert!(matches!(err, JotDeckError::NotFound(_)), "{id}: {err:?}");
    }
}

#[test]
fn search_and_recent_return_only_live_cards() {
    let b = setup();
    let searched: Vec<String> = query::search_cards(
        &b.conn,
        &b.deck_id,
        &SearchParams {
            query: Some("needle".to_string()),
            ..SearchParams::default()
        },
    )
    .unwrap()
    .into_iter()
    .map(|c| c.card_id)
    .collect();
    assert_eq!(searched, vec![b.live_card.clone()]);

    let recent: Vec<String> = query::recent_cards(&b.conn, &b.deck_id, None, None)
        .unwrap()
        .into_iter()
        .map(|c| c.card_id)
        .collect();
    assert_eq!(recent, vec![b.live_card.clone()]);
}
