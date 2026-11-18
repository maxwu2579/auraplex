<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import { AccountRole, getCurrentAccount } from '@hcengineering/core'
  import contact from '@hcengineering/contact'
  import { getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import whatsapp from '@hcengineering/whatsapp'
  import { onMount } from 'svelte'
  import { getConnections, type ConnectionSummary } from '../api'

  const owner = getCurrentAccount().role === AccountRole.Owner
  let entries: ConnectionSummary[] = []
  let personNames = new Map<string, string>()
  let unavailable = false
  onMount(() => {
    if (owner) {
      void getConnections().then(async (result) => {
        entries = result
        const ids = result.map((entry) => entry.person)
        if (ids.length === 0) return
        const client = getClient()
        const identities = await client.findAll(contact.class.SocialIdentity, { _id: { $in: ids } })
        const people = await client.findAll(contact.class.Person, { _id: { $in: identities.map((identity) => identity.attachedTo) } })
        const names = new Map(people.map((person) => [person._id, person.name]))
        personNames = new Map(identities.map((identity) => [identity._id, names.get(identity.attachedTo) ?? identity._id]))
      }).catch(() => { unavailable = true })
    }
  })
</script>

{#if owner}
  <section>
    <h2><Label label={whatsapp.string.Connections} /></h2>
    {#if unavailable}<p><Label label={whatsapp.string.Unavailable} /></p>{/if}
    <ul>
      {#each entries as entry}
        <li>{personNames.get(entry.person) ?? entry.person} · {entry.displayPhone ?? entry.phoneNumberId} · {entry.connectedOn === undefined ? '—' : new Date(entry.connectedOn).toLocaleString()} ·
          <Label label={entry.status === 'valid' ? whatsapp.string.Connected : entry.status === 'invalid' ? whatsapp.string.Failed : whatsapp.string.ConnectionUnknown} />
        </li>
      {/each}
    </ul>
  </section>
{/if}
