<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { isTauri } from "#lib/db/index.ts";
  import type { Column, ReporterConfig } from "#lib/types.ts";

  interface Props {
    /** Deck whose Reporters are being managed (007 registrations are per-deck). */
    deckId: string;
    /** The deck's columns, offered as the per-Reporter write allowlist. */
    columns: Column[];
    listReporters: (deckId: string) => Promise<ReporterConfig[]>;
    listRunning: () => Promise<string[]>;
    onAdd: (deckId: string, config: ReporterConfig) => Promise<ReporterConfig>;
    onUpdate: (
      deckId: string,
      config: ReporterConfig,
    ) => Promise<ReporterConfig>;
    onRemove: (deckId: string, reporterId: string) => Promise<void>;
    onStart: (deckId: string, reporterId: string) => Promise<void>;
    onStop: (reporterId: string) => Promise<void>;
    onClose: () => void;
  }

  let {
    deckId,
    columns,
    listReporters,
    listRunning,
    onAdd,
    onUpdate,
    onRemove,
    onStart,
    onStop,
    onClose,
  }: Props = $props();

  let dialogRef = $state<HTMLDialogElement | null>(null);

  let configs = $state<ReporterConfig[]>([]);
  // Ids of Reporters currently running. Plain array (not Set) so reassignment
  // drives Svelte reactivity predictably.
  let running = $state<string[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  // Per-row transient error (spawn failure, stop failure) keyed by reporter_id.
  let rowError = $state<Record<string, string>>({});
  // Ids with an in-flight start/stop, to disable their buttons.
  let busy = $state<string[]>([]);
  // Row awaiting a remove confirmation (inline, avoids a nested <dialog>).
  let confirmRemoveId = $state<string | null>(null);

  // Add/edit form. `editingId` null = adding a new Reporter.
  type FormMode = "closed" | "add" | "edit";
  let formMode = $state<FormMode>("closed");
  let editingId = $state<string | null>(null);
  let draftName = $state("");
  let draftCommand = $state("");
  // args: one per line. env: KEY=VALUE per line.
  let draftArgs = $state("");
  let draftEnv = $state("");
  let formError = $state<string | null>(null);
  // Auth scope (007 §10). `draftDeny` holds the capabilities switched off;
  // `draftMaxWrites` is blank for the host default; the allowlist only applies
  // when `draftRestrictColumns` is on.
  let draftDeny = $state<string[]>([]);
  let draftMaxWrites = $state("");
  let draftRestrictColumns = $state(false);
  let draftColumns = $state<string[]>([]);

  /** Mirrors the host's `DEFAULT_MAX_WRITES_PER_MIN` (crates/reporter-host). */
  const DEFAULT_MAX_WRITES_PER_MIN = 120;

  /** Capabilities a registration can deny, with the methods each one gates. */
  const CAPABILITIES = [
    { name: "append", label: "Append cards" },
    { name: "edit", label: "Edit, move, and stream cards" },
    { name: "delete", label: "Delete cards" },
    { name: "structure", label: "Create, rename, and reorder columns" },
  ] as const;

  let reporterExitUnlisten: (() => void) | null = null;
  // `listen()` is awaited after mount, so the dialog can be closed before the
  // subscription exists. Without this flag the late subscription would outlive
  // the component — open/close cycles would pile up listeners mutating state
  // nobody renders.
  let destroyed = false;

  const isRunning = (id: string) => running.includes(id);

  async function load() {
    loading = true;
    loadError = null;
    try {
      const [list, run] = await Promise.all([
        listReporters(deckId),
        listRunning(),
      ]);
      configs = list;
      running = run;
    } catch (e) {
      loadError = `Failed to load reporters: ${e}`;
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    dialogRef?.showModal();
    await load();
    // A child process ending on its own emits `reporter-exit`; drop its badge.
    if (isTauri()) {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<{ reporter_id: string }>(
        "reporter-exit",
        ({ payload }) => {
          running = running.filter((id) => id !== payload.reporter_id);
        },
      );
      // Closed while we were subscribing: drop it immediately instead of
      // handing it to a component that will never run onDestroy again.
      if (destroyed) unlisten();
      else reporterExitUnlisten = unlisten;
    }
  });

  onDestroy(() => {
    destroyed = true;
    reporterExitUnlisten?.();
    reporterExitUnlisten = null;
  });

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === dialogRef) dialogRef?.close();
  }

  function handleKeydown(event: KeyboardEvent) {
    // Own our input so the board's global keydown handler stays dormant.
    event.stopPropagation();
  }

  function setBusy(id: string, on: boolean) {
    busy = on ? [...busy, id] : busy.filter((b) => b !== id);
  }

  function setRowError(id: string, message: string | null) {
    if (message === null) {
      const { [id]: _drop, ...rest } = rowError;
      rowError = rest;
    } else {
      rowError = { ...rowError, [id]: message };
    }
  }

  async function start(r: ReporterConfig) {
    setRowError(r.reporter_id, null);
    setBusy(r.reporter_id, true);
    try {
      await onStart(deckId, r.reporter_id);
      if (!isRunning(r.reporter_id)) running = [...running, r.reporter_id];
    } catch (e) {
      setRowError(r.reporter_id, `${e}`);
    } finally {
      setBusy(r.reporter_id, false);
    }
  }

  async function stop(r: ReporterConfig) {
    setRowError(r.reporter_id, null);
    setBusy(r.reporter_id, true);
    try {
      await onStop(r.reporter_id);
      running = running.filter((id) => id !== r.reporter_id);
    } catch (e) {
      setRowError(r.reporter_id, `${e}`);
    } finally {
      setBusy(r.reporter_id, false);
    }
  }

  async function confirmRemove(r: ReporterConfig) {
    setRowError(r.reporter_id, null);
    try {
      await onRemove(deckId, r.reporter_id);
      running = running.filter((id) => id !== r.reporter_id);
      confirmRemoveId = null;
      await load();
    } catch (e) {
      setRowError(r.reporter_id, `${e}`);
      confirmRemoveId = null;
    }
  }

  function openAdd() {
    editingId = null;
    draftName = "";
    draftCommand = "";
    draftArgs = "";
    draftEnv = "";
    draftDeny = [];
    draftMaxWrites = "";
    draftRestrictColumns = false;
    draftColumns = [];
    formError = null;
    formMode = "add";
  }

  function openEdit(r: ReporterConfig) {
    editingId = r.reporter_id;
    draftName = r.name;
    draftCommand = r.command;
    draftArgs = r.args.join("\n");
    draftEnv = Object.entries(r.env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    // Normalize like the host (`Capabilities::try_from_deny`) so a stored
    // `"Delete"` still shows — and saves — as denied.
    draftDeny = r.deny
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 0);
    draftMaxWrites =
      r.max_writes_per_min === null ? "" : String(r.max_writes_per_min);
    draftRestrictColumns = r.allowed_columns !== null;
    // Ids of columns no longer in the deck are dropped: the allowlist only ever
    // holds columns the user can see and confirm here.
    draftColumns = (r.allowed_columns ?? []).filter((id) =>
      columns.some((c) => c.id === id),
    );
    formError = null;
    formMode = "edit";
  }

  function closeForm() {
    formMode = "closed";
    formError = null;
  }

  /** Checked = allowed, so unchecking adds the capability to the deny list. */
  function setAllowed(name: string, allowed: boolean) {
    draftDeny = allowed
      ? draftDeny.filter((n) => n !== name)
      : [...draftDeny.filter((n) => n !== name), name];
  }

  function setColumnSelected(id: string, selected: boolean) {
    draftColumns = selected
      ? [...draftColumns.filter((c) => c !== id), id]
      : draftColumns.filter((c) => c !== id);
  }

  /** One-line summary of a registration's auth scope for its list row. */
  function scopeSummary(r: ReporterConfig): string {
    const caps =
      r.deny.length === 0 ? "All capabilities" : `Denied: ${r.deny.join(", ")}`;
    const rate = `${r.max_writes_per_min ?? DEFAULT_MAX_WRITES_PER_MIN} writes/min`;
    let cols = "All columns";
    if (r.allowed_columns !== null) {
      const names = r.allowed_columns.map(
        (id) => columns.find((c) => c.id === id)?.name ?? "(removed column)",
      );
      cols = `Columns: ${names.join(", ")}`;
    }
    return `${caps} · ${rate} · ${cols}`;
  }

  function parseArgs(text: string): string[] {
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  /** Parse `KEY=VALUE` lines into a map; returns an error string if a
   * non-empty line has no `=` or an empty key. */
  function parseEnv(text: string): { env: Record<string, string>; error: string | null } {
    const env: Record<string, string> = {};
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) {
        return { env, error: `Invalid env line (expected KEY=VALUE): ${line}` };
      }
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1);
      if (!key) return { env, error: `Invalid env line (empty key): ${line}` };
      env[key] = value;
    }
    return { env, error: null };
  }

  async function save() {
    const name = draftName.trim();
    const command = draftCommand.trim();
    if (!name) {
      formError = "Name is required.";
      return;
    }
    if (!command) {
      formError = "Command (absolute path to the binary) is required.";
      return;
    }
    const { env, error: envError } = parseEnv(draftEnv);
    if (envError) {
      formError = envError;
      return;
    }
    const rawMax = draftMaxWrites.trim();
    let maxWrites: number | null = null;
    if (rawMax) {
      maxWrites = Number(rawMax);
      if (!Number.isInteger(maxWrites) || maxWrites < 1) {
        formError = "Max writes per minute must be a whole number of at least 1.";
        return;
      }
    }
    if (draftRestrictColumns && draftColumns.length === 0) {
      formError = "Select at least one column, or allow all columns.";
      return;
    }
    const config: ReporterConfig = {
      reporter_id: editingId ?? "",
      name,
      command,
      args: parseArgs(draftArgs),
      env,
      // Canonical (capability / deck column) order regardless of click order.
      // Unrecognized entries are kept, never dropped: the host then rejects the
      // save visibly instead of this form silently widening the grant.
      deny: [
        ...CAPABILITIES.map((c) => c.name).filter((n) => draftDeny.includes(n)),
        ...draftDeny.filter((n) => !CAPABILITIES.some((c) => c.name === n)),
      ],
      max_writes_per_min: maxWrites,
      allowed_columns: draftRestrictColumns
        ? columns.filter((c) => draftColumns.includes(c.id)).map((c) => c.id)
        : null,
    };
    formError = null;
    try {
      if (editingId) {
        await onUpdate(deckId, config);
      } else {
        await onAdd(deckId, config);
      }
      closeForm();
      await load();
    } catch (e) {
      formError = `Failed to save reporter: ${e}`;
    }
  }
</script>

<dialog
  bind:this={dialogRef}
  class="reporters-dialog"
  aria-label="Reporters"
  onclose={onClose}
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <div class="reporters-panel">
    <header class="reporters-header">
      <h2>Reporters</h2>
      <button
        type="button"
        class="close-btn"
        aria-label="Close reporters"
        onclick={() => dialogRef?.close()}>×</button
      >
    </header>

    <div class="reporters-body">
      <p class="hint intro">
        Reporters are local input adapters this deck spawns as child processes
        and streams cards from (transcription, LLM classification, webhooks).
        They never touch the network — only this local deck.
      </p>

      {#if loadError}
        <p class="error-text">{loadError}</p>
      {:else if loading}
        <p class="hint">Loading…</p>
      {:else if configs.length === 0}
        <p class="hint empty">No reporters registered for this deck yet.</p>
      {:else}
        <ul class="reporter-list">
          {#each configs as r (r.reporter_id)}
            <li class="reporter-row">
              <div class="reporter-main">
                <div class="reporter-name-line">
                  <span class="reporter-name">{r.name}</span>
                  <span
                    class="badge"
                    class:running={isRunning(r.reporter_id)}
                    >{isRunning(r.reporter_id) ? "Running" : "Stopped"}</span
                  >
                </div>
                <code class="reporter-command" title={r.command}>{r.command}</code
                >
                <span class="reporter-scope" title={scopeSummary(r)}
                  >{scopeSummary(r)}</span
                >
                {#if rowError[r.reporter_id]}
                  <span class="error-text">{rowError[r.reporter_id]}</span>
                {/if}
              </div>

              {#if confirmRemoveId === r.reporter_id}
                <div class="reporter-actions">
                  <span class="hint confirm-text">Remove?</span>
                  <button
                    type="button"
                    class="btn btn-danger"
                    onclick={() => confirmRemove(r)}>Remove</button
                  >
                  <button
                    type="button"
                    class="btn btn-ghost"
                    onclick={() => (confirmRemoveId = null)}>Cancel</button
                  >
                </div>
              {:else}
                <div class="reporter-actions">
                  {#if isRunning(r.reporter_id)}
                    <button
                      type="button"
                      class="btn"
                      disabled={busy.includes(r.reporter_id)}
                      onclick={() => stop(r)}>Stop</button
                    >
                  {:else}
                    <button
                      type="button"
                      class="btn btn-primary"
                      disabled={busy.includes(r.reporter_id)}
                      onclick={() => start(r)}>Start</button
                    >
                  {/if}
                  <button
                    type="button"
                    class="btn"
                    onclick={() => openEdit(r)}>Edit</button
                  >
                  <button
                    type="button"
                    class="btn btn-ghost"
                    onclick={() => (confirmRemoveId = r.reporter_id)}
                    >Remove</button
                  >
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if formMode === "closed"}
        <button type="button" class="btn add-btn" onclick={openAdd}>
          + Add reporter
        </button>
      {:else}
        <section class="reporter-form">
          <h3>{formMode === "edit" ? "Edit reporter" : "Add reporter"}</h3>

          <div class="field">
            <label for="reporter-name">Name</label>
            <input
              id="reporter-name"
              type="text"
              class="text-input"
              placeholder="e.g. Meeting minutes"
              bind:value={draftName}
            />
          </div>

          <div class="field">
            <label for="reporter-command">Command</label>
            <input
              id="reporter-command"
              type="text"
              class="text-input"
              spellcheck="false"
              autocomplete="off"
              placeholder="Absolute path to the reporter binary"
              bind:value={draftCommand}
            />
            <span class="hint">Full path to an executable this host will spawn.</span
            >
          </div>

          <div class="field">
            <label for="reporter-args">Arguments</label>
            <textarea
              id="reporter-args"
              class="text-input textarea"
              spellcheck="false"
              autocomplete="off"
              rows="2"
              placeholder="One argument per line"
              bind:value={draftArgs}
            ></textarea>
          </div>

          <div class="field">
            <label for="reporter-env">Environment</label>
            <textarea
              id="reporter-env"
              class="text-input textarea"
              spellcheck="false"
              autocomplete="off"
              rows="2"
              placeholder="KEY=VALUE, one per line"
              bind:value={draftEnv}
            ></textarea>
          </div>

          <fieldset class="field scope-group">
            <legend>Permissions</legend>
            {#each CAPABILITIES as cap (cap.name)}
              <label class="check">
                <input
                  type="checkbox"
                  checked={!draftDeny.includes(cap.name)}
                  onchange={(e) => setAllowed(cap.name, e.currentTarget.checked)}
                />
                {cap.label}
              </label>
            {/each}
          </fieldset>

          <div class="field">
            <label for="reporter-max-writes">Max writes per minute</label>
            <input
              id="reporter-max-writes"
              type="text"
              inputmode="numeric"
              class="text-input narrow"
              autocomplete="off"
              placeholder={`Default (${DEFAULT_MAX_WRITES_PER_MIN})`}
              bind:value={draftMaxWrites}
            />
          </div>

          <fieldset class="field scope-group">
            <legend>Writable columns</legend>
            <label class="check">
              <input
                type="radio"
                name="reporter-column-scope"
                checked={!draftRestrictColumns}
                onchange={() => (draftRestrictColumns = false)}
              />
              All columns
            </label>
            <label class="check">
              <input
                type="radio"
                name="reporter-column-scope"
                checked={draftRestrictColumns}
                onchange={() => (draftRestrictColumns = true)}
              />
              Only selected columns
            </label>
            {#if draftRestrictColumns}
              <div class="column-picks">
                {#each columns as col (col.id)}
                  <label class="check" class:disabled={col.private}>
                    <input
                      type="checkbox"
                      disabled={col.private}
                      checked={!col.private && draftColumns.includes(col.id)}
                      onchange={(e) =>
                        setColumnSelected(col.id, e.currentTarget.checked)}
                    />
                    {col.name}{col.private ? " (private)" : ""}
                  </label>
                {:else}
                  <span class="hint">This deck has no columns yet.</span>
                {/each}
              </div>
              <span class="hint"
                >A reporter limited to selected columns cannot create new
                columns.</span
              >
            {/if}
            <span class="hint">Private columns are never readable or writable.</span
            >
          </fieldset>

          {#if formError}
            <p class="error-text">{formError}</p>
          {/if}
          {#if formMode === "edit"}
            <p class="hint">
              Changes apply the next time this reporter is started.
            </p>
          {/if}

          <div class="form-actions">
            <button type="button" class="btn btn-ghost" onclick={closeForm}
              >Cancel</button
            >
            <button type="button" class="btn btn-primary" onclick={save}>
              {formMode === "edit" ? "Save" : "Add"}
            </button>
          </div>
        </section>
      {/if}
    </div>
  </div>
</dialog>

<style>
  .reporters-dialog {
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

  .reporters-dialog::backdrop {
    background-color: rgba(0, 0, 0, 0.5);
  }

  .reporters-panel {
    width: 90vw;
    max-width: 620px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    background-color: var(--bg-secondary);
    border: 1px solid var(--bg-tertiary);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }

  .reporters-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--bg-tertiary);
  }

  .reporters-header h2 {
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

  .reporters-body {
    padding: 0.75rem 1rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .intro {
    margin-bottom: 0.25rem;
  }

  .hint {
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .empty {
    padding: 0.5rem 0;
  }

  .error-text {
    font-size: 0.75rem;
    color: var(--accent);
    overflow-wrap: break-word;
  }

  .reporter-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    list-style: none;
  }

  .reporter-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.5rem 0.625rem;
    border: 1px solid var(--input-border);
    border-radius: 6px;
    background-color: var(--input-bg);
  }

  .reporter-main {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    flex: 1;
  }

  .reporter-name-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .reporter-name {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    flex-shrink: 0;
    padding: 0 0.375rem;
    border-radius: 999px;
    font-size: 0.6875rem;
    background-color: var(--bg-tertiary);
    color: var(--text-muted);
  }

  .badge.running {
    background-color: var(--accent);
    color: #fff;
  }

  .reporter-command {
    font-family: var(--font-mono, monospace);
    font-size: 0.6875rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reporter-actions {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-shrink: 0;
  }

  .confirm-text {
    margin-right: 0.125rem;
  }

  .add-btn {
    align-self: flex-start;
  }

  .reporter-form {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    padding: 0.75rem;
    border: 1px solid var(--input-border);
    border-radius: 6px;
    background-color: var(--bg-primary);
  }

  .reporter-form h3 {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .field label {
    font-size: 0.8125rem;
    color: var(--text);
  }

  .reporter-scope {
    font-size: 0.6875rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scope-group {
    border: none;
    padding: 0;
    margin: 0;
  }

  .scope-group legend {
    font-size: 0.8125rem;
    color: var(--text);
    margin-bottom: 0.25rem;
  }

  .field .check {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .field .check.disabled {
    color: var(--text-muted);
  }

  .column-picks {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding-left: 1.25rem;
    max-height: 8rem;
    overflow-y: auto;
  }

  .text-input.narrow {
    max-width: 10rem;
  }

  .text-input {
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--input-border);
    border-radius: 4px;
    background-color: var(--input-bg);
    color: var(--text);
    font-size: 0.8125rem;
    font-family: inherit;
  }

  .text-input:focus {
    outline: none;
    border-color: var(--input-border-focus);
  }

  .textarea {
    resize: vertical;
    min-height: 2.25rem;
    font-family: var(--font-mono, monospace);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }

  .btn {
    padding: 0.3125rem 0.625rem;
    border: 1px solid var(--input-border);
    border-radius: 4px;
    font-size: 0.75rem;
    cursor: pointer;
    background-color: var(--input-bg);
    color: var(--text);
  }

  .btn:hover:not(:disabled) {
    background-color: var(--bg-tertiary);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .btn-primary {
    background-color: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .btn-primary:hover:not(:disabled) {
    background-color: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  .btn-ghost {
    color: var(--text-muted);
  }

  .btn-danger {
    background-color: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .btn-danger:hover:not(:disabled) {
    background-color: var(--accent-hover);
    border-color: var(--accent-hover);
  }
</style>
