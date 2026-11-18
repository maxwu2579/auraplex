<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import { Dialog, Label } from '@hcengineering/ui'
  import whatsapp from '@hcengineering/whatsapp'
  import { createEventDispatcher } from 'svelte'
  const dispatch = createEventDispatcher()
</script>
<Dialog on:close={() => dispatch('close')}>
  <svelte:fragment slot="title"><Label label={whatsapp.string.WeCom} /></svelte:fragment>
  <p><Label label={whatsapp.string.WeComNotice} /></p>
</Dialog>
