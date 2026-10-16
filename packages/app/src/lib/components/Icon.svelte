<script lang="ts" module>
  export type IconName = "pencil" | "trash" | "plus";
</script>

<script lang="ts">
  let {
    name,
    size = 14,
    class: className = "",
  }: { name: IconName; size?: number; class?: string } = $props();
</script>

<!-- Inherits its color from the surrounding text (currentColor). -->
<svg
  class="icon {className}"
  viewBox="0 0 16 16"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === "pencil"}
    <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13l-3 1 1-3 8.5-8.5Z" />
  {:else if name === "trash"}
    <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.5 9h7l.5-9M6.5 6.5v4M9.5 6.5v4" />
  {:else if name === "plus"}
    <path d="M8 3v10M3 8h10" />
  {/if}
</svg>

<style>
  .icon {
    flex-shrink: 0;
  }
</style>
