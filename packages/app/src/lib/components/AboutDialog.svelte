<script lang="ts">
  import { onMount } from "svelte";
  import { updaterStore } from "$lib/updater.svelte";

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  let dialogRef = $state<HTMLDialogElement | null>(null);

  // Runtime app info. Only available inside the Tauri shell; the web/dev
  // build has no native version, so we show a placeholder there.
  let appName = $state("Jot Deck");
  let appVersion = $state<string | null>(null);
  let tauriVersion = $state<string | null>(null);

  const isTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in globalThis;

  const status = $derived(updaterStore.status);
  const checkBusy = $derived(
    status.kind === "checking" ||
      status.kind === "downloading" ||
      status.kind === "installing",
  );

  onMount(() => {
    dialogRef?.showModal();
    if (isTauri) {
      void loadAppInfo();
    }
  });

  async function loadAppInfo() {
    try {
      const { getName, getVersion, getTauriVersion } = await import(
        "@tauri-apps/api/app"
      );
      const [name, version, tauri] = await Promise.all([
        getName(),
        getVersion(),
        getTauriVersion(),
      ]);
      appName = name;
      appVersion = version;
      tauriVersion = tauri;
    } catch {
      // Leave placeholders — version display is best-effort.
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === dialogRef) dialogRef?.close();
  }

  function handleKeydown(event: KeyboardEvent) {
    event.stopPropagation();
  }
</script>

<dialog
  bind:this={dialogRef}
  class="about-dialog"
  aria-label="About Jot Deck"
  onclose={onClose}
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <div class="about-panel">
    <header class="about-header">
      <h2>About {appName}</h2>
      <button
        type="button"
        class="close-btn"
        aria-label="Close about"
        onclick={() => dialogRef?.close()}>×</button
      >
    </header>

    <div class="about-body">
      <dl class="info">
        <dt>Version</dt>
        <dd>{appVersion ?? (isTauri ? "…" : "dev build")}</dd>
        {#if tauriVersion}
          <dt>Tauri</dt>
          <dd>{tauriVersion}</dd>
        {/if}
      </dl>

      <section class="updates">
        <div class="updates-row">
          <button
            type="button"
            class="btn primary"
            disabled={!isTauri || checkBusy}
            onclick={() => updaterStore.check()}
          >
            {status.kind === "checking" ? "Checking…" : "Check for Updates"}
          </button>
          {#if !isTauri}
            <span class="hint">Updates are available in the desktop app.</span>
          {/if}
        </div>

        {#if status.kind === "up-to-date"}
          <p class="status-line ok" role="status">
            You're on the latest version.
          </p>
        {:else if status.kind === "available"}
          <div class="status-line available" role="status">
            <span>
              <strong>Update available:</strong> v{status.info.version}
              <span class="muted">(current v{status.info.currentVersion})</span>
            </span>
            <button
              type="button"
              class="btn primary"
              onclick={() => updaterStore.installAndRelaunch()}
            >
              Install &amp; restart
            </button>
          </div>
        {:else if status.kind === "downloading"}
          <p class="status-line" role="status">
            Downloading update…
            {#if status.contentLength}
              <span class="muted"
                >{formatBytes(status.downloaded)} / {formatBytes(
                  status.contentLength,
                )}</span
              >
            {:else}
              <span class="muted">{formatBytes(status.downloaded)}</span>
            {/if}
          </p>
        {:else if status.kind === "installing"}
          <p class="status-line" role="status">
            Installing update — app will restart…
          </p>
        {:else if status.kind === "error"}
          <p class="status-line error" role="alert">
            <strong>Update check failed:</strong>
            {status.message}
          </p>
        {/if}
      </section>
    </div>
  </div>
</dialog>

<style>
  .about-dialog {
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

  .about-dialog::backdrop {
    background-color: rgba(0, 0, 0, 0.5);
  }

  .about-panel {
    width: 90vw;
    max-width: 420px;
    display: flex;
    flex-direction: column;
    background-color: var(--bg-secondary);
    border: 1px solid var(--bg-tertiary);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }

  .about-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--bg-tertiary);
  }

  .about-header h2 {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text);
  }

  .close-btn {
    width: 1.75rem;
    height: 1.75rem;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 1.25rem;
    cursor: pointer;
    border-radius: 4px;
  }

  .close-btn:hover {
    background-color: var(--bg-tertiary);
    color: var(--text);
  }

  .about-body {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .info {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.375rem 1rem;
    margin: 0;
  }

  .info dt {
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .info dd {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  .updates {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--bg-tertiary);
  }

  .updates-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .status-line {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text);
  }

  .status-line.available {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .status-line.ok {
    color: var(--text-muted);
  }

  .status-line.error {
    color: #f87171;
  }

  .status-line .muted {
    color: var(--text-muted);
    margin-left: 0.25rem;
  }

  .hint {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .btn {
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--input-border);
    border-radius: 4px;
    font-size: 0.8125rem;
    cursor: pointer;
    background-color: var(--input-bg);
    color: var(--text);
    flex-shrink: 0;
  }

  .btn:hover:not(:disabled) {
    background-color: var(--bg-tertiary);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .btn.primary {
    background-color: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }

  .btn.primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }
</style>
