<!-- Copyright © 2026 Auraplex. Licensed under EPL-2.0. -->
<script lang="ts">
  import { getCurrentAccount } from '@hcengineering/core'
  import leadPlugin from '@hcengineering/lead'
  import { getClient } from '@hcengineering/presentation'
  import prospects, { type Prospect } from '@hcengineering/prospects'
  import { Label } from '@hcengineering/ui'
  import { openDocFromRef } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'
  import { convertToLead } from '../convertToLead'

  export let value: Prospect
  export let canEdit: boolean
  export let disabled: boolean = false

  const client = getClient()
  const dispatch = createEventDispatcher<{ converted: NonNullable<Prospect['lead']>; opened: void }>()
  let converted: NonNullable<Prospect['lead']> | undefined
  let busy = false
  let error = false
  $: lead = value.lead ?? converted

  async function convert(): Promise<void> {
    if (!canEdit || busy || disabled || lead != null) return
    busy = true
    error = false
    try {
      converted = await convertToLead(client, value._id, getCurrentAccount().uuid)
      dispatch('converted', converted)
    } catch {
      error = true
    } finally {
      busy = false
    }
  }

  async function open(): Promise<void> {
    if (lead == null) return
    error = false
    try {
      error = !(await openDocFromRef(leadPlugin.class.Lead, lead))
      if (!error) dispatch('opened')
    } catch {
      error = true
    }
  }
</script>

{#if lead != null}
  <button class="link" on:click={open}><Label label={prospects.string.PageOpenLead} /></button>
{:else if canEdit}
  <button disabled={disabled || busy} on:click={convert}><Label label={prospects.string.PageConvertToLead} /></button>
{/if}
{#if error}<span role="alert"><Label label={prospects.string.PageLeadFailed} /></span>{/if}

<style>
  .link {
    color: var(--theme-link-color);
    text-decoration: underline;
  }
  [role='alert'] {
    color: var(--theme-error-color);
  }
</style>
