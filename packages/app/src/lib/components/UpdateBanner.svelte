<script lang="ts">
  import { updaterStore } from "$lib/updater.svelte";

  const status = $derived(updaterStore.status);

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
</script>

{#if status.kind === "available"}
  <div class="banner" role="status">
    <div class="banner-text">
      <strong>Update available:</strong> v{status.info.version}
      <span class="muted">(current v{status.info.currentVersion})</span>
    </div>
    <div class="banner-actions">
      <button
        type="button"
        class="btn primary"
        onclick={() => updaterStore.installAndRelaunch()}
      >
        Install &amp; restart
      </button>
      <button
        type="button"
        class="btn"
        onclick={() => updaterStore.dismiss()}
        aria-label="Dismiss update notification">Later</button
      >
    </div>
  </div>
{:else if status.kind === "downloading"}
  <div class="banner" role="status">
    <div class="banner-text">
      Downloading update…
      {#if status.contentLength}
        <span class="muted"
          >{formatBytes(status.downloaded)} / {formatBytes(status.contentLength)}</span
        >
      {:else}
        <span class="muted">{formatBytes(status.downloaded)}</span>
      {/if}
    </div>
  </div>
{:else if status.kind === "installing"}
  <div class="banner" role="status">
    <div class="banner-text">Installing update — app will restart…</div>
  </div>
{:else if status.kind === "error"}
  <div class="banner error" role="alert">
    <div class="banner-text">
      <strong>Update failed:</strong>
      {status.message}
    </div>
    <div class="banner-actions">
      <button type="button" class="btn" onclick={() => updaterStore.dismiss()}>
        Dismiss
      </button>
    </div>
  </div>
{/if}

<style>
  .banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 1rem;
    background-color: var(--accent);
    color: #fff;
    font-size: 0.8125rem;
    flex-shrink: 0;
  }

  .banner.error {
    background-color: #b91c1c;
  }

  .banner-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .banner-text .muted {
    opacity: 0.75;
    margin-left: 0.5rem;
  }

  .banner-actions {
    display: flex;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .btn {
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

  .btn.primary {
    background-color: #fff;
    color: var(--accent);
    border-color: #fff;
    font-weight: 600;
  }

  .btn.primary:hover {
    background-color: #f3f3f3;
  }
</style>
