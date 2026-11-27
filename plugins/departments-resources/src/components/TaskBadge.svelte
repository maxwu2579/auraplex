<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import TaskFeed from './TaskFeed.svelte'
</script>

<TaskFeed let:count>
  {#if count > 0}<span class="count">{count}</span>{/if}
</TaskFeed>

<style>
  .count {
    position: absolute;
    right: 0;
    top: 0;
    pointer-events: none;
    padding: 0 0.25rem;
    border-radius: 0.65rem;
    background: var(--theme-button-default);
    color: var(--theme-error-color);
    font-size: 0.72rem;
    font-weight: 700;
    z-index: 1;
  }
</style>
