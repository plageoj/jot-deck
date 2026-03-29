<script lang="ts">
  import { onMount } from "svelte";
  import { type FocusMode, getKeybindingsForMode } from "$lib/keybindings";

  interface Props {
    mode: FocusMode;
    onClose: () => void;
  }

  let { mode, onClose }: Props = $props();
  let dialogRef = $state<HTMLDialogElement | null>(null);

  let groupedBindings = $derived.by(() => {
    const bindings = getKeybindingsForMode(mode);
    const groups: { sequences: string[]; description: string }[] = [];
    const actionIndex = new Map<string, number>();

    for (const b of bindings) {
      const existing = actionIndex.get(b.action);
      if (existing !== undefined) {
        groups[existing].sequences.push(b.sequence);
      } else {
        actionIndex.set(b.action, groups.length);
        groups.push({ sequences: [b.sequence], description: b.description });
      }
    }
    return groups;
  });

  onMount(() => {
    dialogRef?.showModal();
  });

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === dialogRef) {
      dialogRef?.close();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    event.stopPropagation();
  }

  let modeLabel = $derived(
    mode === "column" ? "Column" : mode === "card" ? "Card" : mode
  );
</script>

<dialog
  bind:this={dialogRef}
  class="cheatsheet-dialog"
  aria-label="Keyboard shortcuts — {modeLabel} mode"
  onclose={onClose}
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <div class="cheatsheet-panel">
    <div class="cheatsheet-header">
      <h2>Keyboard Shortcuts — {modeLabel} Mode</h2>
      <span class="cheatsheet-hint">Press <kbd>Esc</kbd> to close</span>
    </div>
    <div class="cheatsheet-body">
      <dl class="cheatsheet-list">
        {#each groupedBindings as group, index (index)}
          <div class="cheatsheet-item">
            <dt>
              {#each group.sequences as seq, i}
                {#if i > 0}<span class="separator"> / </span>{/if}
                <kbd>{seq}</kbd>
              {/each}
            </dt>
            <dd>{group.description}</dd>
          </div>
        {/each}
      </dl>
    </div>
  </div>
</dialog>

<style>
  .cheatsheet-dialog {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
    border: none;
    background: transparent;
    padding: 0;
    margin: 0;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .cheatsheet-dialog::backdrop {
    background-color: rgba(0, 0, 0, 0.5);
  }

  .cheatsheet-panel {
    width: 90vw;
    max-width: 900px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    background-color: var(--bg-secondary);
    border: 1px solid var(--bg-tertiary);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }

  .cheatsheet-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--bg-tertiary);
  }

  .cheatsheet-header h2 {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text);
  }

  .cheatsheet-hint {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .cheatsheet-hint kbd {
    padding: 0.0625rem 0.375rem;
    background-color: var(--bg-primary);
    border: 1px solid var(--bg-tertiary);
    border-radius: 3px;
    font-family: inherit;
    font-size: 0.75rem;
  }

  .cheatsheet-body {
    overflow-y: auto;
    padding: 0.5rem 1rem;
  }

  .cheatsheet-list {
    columns: 2 250px;
    column-gap: 1.5rem;
  }

  .cheatsheet-item {
    break-inside: avoid;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.25rem 0.375rem;
    border-radius: 4px;
  }

  .cheatsheet-item:hover {
    background-color: var(--bg-tertiary);
  }

  .cheatsheet-item dt {
    flex-shrink: 0;
    width: 10rem;
    text-align: right;
    white-space: nowrap;
  }

  .cheatsheet-item dd {
    font-size: 0.8125rem;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cheatsheet-list kbd {
    display: inline-block;
    min-width: 1.5rem;
    padding: 0.125rem 0.5rem;
    background-color: var(--bg-primary);
    border: 1px solid var(--bg-tertiary);
    border-radius: 3px;
    font-family: inherit;
    font-size: 0.75rem;
    text-align: center;
    color: var(--accent);
  }

  .separator {
    color: var(--text-muted);
    font-size: 0.75rem;
  }
</style>
