<script lang="ts">
  import { parseInlineMarkdown, type MarkdownSegment } from "$lib/markdown";

  interface Props {
    content: string;
    activeTag?: string | null;
    onTagClick?: (tagName: string) => void;
  }

  let { content, activeTag = null, onTagClick }: Props = $props();

  let segments = $derived(parseInlineMarkdown(content));

  function handleTagClick(e: MouseEvent, tagName: string) {
    e.stopPropagation();
    onTagClick?.(tagName);
  }

  function handleLinkClick(e: MouseEvent) {
    e.stopPropagation();
  }
</script>

{#snippet renderSegments(segs: MarkdownSegment[])}
  {#each segs as segment, i (i)}
    {#if segment.kind === "text"}{segment.text}{:else if segment.kind === "bold"}<strong
        >{@render renderSegments(segment.children)}</strong
      >{:else if segment.kind === "italic"}<em
        >{@render renderSegments(segment.children)}</em
      >{:else if segment.kind === "code"}<code>{segment.text}</code
      >{:else if segment.kind === "link"}<a
        class="md-link"
        href={segment.href}
        target="_blank"
        rel="noopener noreferrer"
        onclick={handleLinkClick}
        >{@render renderSegments(segment.children)}</a
      >{:else if segment.kind === "tag"}<button
        type="button"
        class="tag"
        class:tag-active={activeTag === segment.tagName}
        onclick={(e) => handleTagClick(e, segment.tagName)}
        >{segment.text}</button
      >{/if}
  {/each}
{/snippet}

{@render renderSegments(segments)}

<style>
  .tag {
    all: unset;
    color: var(--tag-color, #6cb4ee);
    background-color: var(--tag-bg, rgba(108, 180, 238, 0.1));
    border-radius: 3px;
    padding: 0 2px;
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      color 0.15s ease;
  }

  .tag:hover {
    background-color: var(--tag-bg-hover, rgba(108, 180, 238, 0.25));
  }

  .tag:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .tag-active {
    color: var(--tag-active-color, #fff);
    background-color: var(--tag-active-bg, rgba(108, 180, 238, 0.4));
  }

  code {
    font-family: "Cascadia Code", "Consolas", "Menlo", monospace;
    font-size: 0.875em;
    padding: 0 0.25em;
    border-radius: 3px;
    background-color: var(--bg-tertiary);
    color: var(--text);
  }

  .md-link {
    color: var(--accent);
    text-decoration: underline;
  }

  .md-link:hover {
    color: var(--accent-hover);
  }

  strong {
    font-weight: 600;
  }
</style>
