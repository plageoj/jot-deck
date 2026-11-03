<script lang="ts">
  import { onMount } from "svelte";

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();
  let dialogRef = $state<HTMLDialogElement | null>(null);

  onMount(() => {
    dialogRef?.showModal();
  });

  function handleKeydown(event: KeyboardEvent) {
    event.stopPropagation();
  }
</script>

<dialog
  bind:this={dialogRef}
  class="touch-notice"
  aria-label="Keyboard-driven app"
  onclose={onClose}
  onkeydown={handleKeydown}
>
  <div class="touch-panel">
    <p>Jot Deck is keyboard-driven. Try it on a desktop browser.</p>
    <button type="button" onclick={() => dialogRef?.close()}>Continue anyway</button>
  </div>
</dialog>

<style>
  .touch-notice {
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

  .touch-notice::backdrop {
    background-color: rgba(0, 0, 0, 0.5);
  }

  .touch-panel {
    width: 85vw;
    max-width: 360px;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.25rem;
    background-color: var(--bg-secondary);
    border: 1px solid var(--bg-tertiary);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    color: var(--text);
    line-height: 1.5;
  }

  .touch-panel button {
    align-self: flex-end;
    padding: 0.5rem 1rem;
    border: 1px solid var(--accent);
    border-radius: 4px;
    background-color: var(--accent);
    color: #fff;
    font-size: 0.875rem;
    cursor: pointer;
  }
</style>
