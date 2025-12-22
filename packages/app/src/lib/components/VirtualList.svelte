<script lang="ts" generics="T">
  import { onMount, tick } from "svelte";

  interface Props {
    items: T[];
    itemHeight: number;
    overscan?: number;
    children: import("svelte").Snippet<[T, number]>;
  }

  let { items, itemHeight, overscan = 3, children }: Props = $props();

  let container: HTMLDivElement;
  let scrollTop = $state(0);
  let containerHeight = $state(0);

  const totalHeight = $derived(items.length * itemHeight);
  const startIndex = $derived(Math.max(0, Math.floor(scrollTop / itemHeight) - overscan));
  const endIndex = $derived(
    Math.min(items.length, Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan)
  );
  const visibleItems = $derived(items.slice(startIndex, endIndex));
  const offsetY = $derived(startIndex * itemHeight);

  function handleScroll(e: Event) {
    const target = e.target as HTMLDivElement;
    scrollTop = target.scrollTop;
  }

  onMount(() => {
    if (container) {
      containerHeight = container.clientHeight;
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          containerHeight = entry.contentRect.height;
        }
      });
      observer.observe(container);
      return () => observer.disconnect();
    }
  });

  export function scrollToIndex(index: number) {
    if (container) {
      container.scrollTop = index * itemHeight;
    }
  }
</script>

<div class="virtual-list" bind:this={container} onscroll={handleScroll}>
  <div class="virtual-list-inner" style="height: {totalHeight}px;">
    <div class="virtual-list-content" style="transform: translateY({offsetY}px);">
      {#each visibleItems as item, i (startIndex + i)}
        {@render children(item, startIndex + i)}
      {/each}
    </div>
  </div>
</div>

<style>
  .virtual-list {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .virtual-list-inner {
    position: relative;
  }

  .virtual-list-content {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem;
  }
</style>
