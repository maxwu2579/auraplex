<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import type { IntlString } from '@hcengineering/platform'
  import { Label } from '@hcengineering/ui'

  /** Small coloured label for an order or stage state. */
  export let status: 'active' | 'approval' | 'late' | 'done' | 'waiting'
  export let label: IntlString | undefined = undefined
  export let text: string | undefined = undefined
</script>

<span class="tag {status}">{#if label !== undefined}<Label {label} />{:else}{text ?? ''}{/if}</span>

<style>
  .tag {
    display: inline-flex; align-items: center; padding: 0.05rem 0.45rem; border-radius: 0.65rem;
    font-size: 0.75rem; font-weight: 500; line-height: 1.4; white-space: nowrap;
    border: 1px solid currentColor;
  }
  .active { color: var(--theme-link-color, #4c7dff); }
  .approval { color: var(--theme-warning-color, #e0a030); }
  .late { color: var(--theme-error-color, #e05050); }
  .done { color: var(--theme-won-color, #3a9b5d); }
  .waiting { color: var(--theme-dark-color, #888); }
</style>
