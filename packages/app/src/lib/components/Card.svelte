<script lang="ts">
  import type { Card, EditEntry } from "#lib/types.ts";
  import type { EditSession } from "#lib/deckData.svelte.ts";
  import { linkHintLabels, openExternalUrl, type LinkHints } from "#lib/externalLinks.ts";
  import { settingsStore } from "#lib/settings.svelte.ts";
  import CardEditor from "./CardEditor.svelte";
  import MarkdownContent from "./MarkdownContent.svelte";
  import TagHighlight from "./TagHighlight.svelte";

  interface Props {
    card: Card;
    focused?: boolean;
    editing?: boolean;
    editSession?: EditSession | null;
    editEntry?: EditEntry;
    dimmed?: boolean;
    activeTag?: string | null;
    /** In-progress streamed text from a Reporter (007 §6.2). When non-null the
     * card is read-only and shows an "AI generating" affordance; the streamed
     * text is displayed instead of the committed content. */
    streamingText?: string | null;
    /** Numbered links offered by link hint mode; `null` when not picking. */
    linkHints?: LinkHints | null;
    onSave?: (
      session: EditSession,
      content: string,
      release: boolean,
      cursor: number,
    ) => Promise<boolean>;
    onCancelEdit?: (session: EditSession) => Promise<boolean>;
    onStartEdit?: () => void;
    onExitEdit?: (session: EditSession) => void;
    onRegisterExit?: (
      session: EditSession,
      exit: (() => Promise<boolean>) | null,
    ) => void;
    onFocusCard?: () => void;
    onTagClick?: (tagName: string) => void;
    onTagSuggestions?: (prefix: string) => Promise<{ name: string }[]>;
  }

  let {
    card,
    focused = false,
    editing = false,
    editSession = null,
    editEntry = "start",
    dimmed = false,
    activeTag = null,
    streamingText = null,
    linkHints = null,
    onSave,
    onCancelEdit,
    onStartEdit,
    onExitEdit,
    onRegisterExit,
    onFocusCard,
    onTagClick,
    onTagSuggestions,
  }: Props = $props();

  // A card receiving a stream is read-only: never mount the editor, and show
  // the streamed text instead of the committed content (007 §7 / §8).
  let streaming = $derived(streamingText !== null && streamingText !== undefined);
  let displayContent = $derived(streaming ? (streamingText ?? "") : card.content);

  async function handleSave(
    session: EditSession,
    content: string,
    release: boolean,
    cursor: number,
  ): Promise<boolean> {
    return (await onSave?.(session, content, release, cursor)) ?? false;
  }

  async function handleCancel(session: EditSession): Promise<boolean> {
    return (await onCancelEdit?.(session)) ?? false;
  }

  function handleExit(session: EditSession) {
    onExitEdit?.(session);
  }

  let hintLabels = $derived(linkHints ? linkHintLabels(linkHints.links.length) : []);

  function handleHintClick(e: MouseEvent, url: string) {
    e.stopPropagation();
    // Re-focusing the card dismisses the hints, as picking one by key does.
    onFocusCard?.();
    void openExternalUrl(url).catch(() => {});
  }

  function handleClick() {
    // A streaming card is read-only — focus it but don't enter edit mode.
    if (streaming) {
      onFocusCard?.();
      return;
    }
    if (!editing) {
      // Focus the card first, then start editing
      onFocusCard?.();
      onStartEdit?.();
    }
  }
</script>

<div
  class="card"
  class:focused
  class:editing={editing && !streaming}
  class:dimmed
  class:streaming
  role="button"
  tabindex={focused ? 0 : -1}
  onclick={handleClick}
  onkeydown={() => {}}
>
  <!-- Badges come first so they float and the content wraps around them. -->
  {#if streaming}
    <span class="card-streaming" title="A Reporter is generating this card">◍ AI generating</span>
  {:else if card.score !== 0}
    <span class="card-score">{card.score}</span>
  {/if}
  {#if editing && !streaming && editSession}
    {@const session = editSession}
    <CardEditor
      content={card.content}
      entry={editEntry}
      onSave={(content, release, cursor) => handleSave(session, content, release, cursor)}
      onCancel={() => handleCancel(session)}
      onExitEdit={() => handleExit(session)}
      onRegisterExit={(exit) => onRegisterExit?.(session, exit)}
      {onTagSuggestions}
    />
  {:else}
    <div class="card-content" class:markdown={settingsStore.state.markdownEnabled}>
      {#if displayContent}
        {#if settingsStore.state.markdownEnabled}
          <MarkdownContent
            content={displayContent}
            {activeTag}
            {onTagClick}
          />
        {:else}
          <TagHighlight content={displayContent} {activeTag} {onTagClick} />
        {/if}
      {:else if streaming}
        <span class="stream-placeholder">…</span>
      {:else}
        (empty)
      {/if}
    </div>
    {#if linkHints && linkHints.links.length > 0}
      {@const typed = linkHints.typed}
      <ol class="link-hints" aria-label="Type a number to open a link">
        {#each linkHints.links as { url, label }, i (url)}
          {@const hintLabel = hintLabels[i]}
          {@const matches = hintLabel.startsWith(typed)}
          <li class:link-hint-excluded={!matches}>
            <button type="button" onclick={(e) => handleHintClick(e, url)}>
              <kbd
                >{#if typed && matches}<span class="link-hint-typed">{typed}</span
                  >{hintLabel.slice(typed.length)}{:else}{hintLabel}{/if}</kbd
              >{#if label}<span class="link-hint-label">{label}</span>{/if}<span
                class="link-hint-url">{url}</span
              >
            </button>
          </li>
        {/each}
      </ol>
    {/if}
  {/if}
</div>

<style>
  .card {
    padding: 0.75rem;
    background-color: var(--card-bg, #1a1a2e);
    border: 1px solid var(--card-border, #0f3460);
    border-radius: 6px;
    font-size: 1rem;
    line-height: var(--app-line-height, 1.5);
    position: relative;
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      opacity 0.15s ease;
    outline: none;
  }

  .card:hover {
    border-color: var(--card-border-hover, #e94560);
  }

  .card.focused {
    border-color: var(--card-border-focus, #e94560);
    box-shadow: 0 0 0 2px var(--card-focus-ring, rgba(233, 69, 96, 0.3));
  }

  .card.editing {
    cursor: text;
    box-shadow: 0 0 0 2px var(--card-focus-ring, rgba(233, 69, 96, 0.3));
  }

  .card.dimmed {
    opacity: 0.25;
  }

  .card.streaming {
    cursor: default;
    box-shadow: 0 0 0 2px var(--card-streaming-ring, rgba(96, 165, 250, 0.45));
  }

  .card-streaming {
    float: right;
    margin: -0.5rem -0.5rem 0 0.5rem;
    padding: 0.125rem 0.375rem;
    background-color: var(--card-streaming-badge, #2563eb);
    border-radius: 10px;
    font-size: 0.875rem;
    font-weight: 500;
    color: #fff;
    white-space: nowrap;
  }

  .stream-placeholder {
    opacity: 0.5;
  }

  .card-content {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .link-hints {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0.5rem 0 0;
    border-top: 1px solid var(--card-border, #0f3460);
    font-size: 0.875rem;
  }

  .link-hints button {
    all: unset;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    width: 100%;
    box-sizing: border-box;
    padding: 0.125rem 0;
    cursor: pointer;
    color: var(--accent);
  }

  .link-hints button:hover .link-hint-url {
    text-decoration: underline;
  }

  .link-hints kbd {
    flex: none;
    min-width: 1.25em;
    padding: 0 0.25em;
    border: 1px solid var(--bg-tertiary);
    border-radius: 3px;
    background-color: var(--bg-primary);
    color: var(--text);
    font-family: "Cascadia Code", "Consolas", "Menlo", monospace;
    text-align: center;
  }

  .link-hint-typed {
    opacity: 0.55;
  }

  .link-hint-excluded {
    opacity: 0.35;
  }

  /* Keep the URL visible next to a long label. */
  .link-hint-label {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }

  .link-hint-url {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-score {
    float: right;
    margin: -0.5rem -0.5rem 0 0.5rem;
    padding: 0.125rem 0.375rem;
    background-color: var(--accent, #e94560);
    border-radius: 10px;
    font-size: 0.875rem;
    font-weight: 500;
  }

  /* The editor is its own formatting context and would shrink beside a
     float, so overlay the badge while editing instead. */
  .card.editing .card-score {
    position: absolute;
    top: 0.25rem;
    right: 0.25rem;
    z-index: 1;
    margin: 0;
  }
</style>
