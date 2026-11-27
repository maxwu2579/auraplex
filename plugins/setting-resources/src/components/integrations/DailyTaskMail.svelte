<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import { getMetadata, type IntlString } from '@hcengineering/platform'
  import presentation from '@hcengineering/presentation'
  import setting from '@hcengineering/setting'
  import { Button, Label } from '@hcengineering/ui'
  import { onMount } from 'svelte'

  interface Schedule {
    enabled: boolean
    time: string
    days: number[]
  }
  interface State {
    settings: Schedule
    smtpConfigured: boolean
    linkConfigured: boolean
  }

  const s = setting.string
  const weekdays = [
    { day: 1, label: s.TaskMailMonday }, { day: 2, label: s.TaskMailTuesday },
    { day: 3, label: s.TaskMailWednesday }, { day: 4, label: s.TaskMailThursday },
    { day: 5, label: s.TaskMailFriday }, { day: 6, label: s.TaskMailSaturday },
    { day: 0, label: s.TaskMailSunday }
  ]
  let state: State | undefined
  let busy = false
  let error: IntlString | undefined
  let notice: IntlString | undefined

  async function request<T> (path = '', method = 'GET', body?: Schedule): Promise<T> {
    const response = await fetch('/prospect-mail-api/task-mail' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + (getMetadata(presentation.metadata.Token) ?? ''),
        'Content-Type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
      cache: 'no-store'
    })
    if (!response.ok) throw new Error('Task mail request failed')
    return await response.json() as T
  }

  async function run (action: 'load' | 'save' | 'test'): Promise<void> {
    if (busy) return
    busy = true
    error = undefined
    notice = undefined
    try {
      if (action === 'load') state = await request<State>()
      else if (action === 'save' && state !== undefined) {
        await request('', 'POST', state.settings)
        state = await request<State>()
        notice = s.TaskMailSaved
      } else if (action === 'test') {
        await request('/test', 'POST')
        notice = s.TaskMailTestSent
      }
    } catch {
      error = action === 'test' ? s.TaskMailTestFailed : s.TaskMailUnavailable
    } finally {
      busy = false
    }
  }

  function toggleDay (day: number, checked: boolean): void {
    if (state === undefined) return
    const selection = new Set(state.settings.days)
    if (checked) selection.add(day)
    else selection.delete(day)
    state.settings.days = [...selection]
  }

  onMount(() => { void run('load') })
</script>

<section>
  {#if state !== undefined}
    {#if !state.smtpConfigured}
      <p class="hint"><Label label={s.TaskMailNoSmtp} /></p>
    {:else if !state.linkConfigured}
      <p class="hint"><Label label={s.TaskMailNoPublicUrl} /></p>
    {/if}
    <form on:submit|preventDefault={() => run('save')}>
      <fieldset disabled={busy}>
        <label><input type="checkbox" bind:checked={state.settings.enabled} /> <Label label={s.TaskMailEnabled} /></label>
        <label><Label label={s.TaskMailTime} /> <input type="time" bind:value={state.settings.time} required /></label>
        <fieldset class="week">
          <legend><Label label={s.TaskMailDays} /></legend>
          {#each weekdays as { day, label } (day)}
            <label><input type="checkbox" checked={state.settings.days.includes(day)}
              on:change={(event) => toggleDay(day, event.currentTarget.checked)} /> <Label {label} /></label>
          {/each}
        </fieldset>
        <div class="actions">
          <Button kind="primary" label={s.TaskMailSave}
            disabled={busy || (state.settings.enabled && state.settings.days.length === 0)} />
          <Button label={s.TaskMailTest} disabled={busy || !state.smtpConfigured || !state.linkConfigured}
            on:click={() => run('test')} />
        </div>
      </fieldset>
    </form>
  {:else if busy}
    <p class="hint"><Label label={s.TaskMailLoading} /></p>
  {:else}
    <Button label={s.TaskMailRetry} on:click={() => run('load')} />
  {/if}
  {#if error}<p role="alert" class="error"><Label label={error} /></p>{/if}
  {#if notice}<p role="status"><Label label={notice} /></p>{/if}
</section>

<style>
  section {
    margin-block: 0.75rem 1rem;
    color: var(--theme-caption-color);
  }
  fieldset {
    margin: 0;
    border: 0;
    padding: 0;
    display: grid;
    gap: 0.75rem;
  }
  .week, .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .week legend {
    margin-block-end: 0.4rem;
  }
  input[type='time'] {
    background: var(--theme-button-default);
    color: var(--theme-caption-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
    padding: 0.25rem;
  }
  .hint { color: var(--theme-content-color); }
  .error { color: var(--theme-error-color); }
</style>
