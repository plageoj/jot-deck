<script lang="ts">
  import { filterCommands, type Command } from "$lib/commands";

  interface Props {
    onExecute: (action: string) => void;
    onClose: () => void;
  }

  let { onExecute, onClose }: Props = $props();

  let query = $state("");
  let selectedIndex = $state(0);
  let inputRef = $state<HTMLInputElement | null>(null);
  let lastQuery = $state("");

  let filteredCommands = $derived(filterCommands(query));

  $effect(() => {
    inputRef?.focus();
  });

  // Reset selection when query changes
  $effect(() => {
    if (query !== lastQuery) {
      lastQuery = query;
      selectedIndex = 0;
    }
  });

  function handleKeydown(event: KeyboardEvent) {
    event.stopPropagation();

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        onClose();
        break;
      case "ArrowDown":
        event.preventDefault();
        if (filteredCommands.length > 0) {
          selectedIndex = Math.min(selectedIndex + 1, filteredCommands.length - 1);
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        if (filteredCommands.length > 0) {
          selectedIndex = Math.max(selectedIndex - 1, 0);
        }
        break;
      case "Enter":
        event.preventDefault();
        if (filteredCommands.length > 0) {
          onExecute(filteredCommands[selectedIndex].action);
        }
        break;
    }
  }

  function handleItemClick(command: Command) {
    onExecute(command.action);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="palette-overlay" onkeydown={handleKeydown} onclick={onClose}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="palette-panel" onclick={(e) => e.stopPropagation()}>
    <input
      bind:this={inputRef}
      bind:value={query}
      class="palette-input"
      type="text"
      placeholder="Type a command..."
      spellcheck="false"
      autocomplete="off"
    />
    {#if filteredCommands.length > 0}
      <ul class="palette-list">
        {#each filteredCommands as command, index (command.id)}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <li
            class="palette-item"
            class:selected={index === selectedIndex}
            onclick={() => handleItemClick(command)}
            onmouseenter={() => (selectedIndex = index)}
          >
            <span class="palette-label">{command.label}</span>
            {#if command.shortcut}
              <kbd class="palette-shortcut">{command.shortcut}</kbd>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <div class="palette-empty">No matching commands</div>
    {/if}
  </div>
</div>

<style>
  .palette-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    justify-content: center;
    padding-top: 15vh;
    background-color: rgba(0, 0, 0, 0.5);
  }

  .palette-panel {
    width: 100%;
    max-width: 500px;
    max-height: 400px;
    display: flex;
    flex-direction: column;
    background-color: var(--bg-secondary);
    border: 1px solid var(--bg-tertiary);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    align-self: flex-start;
  }

  .palette-input {
    padding: 0.75rem 1rem;
    border: none;
    border-bottom: 1px solid var(--bg-tertiary);
    background-color: var(--input-bg);
    color: var(--text);
    font-size: 0.9375rem;
    outline: none;
  }

  .palette-input::placeholder {
    color: var(--text-muted);
  }

  .palette-list {
    list-style: none;
    overflow-y: auto;
    padding: 0.25rem 0;
  }

  .palette-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    cursor: pointer;
    transition: background-color 0.1s ease;
  }

  .palette-item.selected {
    background-color: var(--bg-tertiary);
  }

  .palette-label {
    color: var(--text);
    font-size: 0.875rem;
  }

  .palette-shortcut {
    color: var(--text-muted);
    font-size: 0.75rem;
    font-family: inherit;
    padding: 0.125rem 0.5rem;
    background-color: var(--bg-primary);
    border: 1px solid var(--bg-tertiary);
    border-radius: 3px;
  }

  .palette-empty {
    padding: 1rem;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.875rem;
  }
</style>
