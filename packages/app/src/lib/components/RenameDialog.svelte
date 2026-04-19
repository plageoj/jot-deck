<script lang="ts">
  import { onMount } from "svelte";

  interface Props {
    title: string;
    value: string;
    onConfirm: (newValue: string) => void;
    onClose: () => void;
  }

  let { title, value, onConfirm, onClose }: Props = $props();

  let inputValue = $state("");
  let inputRef = $state<HTMLInputElement | null>(null);
  let dialogRef = $state<HTMLDialogElement | null>(null);

  onMount(() => {
    inputValue = value;
    dialogRef?.showModal();
    inputRef?.focus();
    inputRef?.select();
  });

  function handleSubmit() {
    const trimmed = inputValue.trim();
    if (trimmed && trimmed !== value) {
      onConfirm(trimmed);
    } else {
      onClose();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      handleSubmit();
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === dialogRef) {
      dialogRef?.close();
    }
  }
</script>

<dialog
  bind:this={dialogRef}
  class="rename-dialog"
  aria-label={title}
  onclose={onClose}
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <div class="rename-panel">
    <h3 class="rename-title">{title}</h3>
    <input
      bind:this={inputRef}
      bind:value={inputValue}
      class="rename-input"
      type="text"
      spellcheck="false"
      autocomplete="off"
    />
    <div class="rename-actions">
      <button class="btn btn-cancel" onclick={() => dialogRef?.close()}>
        Cancel
      </button>
      <button
        class="btn btn-confirm"
        onclick={handleSubmit}
        disabled={!inputValue.trim() || inputValue.trim() === value}
      >
        Rename
      </button>
    </div>
  </div>
</dialog>

<style>
  .rename-dialog {
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
    padding-top: 15vh;
  }

  .rename-dialog::backdrop {
    background-color: rgba(0, 0, 0, 0.5);
  }

  .rename-panel {
    width: 100%;
    max-width: 400px;
    display: flex;
    flex-direction: column;
    background-color: var(--bg-secondary);
    border: 1px solid var(--bg-tertiary);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    align-self: flex-start;
    padding: 1rem;
    gap: 0.75rem;
  }

  .rename-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text);
  }

  .rename-input {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--input-border);
    border-radius: 4px;
    background-color: var(--input-bg);
    color: var(--text);
    font-size: 0.875rem;
    outline: none;
    transition: border-color 0.15s ease;
  }

  .rename-input:focus {
    border-color: var(--input-border-focus);
  }

  .rename-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .btn {
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--input-border);
    border-radius: 4px;
    font-size: 0.8125rem;
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      border-color 0.15s ease;
  }

  .btn-cancel {
    background-color: var(--input-bg);
    color: var(--text-muted);
  }

  .btn-cancel:hover {
    background-color: var(--bg-tertiary);
    color: var(--text);
  }

  .btn-confirm {
    background-color: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .btn-confirm:hover:not(:disabled) {
    background-color: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  .btn-confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
