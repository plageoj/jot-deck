/**
 * Lazy loader for CardEditor. CodeMirror (+ Vim mode) is the bulk of the
 * frontend bundle but is only needed once a card enters edit focus, so it is
 * split out of the startup chunk. The page preloads it right after the first
 * board paint, so by the time a user starts editing it is normally resolved
 * and `getLoadedCardEditor()` hands the component over synchronously.
 */

import type CardEditorComponent from "./components/CardEditor.svelte";

type CardEditor = typeof CardEditorComponent;

let loaded: CardEditor | null = null;
let loading: Promise<CardEditor> | null = null;

export function getLoadedCardEditor(): CardEditor | null {
  return loaded;
}

export function loadCardEditor(): Promise<CardEditor> {
  loading ??= import("./components/CardEditor.svelte").then((m) => {
    loaded = m.default;
    return m.default;
  });
  return loading;
}
