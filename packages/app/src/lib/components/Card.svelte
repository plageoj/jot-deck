<script lang="ts">
  import type { Card } from "$lib/types";
  import { settingsStore } from "$lib/settings.svelte";
  import CardEditor from "./CardEditor.svelte";
  import MarkdownContent from "./MarkdownContent.svelte";
  import TagHighlight from "./TagHighlight.svelte";

  interface Props {
    card: Card;
    focused?: boolean;
    editing?: boolean;
    dimmed?: boolean;
    activeTag?: string | null;
    /** In-progress streamed text from a Reporter (007 §6.2). When non-null the
     * card is read-only and shows an "AI generating" affordance; the streamed
     * text is displayed instead of the committed content. */
    streamingText?: string | null;
    onSave?: (content: string) => void;
    onCancelEdit?: () => void;
    onStartEdit?: () => void;
    onExitEdit?: () => void;
    onFocusCard?: () => void;
    onTagClick?: (tagName: string) => void;
    onTagSuggestions?: (prefix: string) => Promise<{ name: string }[]>;
  }

  let {
    card,
    focused = false,
    editing = false,
    dimmed = false,
    activeTag = null,
    streamingText = null,
    onSave,
    onCancelEdit,
    onStartEdit,
    onExitEdit,
    onFocusCard,
    onTagClick,
    onTagSuggestions,
  }: Props = $props();

  // A card receiving a stream is read-only: never mount the editor, and show
  // the streamed text instead of the committed content (007 §7 / §8).
  let streaming = $derived(streamingText !== null && streamingText !== undefined);
  let displayContent = $derived(streaming ? (streamingText ?? "") : card.content);

  function handleSave(content: string) {
    onSave?.(content);
  }

  function handleCancel() {
    onCancelEdit?.();
  }

  function handleClick() {
    // A streaming card is read-only — focus it but don't enter edit mode.
    if (streaming) {
      onFocusCard?.();
      return;
    }
    if (!editing) {
      // Focus the card first, then start editing
      onFocusCard?.();
      onStartEdit?.();
    }
  }
</script>

<div
  class="card"
  class:focused
  class:editing={editing && !streaming}
  class:dimmed
  class:streaming
  role="button"
  tabindex={focused ? 0 : -1}
  onclick={handleClick}
  onkeydown={() => {}}
>
  {#if editing && !streaming}
    <CardEditor
      content={card.content}
      onSave={handleSave}
      onCancel={handleCancel}
      {onExitEdit}
      {onTagSuggestions}
    />
  {:else}
    <div class="card-content" class:markdown={settingsStore.state.markdownEnabled}>
      {#if displayContent}
        {#if settingsStore.state.markdownEnabled}
          <MarkdownContent
            content={displayContent}
            {activeTag}
            {onTagClick}
          />
        {:else}
          <TagHighlight content={displayContent} {activeTag} {onTagClick} />
        {/if}
      {:else if streaming}
        <span class="stream-placeholder">…</span>
      {:else}
        (empty)
      {/if}
    </div>
  {/if}
  {#if streaming}
    <span class="card-streaming" title="A Reporter is generating this card">◍ AI generating</span>
  {:else if card.score !== 0}
    <span class="card-score">{card.score}</span>
  {/if}
</div>

<style>
  .card {
    padding: 0.75rem;
    background-color: var(--card-bg, #1a1a2e);
    border: 1px solid var(--card-border, #0f3460);
    border-radius: 6px;
    font-size: 0.875rem;
    line-height: 1.4;
    position: relative;
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      opacity 0.15s ease;
    outline: none;
  }

  .card:hover {
    border-color: var(--card-border-hover, #e94560);
  }

  .card.focused {
    border-color: var(--card-border-focus, #e94560);
    box-shadow: 0 0 0 2px var(--card-focus-ring, rgba(233, 69, 96, 0.3));
  }

  .card.editing {
    cursor: text;
    box-shadow: 0 0 0 2px var(--card-focus-ring, rgba(233, 69, 96, 0.3));
  }

  .card.dimmed {
    opacity: 0.25;
  }

  .card.streaming {
    cursor: default;
    box-shadow: 0 0 0 2px var(--card-streaming-ring, rgba(96, 165, 250, 0.45));
  }

  .card-streaming {
    position: absolute;
    top: 0.25rem;
    right: 0.25rem;
    padding: 0.125rem 0.375rem;
    background-color: var(--card-streaming-badge, #2563eb);
    border-radius: 10px;
    font-size: 0.7rem;
    font-weight: 500;
    color: #fff;
    white-space: nowrap;
  }

  .stream-placeholder {
    opacity: 0.5;
  }

  .card-content {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .card-score {
    position: absolute;
    top: 0.25rem;
    right: 0.25rem;
    padding: 0.125rem 0.375rem;
    background-color: var(--accent, #e94560);
    border-radius: 10px;
    font-size: 0.75rem;
    font-weight: 500;
  }
</style>
