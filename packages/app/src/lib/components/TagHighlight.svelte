<script lang="ts">
  import { TAG_PATTERN } from "$lib/types";


  interface Props {
    content: string;
    activeTag?: string | null;
    onTagClick?: (tagName: string) => void;
  }

  let { content, activeTag = null, onTagClick }: Props = $props();

  interface Segment {
    text: string;
    isTag: boolean;
    tagName: string;
  }

  let segments = $derived.by(() => {
    const result: Segment[] = [];
    let lastIndex = 0;
    const re = new RegExp(TAG_PATTERN, "g");
    let match;

    while ((match = re.exec(content)) !== null) {
      if (match.index > lastIndex) {
        result.push({
          text: content.slice(lastIndex, match.index),
          isTag: false,
          tagName: "",
        });
      }
      result.push({
        text: match[0],
        isTag: true,
        tagName: match[1],
      });
      lastIndex = re.lastIndex;
    }

    if (lastIndex < content.length) {
      result.push({
        text: content.slice(lastIndex),
        isTag: false,
        tagName: "",
      });
    }

    return result;
  });

  function handleTagClick(e: MouseEvent, tagName: string) {
    e.stopPropagation();
    onTagClick?.(tagName);
  }
</script>

{#each segments as segment}
  {#if segment.isTag}
    <button
      class="tag"
      class:tag-active={activeTag === segment.tagName}
      onclick={(e) => handleTagClick(e, segment.tagName)}
    >{segment.text}</button>
  {:else}{segment.text}{/if}
{/each}

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

  .tag-active {
    color: var(--tag-active-color, #fff);
    background-color: var(--tag-active-bg, rgba(108, 180, 238, 0.4));
  }
</style>
