<script lang="ts">
  import type { Card } from "$lib/types";

  interface Props {
    card: Card;
    focused?: boolean;
  }

  let { card, focused = false }: Props = $props();
</script>

<div class="card" class:focused>
  <div class="card-content">
    {card.content || "(empty)"}
  </div>
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
    transition: border-color 0.15s ease;
  }

  .card:hover {
    border-color: var(--card-border-hover, #e94560);
  }

  .card.focused {
    border-color: var(--card-border-focus, #e94560);
    box-shadow: 0 0 0 2px var(--card-focus-ring, rgba(233, 69, 96, 0.3));
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
