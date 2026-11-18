<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import type { IntlString } from '@hcengineering/platform'
  import DropdownLabels from './DropdownLabels.svelte'
  import type { DropdownTextItem } from '../types'

  export let items: DropdownTextItem[]
  export let selected: string[] = []
  export let label: IntlString
  export let disabled = false
  export let loading = false
</script>

<DropdownLabels
  multiselect
  autoSelect={false}
  {items}
  {selected}
  {label}
  showDropdownIcon
  kind="no-border"
  size="large"
  width="min(18rem, 100%)"
  disabled={disabled || loading || items.length === 0}
  {loading}
  on:selected
/>
