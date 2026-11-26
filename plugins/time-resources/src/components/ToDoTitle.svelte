<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import type { IntlString } from '@hcengineering/platform'
  import { Label } from '@hcengineering/ui'

  // Approval to-dos are created by the server with a fixed English title; show it in the user's language.
  export let title: string
  const approveRequest = 'process:string:ApproveRequest' as IntlString
</script>

{#if title === 'Approve request'}<Label label={approveRequest} />{:else}{title}{/if}
