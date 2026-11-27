<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import type { Ref } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import prospects, { type Prospect } from '@hcengineering/prospects'
  import MailPanel from './MailPanel.svelte'

  export let _id: Ref<Prospect>
  let prospect: Prospect | undefined
  const query = createQuery()
  $: query.query(prospects.class.Prospect, { _id }, (docs) => { prospect = docs[0] })
</script>

{#if prospect !== undefined}
  <div class="prospect-panel">
    <h2>{prospect.name}</h2>
    <p>{prospect.company}</p>
    {#key prospect._id}<MailPanel value={prospect} />{/key}
  </div>
{/if}

<style>
  .prospect-panel { padding: 1rem; height: 100%; overflow-y: auto; color: var(--theme-caption-color); }
</style>
