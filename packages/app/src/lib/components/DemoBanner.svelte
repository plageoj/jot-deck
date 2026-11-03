<script lang="ts">
  import { DESKTOP_DOWNLOAD_URL } from "#lib/webDemo.ts";
</script>

<!-- No close button and no key handling: the banner is the only reminder
     that nothing is saved, so it stays put (docs/009-web-demo.md §4.1). -->
<div class="demo-banner" role="note">
  <span>Web demo — nothing is saved.</span>
  <a href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noopener"
    >Download the desktop app</a
  >
</div>

<style>
  .demo-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 0 0.5rem;
    padding: 0.25rem 1rem;
    background-color: var(--accent);
    color: #fff;
    font-size: 0.875rem;
    flex-shrink: 0;
  }

  .demo-banner a {
    color: inherit;
    font-weight: 600;
  }

  .demo-banner a:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 2px;
    border-radius: 2px;
  }
</style>
