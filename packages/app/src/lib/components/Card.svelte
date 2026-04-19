<script lang="ts">
  import type { Card } from "$lib/types";
  import CardEditor from "./CardEditor.svelte";
  import TagHighlight from "./TagHighlight.svelte";

  interface Props {
    card: Card;
    focused?: boolean;
    editing?: boolean;
    dimmed?: boolean;
    activeTag?: string | null;
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
    onSave,
    onCancelEdit,
    onStartEdit,
    onExitEdit,
    onFocusCard,
    onTagClick,
    onTagSuggestions,
  }: Props = $props();

  function handleSave(content: string) {
    onSave?.(content);
  }

  function handleCancel() {
    onCancelEdit?.();
  }

  function handleClick() {
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
  class:editing
  class:dimmed
  role="button"
  tabindex={focused ? 0 : -1}
  onclick={handleClick}
  onkeydown={() => {}}
>
  {#if editing}
    <CardEditor
      content={card.content}
      onSave={handleSave}
      onCancel={handleCancel}
      {onExitEdit}
      {onTagSuggestions}
    />
  {:else}
    <div class="card-content">
      {#if card.content}
        <TagHighlight content={card.content} {activeTag} {onTagClick} />
      {:else}
        (empty)
      {/if}
    </div>
  {/if}
  {#if card.score !== 0}
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
