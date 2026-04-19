<script lang="ts">
  import { onMount } from "svelte";

  interface Props {
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
    onClose: () => void;
  }

  let {
    title,
    message,
    confirmLabel = "Delete",
    onConfirm,
    onClose,
  }: Props = $props();

  let dialogRef = $state<HTMLDialogElement | null>(null);
  let confirmRef = $state<HTMLButtonElement | null>(null);

  onMount(() => {
    dialogRef?.showModal();
    confirmRef?.focus();
  });

  function handleConfirm() {
    dialogRef?.close();
    onConfirm();
  }

  function handleKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      handleConfirm();
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
  class="confirm-dialog"
  aria-label={title}
  onclose={onClose}
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <div class="confirm-panel">
    <h3 class="confirm-title">{title}</h3>
    <p class="confirm-message">{message}</p>
    <div class="confirm-actions">
      <button class="btn btn-cancel" onclick={() => dialogRef?.close()}>
        Cancel
      </button>
      <button
        bind:this={confirmRef}
        class="btn btn-danger"
        onclick={handleConfirm}
      >
        {confirmLabel}
      </button>
    </div>
  </div>
</dialog>

<style>
  .confirm-dialog {
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

  .confirm-dialog::backdrop {
    background-color: rgba(0, 0, 0, 0.5);
  }

  .confirm-panel {
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

  .confirm-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text);
  }

  .confirm-message {
    font-size: 0.875rem;
    color: var(--text-muted);
    line-height: 1.5;
    overflow-wrap: break-word;
  }

  .confirm-actions {
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

  .btn-danger {
    background-color: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .btn-danger:hover {
    background-color: var(--accent-hover);
    border-color: var(--accent-hover);
  }
</style>
