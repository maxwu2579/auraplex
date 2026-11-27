<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import type { Ref } from '@hcengineering/core'
  import type { Order } from '@hcengineering/departments'
  import Orders from './Orders.svelte'

  /** One order, opened from the inbox or a link. */
  export let _id: Ref<Order>
</script>

<div class="order-panel">
  {#key _id}<Orders focusId={_id} />{/key}
</div>

<style>
  .order-panel { height: 100%; width: 100%; overflow: auto; background-color: var(--theme-panel-color, var(--theme-bg-color)); }
</style>
