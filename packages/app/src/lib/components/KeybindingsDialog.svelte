<script lang="ts">
  import { onMount } from "svelte";
  import { settingsStore } from "$lib/settings.svelte";
  import {
    DEFAULT_KEYBINDINGS,
    findKeybindingConflicts,
    getKnownActions,
    signatureOf,
    type FocusMode,
    type KeybindingConflict,
  } from "$lib/keybindings";
  import { normalizeKey } from "$lib/keyProcessor";

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  let dialogRef = $state<HTMLDialogElement | null>(null);
  onMount(() => dialogRef?.showModal());

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === dialogRef) dialogRef?.close();
  }

  // Stop board shortcuts from reacting to keys typed inside the dialog.
  function handleKeydown(event: KeyboardEvent) {
    event.stopPropagation();
  }

  function autofocus(node: HTMLElement) {
    node.focus();
  }

  // ── Scope helpers ───────────────────────────────────────────────────────
  type Scope = "Column" | "Card" | "Common";
  const SCOPE_ORDER: Scope[] = ["Column", "Card", "Common"];

  function scopeOf(modes: FocusMode[]): Scope {
    const col = modes.includes("column");
    const card = modes.includes("card");
    if (col && card) return "Common";
    if (card) return "Card";
    return "Column";
  }

  function scopeToModes(scope: Scope): FocusMode[] {
    if (scope === "Common") return ["column", "card"];
    if (scope === "Card") return ["card"];
    return ["column"];
  }

  // ── Default-binding list ─────────────────────────────────────────────────
  interface BaseRow {
    signature: string;
    defaultSequence: string;
    modes: FocusMode[];
  }

  interface BindingRow extends BaseRow {
    /** Effective key sequence, or null when the user has disabled it. */
    current: string | null;
    overridden: boolean;
  }

  interface BaseGroup {
    key: string;
    description: string;
    scope: Scope;
    rows: BaseRow[];
  }

  interface ActionGroup extends BaseGroup {
    rows: BindingRow[];
  }

  // The grouping of the defaults (one entry per action+scope, in source order)
  // is static — only the override layer and the filter change. Build it once.
  const baseGroups: BaseGroup[] = (() => {
    const groupIndex = new Map<string, number>();
    const groups: BaseGroup[] = [];
    for (const b of DEFAULT_KEYBINDINGS) {
      const scope = scopeOf(b.modes);
      const row: BaseRow = {
        signature: signatureOf(b),
        defaultSequence: b.sequence,
        modes: b.modes,
      };
      const key = `${scope}|${b.action}`;
      const idx = groupIndex.get(key);
      if (idx === undefined) {
        groupIndex.set(key, groups.length);
        groups.push({ key, description: b.description, scope, rows: [row] });
      } else {
        groups[idx].rows.push(row);
      }
    }
    return groups;
  })();

  let filter = $state("");

  let defaultSections = $derived.by(() => {
    const overrides = settingsStore.state.keybindingOverrides;
    const f = filter.trim().toLowerCase();

    const layered: ActionGroup[] = baseGroups.map((g) => ({
      ...g,
      rows: g.rows.map((r) => {
        const overridden = Object.prototype.hasOwnProperty.call(
          overrides,
          r.signature,
        );
        return {
          ...r,
          overridden,
          current: overridden ? overrides[r.signature] : r.defaultSequence,
        };
      }),
    }));

    const matches = (g: ActionGroup) =>
      !f ||
      g.description.toLowerCase().includes(f) ||
      g.rows.some(
        (r) =>
          (r.current ?? "").toLowerCase().includes(f) ||
          r.defaultSequence.toLowerCase().includes(f),
      );

    return SCOPE_ORDER.map((scope) => ({
      scope,
      groups: layered.filter((g) => g.scope === scope && matches(g)),
    })).filter((s) => s.groups.length > 0);
  });

  let customized = $derived(
    Object.keys(settingsStore.state.keybindingOverrides).length > 0 ||
      settingsStore.state.customKeybindings.length > 0,
  );

  // ── Remap capture (default or custom binding) ────────────────────────────
  type Target =
    | { kind: "default"; signature: string; modes: FocusMode[] }
    | { kind: "custom"; index: number; modes: FocusMode[] };

  let editing = $state<Target | null>(null);
  let pendingSequence = $state("");

  let editingExclude = $derived.by(() => {
    if (!editing) return "";
    if (editing.kind === "default") return editing.signature;
    const cb = settingsStore.state.customKeybindings[editing.index];
    return cb ? signatureOf(cb) : "";
  });

  let editingConflicts = $derived.by(() => {
    if (!editing || !pendingSequence) return [];
    return findKeybindingConflicts(
      pendingSequence,
      editing.modes,
      editingExclude,
      settingsStore.state.keybindingOverrides,
      settingsStore.state.customKeybindings,
    );
  });

  let editingBlocked = $derived(
    editingConflicts.some((c) => c.severity === "error"),
  );

  function startRemapDefault(row: BindingRow) {
    editing = { kind: "default", signature: row.signature, modes: row.modes };
    pendingSequence = "";
  }

  function startRemapCustom(index: number) {
    const cb = settingsStore.state.customKeybindings[index];
    if (!cb) return;
    editing = { kind: "custom", index, modes: cb.modes };
    pendingSequence = "";
  }

  function cancelRemap() {
    editing = null;
    pendingSequence = "";
  }

  function handleRemapKeydown(event: KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      cancelRemap();
      return;
    }
    const token = normalizeKey(event);
    if (token === null) return;
    pendingSequence += token;
  }

  function applyRemap() {
    if (!editing || !pendingSequence || editingBlocked) return;
    if (editing.kind === "default") {
      settingsStore.setKeybindingOverride(editing.signature, pendingSequence);
    } else {
      const cb = settingsStore.state.customKeybindings[editing.index];
      if (cb) {
        settingsStore.updateCustomKeybinding(editing.index, {
          ...cb,
          sequence: pendingSequence,
        });
      }
    }
    cancelRemap();
  }

  function isEditingDefault(sig: string): boolean {
    return editing?.kind === "default" && editing.signature === sig;
  }

  function isEditingCustom(index: number): boolean {
    return editing?.kind === "custom" && editing.index === index;
  }

  function disableDefault(sig: string) {
    settingsStore.setKeybindingOverride(sig, null);
    if (isEditingDefault(sig)) cancelRemap();
  }

  /** Reset every binding in one command (action group) back to its default. */
  function resetGroup(rows: BindingRow[]) {
    const sigs = rows.filter((r) => r.overridden).map((r) => r.signature);
    if (
      editing?.kind === "default" &&
      sigs.includes(editing.signature)
    ) {
      cancelRemap();
    }
    settingsStore.clearKeybindingOverrides(sigs);
  }

  function removeCustom(index: number) {
    if (isEditingCustom(index)) cancelRemap();
    settingsStore.removeCustomKeybinding(index);
  }

  function resetAll() {
    cancelRemap();
    settingsStore.resetAllKeybindings();
  }

  // ── Add a new binding ────────────────────────────────────────────────────
  const knownActions = getKnownActions();

  let addAction = $state(knownActions[0]?.action ?? "");
  let addScope = $state<Scope>("Column");
  let addSequence = $state("");
  let addCapturing = $state(false);

  // Seed the scope from the chosen action's natural scope when the action
  // changes (mount included). A manual scope tweak persists until the next
  // action change.
  $effect(() => {
    const a = knownActions.find((k) => k.action === addAction);
    if (a) addScope = scopeOf(a.modes);
  });

  let addConflicts = $derived.by(() => {
    if (!addSequence) return [];
    return findKeybindingConflicts(
      addSequence,
      scopeToModes(addScope),
      "",
      settingsStore.state.keybindingOverrides,
      settingsStore.state.customKeybindings,
    );
  });

  let addBlocked = $derived(addConflicts.some((c) => c.severity === "error"));

  function startAddCapture() {
    addCapturing = true;
    addSequence = "";
  }

  function handleAddKeydown(event: KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      addCapturing = false;
      return;
    }
    const token = normalizeKey(event);
    if (token === null) return;
    addSequence += token;
  }

  function addBinding() {
    if (!addAction || !addSequence || addBlocked) return;
    const known = knownActions.find((k) => k.action === addAction);
    settingsStore.addCustomKeybinding({
      sequence: addSequence,
      action: addAction,
      modes: scopeToModes(addScope),
      description: known?.description ?? addAction,
    });
    addSequence = "";
    addCapturing = false;
  }
</script>

<!-- The key-capture box: a focusable span that records normalized key tokens. -->
{#snippet captureSpan(
  sequence: string,
  blocked: boolean,
  handler: (e: KeyboardEvent) => void,
)}
  <span
    class="kb-capture"
    class:error={blocked}
    role="textbox"
    tabindex="0"
    aria-label="Press keys to bind"
    use:autofocus
    onkeydown={handler}
  >
    {sequence || "Press keys…"}
  </span>
{/snippet}

<!-- Remap capture: capture box + apply/cancel. Shared by default & custom rows. -->
{#snippet remapCapture()}
  <span class="kb-capture-wrap">
    {@render captureSpan(pendingSequence, editingBlocked, handleRemapKeydown)}
    <button
      type="button"
      class="kb-mini-btn"
      disabled={!pendingSequence || editingBlocked}
      onclick={applyRemap}
      title="Apply">✓</button
    >
    <button type="button" class="kb-mini-btn" onclick={cancelRemap} title="Cancel"
      >×</button
    >
  </span>
{/snippet}

<!-- Conflict messages for a candidate `sequence`. Renders nothing when empty. -->
{#snippet conflictList(list: KeybindingConflict[], sequence: string)}
  {#if list.length > 0}
    <div class="kb-conflicts">
      {#each list as conflict (conflict.severity + conflict.sequence)}
        <span class="kb-conflict {conflict.severity}">
          {#if conflict.severity === "error"}
            <kbd>{sequence}</kbd> already bound to “{conflict.description}”
          {:else}
            overlaps <kbd>{conflict.sequence}</kbd> (“{conflict.description}”)
          {/if}
        </span>
      {/each}
    </div>
  {/if}
{/snippet}

<dialog
  bind:this={dialogRef}
  class="kb-dialog"
  aria-label="Keybindings"
  onclose={onClose}
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <div class="kb-panel">
    <header class="kb-header">
      <h2>Keybindings</h2>
      <div class="kb-header-actions">
        {#if customized}
          <button type="button" class="link-btn" onclick={resetAll}>
            Reset all
          </button>
        {/if}
        <button
          type="button"
          class="close-btn"
          aria-label="Close keybindings"
          onclick={() => dialogRef?.close()}>×</button
        >
      </div>
    </header>

    <div class="kb-body">
      <!-- Add a new binding -->
      <section class="kb-section kb-add">
        <h3>Add binding</h3>
        <div class="kb-add-row">
          <select class="select" bind:value={addAction} aria-label="Action">
            {#each knownActions as a (a.action)}
              <option value={a.action}>{a.description}</option>
            {/each}
          </select>
          <select class="select" bind:value={addScope} aria-label="Scope">
            {#each SCOPE_ORDER as scope (scope)}
              <option value={scope}>{scope}</option>
            {/each}
          </select>
          {#if addCapturing}
            {@render captureSpan(addSequence, addBlocked, handleAddKeydown)}
            <button
              type="button"
              class="kb-mini-btn"
              title="Done recording"
              onclick={() => (addCapturing = false)}>✓</button
            >
          {:else}
            <button type="button" class="kb-key" onclick={startAddCapture}>
              {addSequence || "Set key"}
            </button>
          {/if}
          <button
            type="button"
            class="btn"
            disabled={!addSequence || addBlocked}
            onclick={addBinding}>Add</button
          >
        </div>
        {@render conflictList(addConflicts, addSequence)}
      </section>

      <!-- User-added bindings -->
      {#if settingsStore.state.customKeybindings.length > 0}
        <section class="kb-section">
          <h3>Your bindings</h3>
          {#each settingsStore.state.customKeybindings as cb, index (index)}
            <div class="kb-row">
              <span class="kb-desc">
                {cb.description}
                <span class="kb-scope-tag">{scopeOf(cb.modes)}</span>
              </span>
              <div class="kb-keys">
                {#if isEditingCustom(index)}
                  {@render remapCapture()}
                {:else}
                  <button
                    type="button"
                    class="kb-key"
                    title="Click to remap"
                    onclick={() => startRemapCustom(index)}
                  >
                    {cb.sequence}
                  </button>
                  <button
                    type="button"
                    class="kb-mini-btn subtle"
                    title="Delete this binding"
                    aria-label="Delete binding"
                    onclick={() => removeCustom(index)}>🗑</button
                  >
                {/if}
              </div>
            </div>
            {#if isEditingCustom(index)}
              {@render conflictList(editingConflicts, pendingSequence)}
            {/if}
          {/each}
        </section>
      {/if}

      <!-- Default bindings -->
      <section class="kb-section">
        <h3>Default bindings</h3>
        <span class="hint">
          Click a key to remap it. <kbd>Esc</kbd> cancels recording.
        </span>
        <input
          type="text"
          class="text-input kb-filter"
          spellcheck="false"
          autocomplete="off"
          placeholder="Filter by action or key…"
          bind:value={filter}
          onkeydown={(e) => e.stopPropagation()}
        />

        {#each defaultSections as section (section.scope)}
          <div class="kb-scope">
            <h4 class="kb-scope-title">{section.scope}</h4>
            {#each section.groups as group (group.key)}
              <div class="kb-row">
                <span class="kb-desc">
                  <span class="kb-desc-text">{group.description}</span>
                  {#if group.rows.some((r) => r.overridden)}
                    <button
                      type="button"
                      class="kb-mini-btn subtle"
                      title="Reset this command to defaults"
                      aria-label="Reset command to defaults"
                      onclick={() => resetGroup(group.rows)}>↺</button
                    >
                  {/if}
                </span>
                <div class="kb-keys">
                  {#each group.rows as row (row.signature)}
                    {#if isEditingDefault(row.signature)}
                      {@render remapCapture()}
                    {:else if row.current === null}
                      <button
                        type="button"
                        class="kb-key disabled"
                        title="Disabled — click to remap"
                        onclick={() => startRemapDefault(row)}
                      >
                        disabled
                      </button>
                    {:else}
                      <span class="kb-key-group">
                        <button
                          type="button"
                          class="kb-key"
                          class:overridden={row.overridden}
                          title="Click to remap"
                          onclick={() => startRemapDefault(row)}
                        >
                          {row.current}
                        </button>
                        <button
                          type="button"
                          class="kb-mini-btn subtle"
                          title="Disable this binding"
                          aria-label="Disable binding"
                          onclick={() => disableDefault(row.signature)}
                          >×</button
                        >
                      </span>
                    {/if}
                  {/each}
                </div>
              </div>
              {#if group.rows.some((r) => isEditingDefault(r.signature))}
                {@render conflictList(editingConflicts, pendingSequence)}
              {/if}
            {/each}
          </div>
        {/each}
      </section>
    </div>
  </div>
</dialog>

<style>
  .kb-dialog {
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

  .kb-dialog::backdrop {
    background-color: rgba(0, 0, 0, 0.5);
  }

  .kb-panel {
    width: 90vw;
    max-width: 640px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    background-color: var(--bg-secondary);
    border: 1px solid var(--bg-tertiary);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }

  .kb-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--bg-tertiary);
  }

  .kb-header h2 {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text);
  }

  .kb-header-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .link-btn {
    border: none;
    background: transparent;
    color: var(--accent);
    font-size: 0.75rem;
    cursor: pointer;
    padding: 0;
  }

  .link-btn:hover {
    text-decoration: underline;
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

  .kb-body {
    padding: 0.75rem 1rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .kb-section h3 {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.5rem;
  }

  .kb-add-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .kb-add-row .select {
    flex: 1 1 auto;
    min-width: 8rem;
  }

  .hint {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .hint kbd {
    padding: 0 0.375rem;
    background-color: var(--bg-primary);
    border: 1px solid var(--bg-tertiary);
    border-radius: 3px;
    font-family: inherit;
    font-size: 0.75rem;
    color: var(--accent);
  }

  .select {
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--input-border);
    border-radius: 4px;
    background-color: var(--input-bg);
    color: var(--text);
    font-size: 0.8125rem;
    font-family: inherit;
  }

  .select:focus {
    outline: none;
    border-color: var(--input-border-focus);
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

  .kb-filter {
    width: 100%;
    margin: 0.5rem 0;
  }

  .kb-scope + .kb-scope {
    margin-top: 0.75rem;
  }

  .kb-scope-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 0.25rem;
  }

  .kb-scope-tag {
    margin-left: 0.375rem;
    padding: 0 0.375rem;
    border-radius: 999px;
    background-color: var(--bg-tertiary);
    color: var(--text-muted);
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .kb-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.25rem 0.375rem;
    border-radius: 4px;
    min-height: 1.875rem;
  }

  .kb-row:hover {
    background-color: var(--bg-tertiary);
  }

  .kb-desc {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
    font-size: 0.8125rem;
    color: var(--text);
  }

  .kb-desc-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kb-keys {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .kb-key-group {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
  }

  .kb-key {
    min-width: 1.5rem;
    padding: 0.125rem 0.5rem;
    background-color: var(--bg-primary);
    border: 1px solid var(--bg-tertiary);
    border-radius: 3px;
    font-family: inherit;
    font-size: 0.75rem;
    color: var(--accent);
    cursor: pointer;
  }

  .kb-key:hover {
    border-color: var(--accent);
  }

  .kb-key.overridden {
    border-color: var(--accent);
    border-style: dashed;
  }

  .kb-key.disabled {
    color: var(--text-muted);
    font-style: italic;
  }

  .kb-capture-wrap {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  .kb-capture {
    min-width: 5rem;
    padding: 0.125rem 0.5rem;
    background-color: var(--input-bg);
    border: 1px solid var(--accent);
    border-radius: 3px;
    font-family: inherit;
    font-size: 0.75rem;
    color: var(--text);
    text-align: center;
    cursor: text;
  }

  .kb-capture:focus {
    outline: none;
    box-shadow: 0 0 0 2px var(--accent);
  }

  .kb-capture.error {
    border-color: #e5484d;
    box-shadow: none;
  }

  .kb-mini-btn {
    width: 1.25rem;
    height: 1.25rem;
    padding: 0;
    border: 1px solid var(--input-border);
    border-radius: 3px;
    background-color: var(--input-bg);
    color: var(--text-muted);
    font-size: 0.75rem;
    line-height: 1;
    cursor: pointer;
  }

  .kb-mini-btn:hover:not(:disabled) {
    background-color: var(--bg-tertiary);
    color: var(--text);
  }

  .kb-mini-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .kb-mini-btn.subtle {
    border-color: transparent;
    background: transparent;
  }

  .kb-mini-btn.subtle:hover {
    border-color: var(--input-border);
  }

  .btn {
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--input-border);
    border-radius: 4px;
    font-size: 0.8125rem;
    cursor: pointer;
    background-color: var(--input-bg);
    color: var(--text);
  }

  .btn:hover:not(:disabled) {
    background-color: var(--bg-tertiary);
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .kb-conflicts {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    padding: 0.125rem 0.375rem 0.375rem;
  }

  .kb-conflict {
    font-size: 0.6875rem;
  }

  .kb-conflict.error {
    color: #e5484d;
  }

  .kb-conflict.warn {
    color: var(--text-muted);
  }

  .kb-conflict kbd {
    padding: 0 0.25rem;
    background-color: var(--bg-primary);
    border: 1px solid var(--bg-tertiary);
    border-radius: 3px;
    font-family: inherit;
    font-size: 0.6875rem;
  }
</style>
