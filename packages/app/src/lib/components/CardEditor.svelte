<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorView, keymap, placeholder } from "@codemirror/view";
  import { EditorState } from "@codemirror/state";
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import { vim, Vim } from "@replit/codemirror-vim";
  import {
    autocompletion,
    acceptCompletion,
    startCompletion,
    completionStatus,
    type CompletionContext,
    type CompletionResult,
  } from "@codemirror/autocomplete";
  import { TAG_PATTERN } from "$lib/types";

  interface Props {
    content: string;
    onSave: (content: string) => void;
    onCancel: () => void;
    onExitEdit?: () => void;
    onTagSuggestions?: (prefix: string) => Promise<{ name: string }[]>;
  }

  let { content, onSave, onCancel, onExitEdit, onTagSuggestions }: Props =
    $props();

  let editorContainer: HTMLDivElement;
  let view: EditorView | null = null;
  let cancelled = false;

  function getContent(): string {
    return view?.state.doc.toString() ?? content;
  }

  function save() {
    onSave(getContent());
  }

  function cancel() {
    cancelled = true;
    onCancel();
    onExitEdit?.();
  }

  function tagCompletionSource(
    context: CompletionContext,
  ): Promise<CompletionResult | null> | CompletionResult | null {
    const match = context.matchBefore(
      new RegExp(TAG_PATTERN.replace("+)", "*)")),
    );
    if (!match || match.from === match.to) return null;

    const prefix = match.text.slice(1); // remove '#'
    if (!onTagSuggestions) return null;

    return onTagSuggestions(prefix).then((tags) => ({
      from: match.from,
      options: tags.map((t) => ({
        label: `#${t.name}`,
        apply: `#${t.name} `,
        type: "keyword",
      })),
    }));
  }

  onMount(() => {
    // Define custom Ex commands for Vim
    Vim.defineEx("w", "w", () => {
      save();
    });
    Vim.defineEx("wq", "wq", () => {
      save();
      cancel();
    });
    Vim.defineEx("q", "q", () => {
      // Discard changes and exit (don't save)
      cancel();
    });
    Vim.defineEx("q!", "q!", () => {
      // Force quit (same as :q since we don't auto-save)
      cancel();
    });

    const customKeymap = keymap.of([
      {
        key: "Ctrl-Enter",
        run: () => {
          save();
          cancel();
          return true;
        },
      },
    ]);

    const completionKeymap = keymap.of([
      { key: "Tab", run: acceptCompletion },
    ]);

    const theme = EditorView.theme({
      "&": {
        backgroundColor: "var(--card-bg)",
        color: "var(--text)",
        fontSize: "0.875rem",
        lineHeight: "1.4",
      },
      ".cm-content": {
        caretColor: "var(--accent)",
        fontFamily: "inherit",
        padding: "0",
      },
      ".cm-cursor": {
        borderLeftColor: "var(--accent)",
        borderLeftWidth: "2px",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: "rgba(233, 69, 96, 0.3)",
      },
      ".cm-activeLine": {
        backgroundColor: "transparent",
      },
      ".cm-gutters": {
        display: "none",
      },
      "&.cm-focused": {
        outline: "none",
      },
      ".cm-scroller": {
        overflow: "auto",
      },
      ".cm-vim-panel": {
        backgroundColor: "var(--bg-tertiary)",
        color: "var(--text)",
        padding: "2px 8px",
        fontSize: "0.75rem",
        fontFamily: "monospace",
      },
      ".cm-vim-panel input": {
        backgroundColor: "transparent",
        color: "var(--text)",
        border: "none",
        outline: "none",
        fontFamily: "monospace",
        fontSize: "0.75rem",
      },
      ".cm-fat-cursor": {
        backgroundColor: "var(--accent) !important",
        color: "var(--bg-primary) !important",
      },
      "&:not(.cm-focused) .cm-fat-cursor": {
        backgroundColor: "transparent !important",
        outline: "1px solid var(--accent)",
      },
      ".cm-tooltip-autocomplete": {
        backgroundColor: "var(--bg-secondary, #16213e)",
        border: "1px solid var(--card-border, #0f3460)",
        borderRadius: "4px",
      },
      ".cm-tooltip-autocomplete ul li": {
        color: "var(--text, #e0e0e0)",
        padding: "2px 8px",
      },
      ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: "var(--accent, #e94560)",
        color: "#fff",
      },
    });

    const tagTriggerRegex = new RegExp(
      TAG_PATTERN.replace("+)", "*)") + "$",
    );
    // Explicitly trigger completion on document changes containing '#'.
    // activateOnTyping relies on userEvent annotations that the Vim
    // extension may not set, so this listener ensures autocompletion
    // works reliably in Vim insert mode.
    const triggerCompletionOnTag = EditorView.updateListener.of((update) => {
      if (update.docChanged && completionStatus(update.state) === null) {
        const cursor = update.state.selection.main.head;
        const line = update.state.doc.lineAt(cursor);
        const textBefore = line.text.slice(0, cursor - line.from);
        if (tagTriggerRegex.test(textBefore)) {
          startCompletion(update.view);
        }
      }
    });

    const state = EditorState.create({
      doc: content,
      extensions: [
        vim(),
        customKeymap,
        completionKeymap,
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        autocompletion({
          override: [tagCompletionSource],
        }),
        triggerCompletionOnTag,
        placeholder("Start typing..."),
        theme,
        EditorView.lineWrapping,
        EditorView.domEventHandlers({
          blur: (event, editorView) => {
            // Check if focus moved to Vim command line panel
            const relatedTarget = event.relatedTarget as HTMLElement | null;
            if (relatedTarget) {
              // Check if the new focus target is within our editor container (e.g., Vim panel)
              const editorRoot = editorView.dom.closest(".card-editor");
              if (editorRoot?.contains(relatedTarget)) {
                return false; // Don't exit edit mode
              }
            }
            // Keep editing on blur - don't auto-save (Twitter-like behavior)
            // User must explicitly save with :w, :wq, or Ctrl+Enter
          },
        }),
      ],
    });

    view = new EditorView({
      state,
      parent: editorContainer,
    });

    // Focus and enter insert mode
    view.focus();
  });

  onDestroy(() => {
    // Auto-save on destroy (when switching to another card)
    // Don't save if explicitly cancelled with :q
    if (view && !cancelled) {
      save();
      onExitEdit?.();
    }
    view?.destroy();
  });
</script>

<div class="card-editor" bind:this={editorContainer}></div>

<style>
  .card-editor {
    min-height: 2em;
    width: 100%;
  }

  .card-editor :global(.cm-editor) {
    height: 100%;
  }

  .card-editor :global(.cm-scroller) {
    min-height: 1.4em;
  }
</style>
