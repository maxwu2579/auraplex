<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import { AccountRole, getCurrentAccount, type Class, type Doc, type Ref } from '@hcengineering/core'
  import contact, { formatName } from '@hcengineering/contact'
  import { getClient } from '@hcengineering/presentation'
  import { Button, Label, ModernCheckbox, SearchInput } from '@hcengineering/ui'
  import whatsapp from '@hcengineering/whatsapp'
  import { onMount } from 'svelte'
  import WahaAttachment from './WahaAttachment.svelte'
  import { request } from '../api'

  type Employee = { id: string, name: string }
  interface Settings {
    warning?: boolean
    wahaUrl?: string
    wahaApiKey?: string
    webhookSecret?: string
    mediaLimitMb: number
    historyDays: number
    supervisors: string[]
    aiUrl?: string
    aiModel?: string
    aiKey?: string
    mailAddress?: string
    mailPassword?: string
    mailSmtpHost?: string
    mailSmtpPort?: number
    mailImapHost?: string
    mailImapPort?: number
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
    mediaDeferred?: boolean
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
  let aiUrl = ''
  let aiModel = ''
  let aiKey = ''
  let address = ''
  let password = ''
  let smtp = ''
  let smtpPort: number | undefined
  let imap = ''
  let imapPort: number | undefined
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
    key = ''
    aiKey = ''
    password = ''
    if (section === value) { section = undefined; return }
    section = value
    busy = true
    error = false
    try {
      if (value === 'settings') {
        settings = await request<Settings>('service-settings')
        url = settings.wahaUrl ?? ''
        aiUrl = settings.aiUrl ?? ''
        aiModel = settings.aiModel ?? ''
        address = settings.mailAddress ?? ''
        smtp = settings.mailSmtpHost ?? ''
        smtpPort = settings.mailSmtpPort
        imap = settings.mailImapHost ?? ''
        imapPort = settings.mailImapPort
        limit = settings.mediaLimitMb
        days = settings.historyDays
        supervisors = new Set(settings.supervisors)
        const people = await getClient().findAll(contact.mixin.Employee, {})
        names = new Map(people.flatMap((person) => person.personUuid === undefined ? [] : [[person.personUuid, formatName(person.name)]]))
        departments = await loadDepartments()
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
      aiKey = ''
      password = ''
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

  // Departments live in the departments plugin (a mixin on hr departments); referenced by id to avoid a package cycle.
  const departmentAccess = 'departments:mixin:DepartmentAccess' as Ref<Class<Doc>>
  interface DepartmentRow { name: string, archived?: boolean, administrators?: string[], supervisors?: string[], employees?: string[], readers?: string[] }
  async function loadDepartments (): Promise<Array<{ name: string, members: string[] }>> {
    try {
      const rows = (await getClient().findAll(departmentAccess, {})) as unknown as DepartmentRow[]
      return rows
        .filter((row) => row.archived !== true)
        .map((row) => ({
          name: row.name,
          members: [...new Set([...(row.administrators ?? []), ...(row.supervisors ?? []), ...(row.employees ?? []), ...(row.readers ?? [])])]
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return []
    }
  }
  let departments: Array<{ name: string, members: string[] }> = []
  let expanded = new Set<string>()
  const noDepartment = '\u0000none'
  $: roster = settings?.members?.map((member) => member.person) ?? []
  $: groups = [
    ...departments
      .map((group) => ({ key: group.name, name: group.name, people: roster.filter((id) => group.members.includes(id)) }))
      .filter((group) => group.people.length > 0),
    { key: noDepartment, name: '', people: roster.filter((id) => !departments.some((group) => group.members.includes(id))) }
  ]
    .filter((group) => group.people.length > 0)
    .map((group) => ({ ...group, people: [...group.people].sort((a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b)) }))
  function expand (key: string): void {
    if (expanded.has(key)) expanded.delete(key)
    else expanded.add(key)
    expanded = new Set(expanded)
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
        <label><Label label={s.WahaAdminKey} /> <span>{#if settings.wahaApiKey}{settings.wahaApiKey}{:else}<Label label={s.SecretUnset} />{/if}</span>
          <input type="password" bind:value={key} autocomplete="new-password" />
        </label>
        <Button label={s.ClearServiceKey} disabled={busy} on:click={() => save({ wahaApiKey: null })} />
        <label><Label label={s.WahaWebhookKey} /> {#if settings.webhookSecret}{settings.webhookSecret}{:else}<Label label={s.SecretUnset} />{/if}</label>
        <Button label={s.RotateWebhookKey} disabled={busy} on:click={() => save({ regenerateWebhook: true })} />
        <label><Label label={s.WahaMediaLimit} /><input type="number" min="1" max="100" bind:value={limit} /></label>
        <label><Label label={s.WahaHistoryDays} /><input type="number" min="0" max="90" bind:value={days} /></label>
        <h3><Label label={s.Supervision} /></h3>
        <div class="roster">
          {#each groups as group (group.key)}
            {@const chosen = group.people.filter((id) => supervisors.has(id)).length}
            <button type="button" class="group" on:click={() => { expand(group.key) }}>
              <span>{expanded.has(group.key) ? '▾' : '▸'}</span>
              {#if group.key === noDepartment}<Label label={s.SupervisionNoDepartment} />{:else}{group.name}{/if}
              <span class="count">{chosen} / {group.people.length}</span>
            </button>
            {#if expanded.has(group.key)}
              <div class="people">
                {#each group.people as person (person)}
                  <ModernCheckbox label={names.get(person) ?? person} checked={supervisors.has(person)}
                    disabled={busy} on:change={() => toggle(person)} />
                {/each}
              </div>
            {/if}
          {/each}
        </div>
        <Button label={s.Save} kind="primary" disabled={busy} on:click={() => save({ wahaUrl: url.trim() || null, mediaLimitMb: limit, historyDays: days, supervisors: [...supervisors], ...(key === '' ? {} : { wahaApiKey: key }) })} />
      </form>
      <h3><Label label={s.RecognizerService} /></h3>
      <form on:submit|preventDefault={() => save({ aiUrl: aiUrl || null, aiModel: aiModel || null, ...(aiKey === '' ? {} : { aiKey }) })}>
        <label><Label label={s.ServiceAddress} /><input type="url" bind:value={aiUrl} /></label>
        <label><Label label={s.ServiceModel} /><input bind:value={aiModel} /></label>
        <label><Label label={s.ServiceSecret} /> {#if settings.aiKey}{settings.aiKey}{:else}<Label label={s.SecretUnset} />{/if}
          <input type="password" bind:value={aiKey} autocomplete="new-password" />
        </label>
        <Button label={s.ClearServiceKey} disabled={busy} on:click={() => save({ aiKey: null })} />
        <Button label={s.Save} kind="primary" disabled={busy}
          on:click={() => save({ aiUrl: aiUrl || null, aiModel: aiModel || null, ...(aiKey === '' ? {} : { aiKey }) })} />
      </form>
      <h3><Label label={s.MailService} /></h3>
      <form on:submit|preventDefault={() => save({})}>
        <label><Label label={s.MailAccount} /><input type="email" bind:value={address} /></label>
        <label><Label label={s.MailPassword} /> {#if settings.mailPassword}{settings.mailPassword}{:else}<Label label={s.SecretUnset} />{/if}
          <input type="password" bind:value={password} autocomplete="new-password" />
        </label>
        <Button label={s.ClearServiceKey} disabled={busy} on:click={() => save({ mailPassword: null })} />
        <label><Label label={s.SmtpHost} /><input bind:value={smtp} /></label>
        <label><Label label={s.SmtpPort} /><input type="number" min="1" max="65535" bind:value={smtpPort} /></label>
        <label><Label label={s.ImapHost} /><input bind:value={imap} /></label>
        <label><Label label={s.ImapPort} /><input type="number" min="1" max="65535" bind:value={imapPort} /></label>
        <Button label={s.Save} kind="primary" disabled={busy} on:click={() => save({
          mailAddress: address || null, mailSmtpHost: smtp || null, mailSmtpPort: smtpPort ?? null,
          mailImapHost: imap || null, mailImapPort: imapPort ?? null, ...(password === '' ? {} : { mailPassword: password })
        })} />
      </form>
      {#if saved}<p role="status"><Label label={settings.warning ? s.ServiceSavedWarning : s.ServiceSaved} /></p>{/if}
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
            <WahaAttachment mediaId={message.mediaId} deferred={message.mediaDeferred ?? false} scope={{ employee, channel: message.channel }} />
          {/if}
        </article>
      {/each}
    {/if}
    {#if error}<p role="alert"><Label label={s.Failed} /></p>{/if}
  </section>
{/if}

<style>
  .administration { padding: var(--spacing-3); max-height: 65vh; overflow: auto; color: var(--theme-content-color); }
  @media (max-width: 680px) {
    /* Phones: let the settings page scroll as a whole instead of a small inner box. */
    .administration { max-height: none; overflow: visible; }
  }
  form, .roster, label { display: flex; flex-direction: column; align-items: flex-start; gap: var(--spacing-1); }
  .buttons, .conversations { display: flex; flex-wrap: wrap; gap: var(--spacing-1); }
  input, select { max-width: 100%; color: var(--theme-content-color); background: var(--theme-popup-color); border: 1px solid var(--theme-divider-color); }
  .roster { width: 100%; }
  .group { display: flex; align-items: center; gap: var(--spacing-1); padding: 0.3rem 0; background: none; border: none; color: inherit; cursor: pointer; font-weight: 500; }
  .count { opacity: 0.6; font-weight: 400; }
  .people { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(10rem, 100%), 1fr)); gap: var(--spacing-1) var(--spacing-2); width: 100%; padding: 0 0 var(--spacing-1) 1.2rem; }
  article { border-bottom: 1px solid var(--theme-divider-color); padding-block: var(--spacing-1); overflow-wrap: anywhere; }
</style>
