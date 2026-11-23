// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
<script lang="ts">
  import { AccountRole, getCurrentAccount } from '@hcengineering/core'
  import contact from '@hcengineering/contact'
  import { getClient } from '@hcengineering/presentation'
  import { Button, Label, ModernCheckbox, SearchInput } from '@hcengineering/ui'
  import whatsapp from '@hcengineering/whatsapp'
  import { onMount } from 'svelte'
  import WahaAttachment from './WahaAttachment.svelte'
  import { request } from '../api'

  type Employee = { id: string, name: string }
  interface Settings {
    wahaUrl?: string
    wahaApiKey?: string
    webhookSecret?: string
    mediaLimitMb: number
    historyDays: number
    supervisors: string[]
    members?: Array<{ person: string, role: AccountRole }>
  }
  interface Conversation {
    channel: string
    name: string
    phone: string
    sendOn: number
  }
  interface Message extends Conversation {
    id: string
    direction: string
    content: string
    mediaId?: string
  }

  const owner = getCurrentAccount().role === AccountRole.Owner
  const s = whatsapp.string
  let settings: Settings | undefined
  let section: 'settings' | 'supervision' | undefined
  let allowed = false
  let busy = false
  let error = false
  let saved = false
  let url = ''
  let key = ''
  let limit = 20
  let days = 0
  let supervisors = new Set<string>()
  let names = new Map<string, string>()
  let employees: Employee[] = []
  let employee = ''
  let conversations: Conversation[] = []
  let messages: Message[] = []
  let search: string | undefined
  let date = ''
  let chatName = ''

  onMount(() => {
    void request<{ allowed: boolean }>('supervision').then((status) => { allowed = status.allowed }).catch(() => {})
  })

  async function open (value: 'settings' | 'supervision'): Promise<void> {
    if (section === value) { section = undefined; return }
    section = value
    busy = true
    error = false
    try {
      if (value === 'settings') {
        settings = await request<Settings>('service-settings')
        url = settings.wahaUrl ?? ''
        limit = settings.mediaLimitMb
        days = settings.historyDays
        supervisors = new Set(settings.supervisors)
        const people = await getClient().findAll(contact.mixin.Employee, {})
        names = new Map(people.flatMap((person) => person.personUuid === undefined ? [] : [[person.personUuid, person.name]]))
      } else {
        employees = await request<Employee[]>('supervision/employees')
      }
    } catch {
      error = true
    } finally {
      busy = false
    }
  }

  async function save (patch: object): Promise<void> {
    busy = true
    error = false
    saved = false
    try {
      settings = { ...await request<Settings>('service-settings', 'POST', patch), members: settings?.members }
      allowed = (await request<{ allowed: boolean }>('supervision')).allowed
      saved = true
    } catch {
      error = true
    } finally {
      key = ''
      busy = false
    }
  }

  async function loadChat (channel?: string): Promise<void> {
    if (!employee) return
    error = false
    busy = true
    const params = new URLSearchParams({ employee })
    if (channel) params.set('channel', channel)
    if (date) {
      const day = new Date(date + 'T00:00:00').getTime()
      params.set('after', String(day))
      params.set('before', String(day + 86400000 - 1))
    }
    try {
      if (channel === undefined) {
        messages = []
        chatName = ''
        conversations = await request<Conversation[]>('supervision/messages?' + params.toString())
      } else {
        chatName = conversations.find((item) => item.channel === channel)?.name ?? ''
        messages = await request<Message[]>('supervision/messages?' + params.toString())
      }
    } catch {
      error = true
    } finally {
      busy = false
    }
  }

  function toggle (id: string): void {
    if (supervisors.has(id)) supervisors.delete(id)
    else supervisors.add(id)
    supervisors = new Set(supervisors)
  }
  $: term = search?.trim().toLocaleLowerCase() ?? ''
  $: matches = conversations.filter((row) => row.name.toLocaleLowerCase().includes(term) || row.phone.includes(term))
</script>

{#if owner || allowed}
  <section class="administration">
    <div class="buttons">
      {#if owner}<Button label={s.ServiceSettings} selected={section === 'settings'} on:click={() => { void open('settings') }} />{/if}
      {#if allowed}<Button label={s.Supervision} selected={section === 'supervision'} on:click={() => { void open('supervision') }} />{/if}
    </div>
    {#if section === 'settings' && settings !== undefined}
      <h3>WhatsApp (WAHA)</h3>
      <form on:submit|preventDefault={() => save({ wahaUrl: url.trim() || null, mediaLimitMb: limit, historyDays: days, supervisors: [...supervisors], ...(key === '' ? {} : { wahaApiKey: key }) })}>
        <label><Label label={s.WahaAddress} /><input type="url" bind:value={url} /></label>
        <label><Label label={s.WahaAdminKey} /> <span>{settings.wahaApiKey ?? ''}</span>
          <input type="password" bind:value={key} autocomplete="new-password" />
        </label>
        <Button label={s.ClearServiceKey} disabled={busy} on:click={() => save({ wahaApiKey: null })} />
        <label><Label label={s.WahaWebhookKey} /> {settings.webhookSecret ?? ''}</label>
        <Button label={s.RotateWebhookKey} disabled={busy} on:click={() => save({ regenerateWebhook: true })} />
        <label><Label label={s.WahaMediaLimit} /><input type="number" min="1" max="100" bind:value={limit} /></label>
        <label><Label label={s.WahaHistoryDays} /><input type="number" min="0" max="90" bind:value={days} /></label>
        <h3><Label label={s.Supervision} /></h3>
        <div class="roster">
          {#each settings.members ?? [] as member (member.person)}
            <ModernCheckbox label={names.get(member.person) ?? member.person} checked={supervisors.has(member.person)}
              disabled={busy} on:change={() => toggle(member.person)} />
          {/each}
        </div>
        <Button label={s.Save} kind="primary" disabled={busy} on:click={() => save({ wahaUrl: url.trim() || null, mediaLimitMb: limit, historyDays: days, supervisors: [...supervisors], ...(key === '' ? {} : { wahaApiKey: key }) })} />
      </form>
      {#if saved}<p role="status"><Label label={s.ServiceSaved} /></p>{/if}
    {:else if section === 'supervision'}
      <label><Label label={s.ChooseEmployee} />
        <select bind:value={employee} on:change={() => loadChat()}>
          <option value="">—</option>
          {#each employees as person (person.id)}<option value={person.id}>{person.name}</option>{/each}
        </select>
      </label>
      <label><Label label={s.SupervisionDate} /><input type="date" bind:value={date} on:change={() => loadChat()} /></label>
      <SearchInput bind:value={search} placeholder={s.SupervisionSearch} />
      <div class="conversations">
        {#each matches as conversation (conversation.channel)}
          <Button disabled={busy} on:click={() => loadChat(conversation.channel)}>
            <span slot="content">{conversation.name} · {conversation.phone}</span>
          </Button>
        {/each}
      </div>
      {#if chatName}<h3>{chatName}</h3>{/if}
      {#each messages as message (message.id)}
        <article>
          <Label label={message.direction === 'outgoing' ? s.Sent : s.Messages} />
          · <time>{new Date(message.sendOn).toLocaleString()}</time>
          <p>{message.content}</p>
          {#if message.mediaId && employee}
            <WahaAttachment mediaId={message.mediaId} scope={{ employee, channel: message.channel }} />
          {/if}
        </article>
      {/each}
    {/if}
    {#if error}<p role="alert"><Label label={s.Failed} /></p>{/if}
  </section>
{/if}

<style>
  .administration { padding: var(--spacing-3); max-height: 65vh; overflow: auto; color: var(--theme-content-color); }
  form, .roster, label { display: flex; flex-direction: column; align-items: flex-start; gap: var(--spacing-1); }
  .buttons, .conversations { display: flex; flex-wrap: wrap; gap: var(--spacing-1); }
  input, select { max-width: 100%; color: var(--theme-content-color); background: var(--theme-popup-color); border: 1px solid var(--theme-divider-color); }
  article { border-bottom: 1px solid var(--theme-divider-color); padding-block: var(--spacing-1); overflow-wrap: anywhere; }
</style>
