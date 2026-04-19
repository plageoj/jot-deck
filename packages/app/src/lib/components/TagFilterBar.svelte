<script lang="ts">
  interface Props {
    tagName: string;
    onClear: () => void;
  }

  let { tagName, onClear }: Props = $props();
</script>

<div class="tag-filter-bar">
  <span class="filter-label">Filtered by</span>
  <span class="filter-tag">#{tagName}</span>
  <button class="filter-clear" onclick={onClear} title="Clear filter (Escape)">
    &times;
  </button>
  <span class="filter-hint">Press Escape to clear</span>
</div>

<style>
  .tag-filter-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 1rem;
    background-color: var(--bg-secondary, #16213e);
    border-bottom: 1px solid var(--header-border, #0f3460);
    font-size: 0.8125rem;
    flex-shrink: 0;
  }

  .filter-label {
    color: var(--text-muted, #8892b0);
  }

  .filter-tag {
    color: var(--tag-color, #6cb4ee);
    background-color: var(--tag-bg, rgba(108, 180, 238, 0.1));
    padding: 0.125rem 0.5rem;
    border-radius: 4px;
    font-weight: 500;
  }

  .filter-clear {
    all: unset;
    cursor: pointer;
    color: var(--text-muted, #8892b0);
    font-size: 1rem;
    line-height: 1;
    padding: 0 0.25rem;
    border-radius: 3px;
    transition: color 0.15s ease;
  }

  .filter-clear:hover {
    color: var(--text, #e0e0e0);
  }

  .filter-hint {
    color: var(--text-muted, #8892b0);
    opacity: 0.6;
    font-size: 0.75rem;
    margin-left: auto;
  }
</style>
