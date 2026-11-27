<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { Label } from '@hcengineering/ui'
  import prospects, { defaultAutomation, type AutoMailSettings, type MailCampaign } from '@hcengineering/prospects'
  import { mailAutomationRequest } from '../mailAutomation'

  interface Customer { id: string, name: string }
  interface State {
    settings: AutoMailSettings
    sent: number
    oldest?: number
    due?: number
    intro: Customer[]
    campaign?: MailCampaign & { sent: number, total: number, pending: Customer[] }
    log: Array<{ id: string, subject: string, sentAt: number, delivery: string, automation: string }>
  }
  const s = prospects.string
  let state: State | undefined
  let settings = structuredClone(defaultAutomation)
  let busy = false
  let error = false
  let title = ''
  let start = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  let subject = ''
  let body = ''
  $: campaign = state?.campaign
  $: running = campaign?.status === 'active' || campaign?.status === 'paused'

  function date (value: number): string {
    return new Date(value).toLocaleString(undefined, { timeZone: 'Asia/Singapore' })
  }
  async function run (payload?: object): Promise<void> {
    if (busy) return
    busy = true
    error = false
    try {
      if (payload !== undefined) await mailAutomationRequest(payload)
      state = await mailAutomationRequest<State>()
      settings = structuredClone(state.settings)
    } catch {
      error = true
    } finally {
      busy = false
    }
  }
  onMount(() => { void run() })
</script>

<section class="page">
  <h2><Label label={s.AutoMail} /></h2>
  <button on:click={() => run()} disabled={busy}><Label label={s.AutoMailRefresh} /></button>
  {#if error}<p role="alert"><Label label={s.AutoMailFailed} /></p>{/if}
  {#if state !== undefined}
    <p><Label label={s.AutoMailQuota} params={{ sent: state.sent, quota: state.settings.limit }} /></p>
    <details>
      <summary><Label label={s.AutoMailSettings} /></summary>
      <form on:submit|preventDefault={() => run({ op: 'settings', settings })}>
        <label><input type="checkbox" bind:checked={settings.enabled} /> <Label label={s.AutoMailEnabled} /></label>
        <label><Label label={s.AutoMailLimit} /> <input type="number" min="1" max="500" bind:value={settings.limit} required /></label>
        <label><Label label={s.AutoMailWait} /> <input type="number" min="1" max="90" bind:value={settings.waitDays} required /></label>
        <label><Label label={s.AutoMailLanguage} />
          <select bind:value={settings.language}><option value="zh">中文</option><option value="en">English</option></select>
        </label>
        <p><Label label={s.AutoMailVariables} /></p>
        <fieldset>
          <legend>中文</legend>
          <label><Label label={s.PageSubject} /><input maxlength="200" bind:value={settings.zh.subject} /></label>
          <label><Label label={s.PageBody} /><textarea maxlength="28000" bind:value={settings.zh.body} /></label>
        </fieldset>
        <fieldset>
          <legend>English</legend>
          <label><Label label={s.PageSubject} /><input maxlength="200" bind:value={settings.en.subject} /></label>
          <label><Label label={s.PageBody} /><textarea maxlength="28000" bind:value={settings.en.body} /></label>
        </fieldset>
        <button disabled={busy}><Label label={s.AutoMailSave} /></button>
      </form>
    </details>
    <h3><Label label={s.AutoMailIntro} /> ({state.intro.length})</h3>
    {#if state.oldest !== undefined}
      <p><Label label={s.AutoMailOldest} params={{ count: Math.max(0, Math.floor((Date.now() - state.oldest) / 86400000)) }} />
        {#if state.due !== undefined} · <Label label={s.AutoMailEstimate} params={{ date: date(state.due) }} />{/if}
      </p>
    {/if}
    <ul>{#each state.intro as customer (customer.id)}
      <li>{customer.name} <button disabled={busy} on:click={() => run({ op: 'remove-intro', id: customer.id })}><Label label={s.AutoMailRemove} /></button></li>
    {/each}</ul>
    <h3><Label label={s.AutoMailCampaign} /></h3>
    {#if campaign !== undefined}
      <p>{campaign.title} · <Label label={s.AutoMailProgress} params={{ sent: campaign.sent, total: campaign.total }} />
        · <Label label={campaign.status === 'active' ? s.AutoMailRunning : campaign.status === 'paused' ? s.AutoMailPaused
          : campaign.status === 'done' ? s.AutoMailDone : s.AutoMailStopped} />
      </p>
      {#if running}
        <p><Label label={s.AutoMailDaysLeft} params={{ count: Math.ceil(campaign.pending.length / state.settings.limit) }} /></p>
        <button disabled={busy} on:click={() => run({ op: campaign?.status === 'paused' ? 'resume' : 'pause', campaign: campaign?.id })}>
          <Label label={campaign.status === 'paused' ? s.AutoMailResume : s.AutoMailPause} />
        </button>
        <button disabled={busy} on:click={() => run({ op: 'stop', campaign: campaign?.id })}><Label label={s.AutoMailStop} /></button>
        <ul>
          {#each campaign.pending as customer (customer.id)}
            <li>{customer.name} <button disabled={busy} on:click={() => run({ op: 'remove-campaign', campaign: campaign?.id, id: customer.id })}>
              <Label label={s.AutoMailRemove} /></button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
    {#if !running}
      <details>
        <summary><Label label={s.AutoMailCreate} /></summary>
        <form on:submit|preventDefault={() => run({ op: 'create', title, start, template: { subject, body } })}>
          <label><Label label={s.AutoMailCampaignName} /><input required maxlength="120" bind:value={title} /></label>
          <label><Label label={s.AutoMailStart} /><input type="date" required bind:value={start} /></label>
          <label><Label label={s.PageSubject} /><input required maxlength="200" bind:value={subject} /></label>
          <label><Label label={s.PageBody} /><textarea required maxlength="28000" bind:value={body} /></label>
          <button disabled={busy}><Label label={s.AutoMailCreate} /></button>
        </form>
      </details>
    {/if}
    <h3><Label label={s.AutoMailHistory} /></h3>
    <ul>
      {#each state.log as entry (entry.id)}
        <li>{date(entry.sentAt)} · {entry.subject} · <Label label={entry.delivery === 'sent' ? s.PageSent :
          entry.delivery === 'uncertain' ? s.AutoMailUncertain : entry.delivery === 'failed' ? s.AutoMailFailed : s.AutoMailRunning} /></li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .page { overflow: auto; padding: clamp(0.75rem, 3vw, 1.5rem); flex: 1; color: var(--theme-caption-color); }
  form, label { display: grid; gap: 0.4rem; }
  form { max-width: 38rem; padding: 0.75rem 0; }
  fieldset { border: 1px solid var(--theme-divider-color); }
  input, select, textarea { background: var(--theme-button-default); color: var(--theme-caption-color); padding: 0.4rem; border: 1px solid var(--theme-divider-color); }
  input[type='checkbox'] { display: inline-block; width: fit-content; }
  button { color: var(--theme-link-color); padding: 0.35rem 0.6rem; }
  summary { cursor: pointer; }
  textarea { min-height: 5rem; }
  li { padding: 0.25rem 0; }
</style>
