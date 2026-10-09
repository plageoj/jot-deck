<script lang="ts">
  interface Props {
    message: string;
    onDismiss: () => void;
  }

  let { message, onDismiss }: Props = $props();
</script>

<div class="banner" role="alert">
  <div class="banner-text">{message}</div>
  <button
    type="button"
    class="btn"
    onclick={onDismiss}
    aria-label="Dismiss error">Dismiss</button
  >
</div>

<style>
  .banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 1rem;
    background-color: #b91c1c;
    color: #fff;
    font-size: 0.8125rem;
    flex-shrink: 0;
  }

  .banner-text {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .btn {
    flex-shrink: 0;
    padding: 0.25rem 0.625rem;
    border: 1px solid rgba(255, 255, 255, 0.4);
    border-radius: 4px;
    background-color: transparent;
    color: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .btn:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }
</style>
