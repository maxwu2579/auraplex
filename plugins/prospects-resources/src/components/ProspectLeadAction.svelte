<!-- Copyright © 2026 Auraplex. Licensed under EPL-2.0. -->
<script lang="ts">
  import { getCurrentAccount } from '@hcengineering/core'
  import type { IntlString } from '@hcengineering/platform'
  import leadPlugin from '@hcengineering/lead'
  import { getClient } from '@hcengineering/presentation'
  import prospects, { type Prospect } from '@hcengineering/prospects'
  import { Label } from '@hcengineering/ui'
  import { openDocFromRef } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'
  import { convertToLead, LeadConversionTimeout } from '../convertToLead'

  export let value: Prospect
  export let canEdit: boolean
  export let disabled: boolean = false

  const client = getClient()
  const dispatch = createEventDispatcher<{ converted: NonNullable<Prospect['lead']>; opened: void }>()
  let converted: NonNullable<Prospect['lead']> | undefined
  let busy = false
  let error: IntlString | undefined
  $: lead = value.lead ?? converted

  async function convert(): Promise<void> {
    if (!canEdit || busy || disabled || lead != null) return
    busy = true
    error = undefined
    try {
      converted = await convertToLead(client, value._id, getCurrentAccount().uuid)
      dispatch('converted', converted)
    } catch (err) {
      error = err instanceof LeadConversionTimeout ? prospects.string.PageLeadTimeout : prospects.string.PageLeadFailed
    } finally {
      busy = false
    }
  }

  async function open(): Promise<void> {
    if (lead == null) return
    error = undefined
    try {
      if (await openDocFromRef(leadPlugin.class.Lead, lead)) dispatch('opened')
      else error = prospects.string.PageLeadFailed
    } catch {
      error = prospects.string.PageLeadFailed
    }
  }
</script>

{#if lead != null}
  <button class="link" on:click={open}><Label label={prospects.string.PageOpenLead} /></button>
{:else if canEdit}
  <button disabled={disabled || busy} on:click={convert}><Label label={prospects.string.PageConvertToLead} /></button>
{/if}
{#if error !== undefined}<span role="alert"><Label label={error} /></span>{/if}

<style>
  .link {
    color: var(--theme-link-color);
    text-decoration: underline;
  }
  [role='alert'] {
    color: var(--theme-error-color);
  }
</style>
