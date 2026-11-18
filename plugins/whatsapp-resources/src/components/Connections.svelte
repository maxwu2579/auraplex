<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import { AccountRole, getCurrentAccount } from '@hcengineering/core'
  import { Label } from '@hcengineering/ui'
  import whatsapp from '@hcengineering/whatsapp'
  import { onMount } from 'svelte'
  import { getConnections, type ConnectionSummary } from '../api'

  const owner = getCurrentAccount().role === AccountRole.Owner
  let entries: ConnectionSummary[] = []
  let unavailable = false
  onMount(() => {
    if (owner) void getConnections().then((result) => { entries = result }).catch(() => { unavailable = true })
  })
</script>

{#if owner}
  <section>
    <h2><Label label={whatsapp.string.Connections} /></h2>
    {#if unavailable}<p><Label label={whatsapp.string.Unavailable} /></p>{/if}
    <ul>
      {#each entries as entry}
        <li>{entry.person} · {entry.displayPhone ?? entry.phoneNumberId} · {entry.connectedOn === undefined ? '—' : new Date(entry.connectedOn).toLocaleString()} ·
          <Label label={entry.status === 'valid' ? whatsapp.string.Connected : entry.status === 'invalid' ? whatsapp.string.Failed : whatsapp.string.ConnectionUnknown} />
        </li>
      {/each}
    </ul>
  </section>
{/if}
