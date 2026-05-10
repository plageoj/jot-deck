<script lang="ts">
  import { onMount } from "svelte";
  import {
    DEFAULT_SETTINGS,
    FONT_FAMILY_PRESETS,
    FONT_SIZE_MAX,
    FONT_SIZE_MIN,
    LINE_HEIGHT_MAX,
    LINE_HEIGHT_MIN,
    type SettingsState,
    type ThemeMode,
  } from "$lib/settings.svelte";

  interface Props {
    settings: SettingsState;
    onUpdate: <K extends keyof SettingsState>(
      key: K,
      value: SettingsState[K],
    ) => void;
    onReset: () => void;
    onClose: () => void;
  }

  let { settings, onUpdate, onReset, onClose }: Props = $props();

  let dialogRef = $state<HTMLDialogElement | null>(null);

  onMount(() => {
    dialogRef?.showModal();
  });

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === dialogRef) dialogRef?.close();
  }

  function handleKeydown(event: KeyboardEvent) {
    event.stopPropagation();
  }

  function setTheme(value: ThemeMode) {
    onUpdate("theme", value);
  }

  const CUSTOM_FONT_OPTION = "__custom__";

  let savedFontIsCustom = $derived(
    !FONT_FAMILY_PRESETS.some((p) => p.value === settings.fontFamily),
  );

  // User-toggled custom mode. Independent of `savedFontIsCustom` so the
  // dropdown can switch into custom mode (and reveal the text input)
  // before any value has been saved. Mirrors the persisted state when it
  // changes — so a reset (or any external switch back to a preset) also
  // collapses the custom-input UI.
  let customMode = $state(false);

  $effect(() => {
    customMode = savedFontIsCustom;
  });

  let selectedFontOption = $derived(
    customMode ? CUSTOM_FONT_OPTION : settings.fontFamily,
  );

  // Mirror of the current font-family in custom mode. Decoupled from
  // settings.fontFamily so the user can type a partial value without it
  // being applied keystroke by keystroke.
  let customFontDraft = $state("");

  $effect(() => {
    if (savedFontIsCustom) customFontDraft = settings.fontFamily;
  });

  function selectFontFamily(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    if (value === CUSTOM_FONT_OPTION) {
      // Switch to custom: seed the input with the current value so the
      // user can edit. Don't change the applied font yet — that happens
      // on Enter / blur once the user finishes typing.
      customMode = true;
      if (!customFontDraft) customFontDraft = settings.fontFamily;
      return;
    }
    customMode = false;
    onUpdate("fontFamily", value);
  }

  function applyCustomFont() {
    const trimmed = customFontDraft.trim();
    if (!trimmed) return;
    if (trimmed === settings.fontFamily) return;
    onUpdate("fontFamily", trimmed);
  }

  function handleCustomFontKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      applyCustomFont();
    }
  }
</script>

<dialog
  bind:this={dialogRef}
  class="settings-dialog"
  aria-label="Settings"
  onclose={onClose}
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <div class="settings-panel">
    <header class="settings-header">
      <h2>Settings</h2>
      <button
        type="button"
        class="close-btn"
        aria-label="Close settings"
        onclick={() => dialogRef?.close()}>×</button
      >
    </header>

    <div class="settings-body">
      <section class="settings-section">
        <h3>Appearance</h3>

        <div class="row">
          <span class="row-label">Theme</span>
          <div class="segmented" role="radiogroup" aria-label="Theme">
            {#each [
              { value: "auto", label: "Auto" },
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ] as option (option.value)}
              <button
                type="button"
                role="radio"
                aria-checked={settings.theme === option.value}
                class="segmented-btn"
                class:active={settings.theme === option.value}
                onclick={() => setTheme(option.value as ThemeMode)}
              >
                {option.label}
              </button>
            {/each}
          </div>
        </div>

        <div class="row">
          <label class="row-label" for="settings-font-family">Font family</label>
          <select
            id="settings-font-family"
            class="select"
            value={selectedFontOption}
            onchange={selectFontFamily}
          >
            {#each FONT_FAMILY_PRESETS as preset (preset.value)}
              <option value={preset.value}>{preset.label}</option>
            {/each}
            <option value={CUSTOM_FONT_OPTION}>Custom…</option>
          </select>
          {#if customMode}
            <input
              type="text"
              class="text-input"
              spellcheck="false"
              autocomplete="off"
              placeholder='e.g. "JetBrains Mono", monospace'
              bind:value={customFontDraft}
              onblur={applyCustomFont}
              onkeydown={handleCustomFontKeydown}
            />
            <span class="hint"
              >CSS font-family value. Press Enter or click outside to apply.
              The font must be installed locally or loaded via @import.</span
            >
          {/if}
          <span class="hint"
            >Applies to deck content (columns &amp; cards). Header, palettes,
            and dialogs keep the system font.</span
          >
        </div>

        <div class="row">
          <label class="row-label" for="settings-font-size"
            >Font size <span class="value">{settings.fontSize}px</span></label
          >
          <input
            id="settings-font-size"
            type="range"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step="1"
            value={settings.fontSize}
            oninput={(e) =>
              onUpdate(
                "fontSize",
                Number((e.target as HTMLInputElement).value),
              )}
          />
        </div>

        <div class="row">
          <label class="row-label" for="settings-line-height"
            >Line height
            <span class="value">{settings.lineHeight.toFixed(2)}</span></label
          >
          <input
            id="settings-line-height"
            type="range"
            min={LINE_HEIGHT_MIN}
            max={LINE_HEIGHT_MAX}
            step="0.05"
            value={settings.lineHeight}
            oninput={(e) =>
              onUpdate(
                "lineHeight",
                Number((e.target as HTMLInputElement).value),
              )}
          />
        </div>

        <div class="row">
          <label class="row-label checkbox-label" for="settings-markdown">
            <input
              id="settings-markdown"
              type="checkbox"
              checked={settings.markdownEnabled}
              onchange={(e) =>
                onUpdate(
                  "markdownEnabled",
                  (e.target as HTMLInputElement).checked,
                )}
            />
            Render Markdown in view mode
          </label>
        </div>
      </section>

      <section class="settings-section">
        <h3>Editor</h3>

        <div class="row">
          <label class="row-label checkbox-label" for="settings-vim">
            <input
              id="settings-vim"
              type="checkbox"
              checked={settings.vimEnabled}
              onchange={(e) =>
                onUpdate(
                  "vimEnabled",
                  (e.target as HTMLInputElement).checked,
                )}
            />
            Vim mode (CodeMirror)
          </label>
          <span class="hint">Re-enter edit mode for changes to apply.</span>
        </div>
      </section>

      <section class="settings-section">
        <h3>Keybindings</h3>
        <p class="placeholder">
          Customization UI is not yet implemented. Default bindings are
          documented in the cheatsheet (<kbd>?</kbd>).
        </p>
      </section>
    </div>

    <footer class="settings-footer">
      <button type="button" class="btn btn-ghost" onclick={onReset}>
        Reset to defaults
      </button>
      <span class="hint"
        >Defaults: <span class="value">{DEFAULT_SETTINGS.fontSize}px</span> /
        line-height
        <span class="value">{DEFAULT_SETTINGS.lineHeight}</span></span
      >
    </footer>
  </div>
</dialog>

<style>
  .settings-dialog {
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

  .settings-dialog::backdrop {
    background-color: rgba(0, 0, 0, 0.5);
  }

  .settings-panel {
    width: 90vw;
    max-width: 560px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    background-color: var(--bg-secondary);
    border: 1px solid var(--bg-tertiary);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--bg-tertiary);
  }

  .settings-header h2 {
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

  .settings-body {
    padding: 0.75rem 1rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .settings-section h3 {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.5rem;
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0.375rem 0;
  }

  .row-label {
    font-size: 0.8125rem;
    color: var(--text);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .row-label .value {
    color: var(--text-muted);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.5rem;
    cursor: pointer;
  }

  .hint {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .placeholder {
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .placeholder kbd {
    padding: 0 0.375rem;
    background-color: var(--bg-primary);
    border: 1px solid var(--bg-tertiary);
    border-radius: 3px;
    font-family: inherit;
    font-size: 0.75rem;
    color: var(--accent);
  }

  .segmented {
    display: inline-flex;
    border: 1px solid var(--input-border);
    border-radius: 4px;
    overflow: hidden;
    align-self: flex-start;
  }

  .segmented-btn {
    padding: 0.375rem 0.875rem;
    border: none;
    background-color: var(--input-bg);
    color: var(--text-muted);
    font-size: 0.8125rem;
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      color 0.15s ease;
  }

  .segmented-btn + .segmented-btn {
    border-left: 1px solid var(--input-border);
  }

  .segmented-btn:hover {
    background-color: var(--bg-tertiary);
    color: var(--text);
  }

  .segmented-btn.active {
    background-color: var(--accent);
    color: #fff;
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

  input[type="range"] {
    width: 100%;
    accent-color: var(--accent);
  }

  input[type="checkbox"] {
    accent-color: var(--accent);
    width: 1rem;
    height: 1rem;
  }

  .settings-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.625rem 1rem;
    border-top: 1px solid var(--bg-tertiary);
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

  .btn:hover {
    background-color: var(--bg-tertiary);
  }

  .btn-ghost {
    color: var(--text-muted);
  }
</style>
