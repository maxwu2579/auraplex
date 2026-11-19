<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import { Breadcrumb, Button, Header, Label, languageStore } from '@hcengineering/ui'
  import { translateCB, type IntlString } from '@hcengineering/platform'
  import core, { AccountRole, getCurrentAccount } from '@hcengineering/core'
  import departments, { defaultTrackingSettings, type TrackingSettings } from '@hcengineering/departments'
  import { createQuery, getClient } from '@hcengineering/presentation'

  /** Super admins decide how long page-open records are kept and when to raise an alert. */
  const client = getClient()
  const owner = getCurrentAccount().role === AccountRole.Owner

  let settings: TrackingSettings | undefined
  let retention = defaultTrackingSettings.viewRetentionDays
  let count = defaultTrackingSettings.alertCount
  let minutes = defaultTrackingSettings.alertMinutes
  let busy = false
  let message = ''
  let failed = false

  createQuery().query(departments.class.TrackingSettings, { _id: departments.ids.TrackingSettings }, (res) => {
    settings = res[0]
    if (settings !== undefined && !busy) {
      retention = settings.viewRetentionDays
      count = settings.alertCount
      minutes = settings.alertMinutes
    }
  })

  async function save (): Promise<void> {
    if (busy) return
    busy = true
    message = ''
    failed = false
    try {
      const values = {
        viewRetentionDays: Math.max(1, Math.round(retention)),
        alertCount: Math.max(1, Math.round(count)),
        alertMinutes: Math.max(1, Math.round(minutes))
      }
      if (settings === undefined) {
        await client.createDoc(departments.class.TrackingSettings, core.space.Workspace, values, departments.ids.TrackingSettings)
      } else {
        await client.update(settings, values)
      }
      message = trackingText(departments.string.TrackingPageSettingsSaved)
    } catch {
      failed = true
      message = trackingText(departments.string.TrackingPageSettingsSaveError)
    } finally {
      busy = false
    }
  }
  function trackingText (id: IntlString, params: Record<string, string | number> = {}): string {
    let result: string = id
    translateCB(id, params, $languageStore, (value) => { result = value })
    return result
  }
</script>

<section class="settings">
  <Header adaptive="disabled"><Breadcrumb label={departments.string.TrackingPageTrackingSettings} size="large" isCurrent /></Header>
  {#if !owner}
    <p class="hint"><Label label={departments.string.TrackingPageOwnerOnly} /></p>
  {/if}
  <label><Label label={departments.string.TrackingPageRetentionDays} /><input type="number" min="1" bind:value={retention} disabled={!owner} /></label>
  <p class="hint"><Label label={departments.string.TrackingPageRetentionHint} /></p>
  <div class="row">
    <label><Label label={departments.string.TrackingPageMinutes} /><input type="number" min="1" bind:value={minutes} disabled={!owner} /></label>
    <label><Label label={departments.string.TrackingPageMaxViews} /><input type="number" min="1" bind:value={count} disabled={!owner} /></label>
  </div>
  <p class="hint"><Label label={departments.string.TrackingPageAlertHint} /></p>
  {#if owner}<Button kind="primary" disabled={busy} on:click={save} label={busy ? departments.string.TrackingPageSaving : departments.string.TrackingPageSave} />{/if}
  {#if message}<p class:err={failed} class:ok={!failed}>{message}</p>{/if}
</section>

<style>
  .settings { display: flex; flex-direction: column; gap: 0.6rem; padding: 1rem 1.25rem; max-width: 40rem; }
  h2 { margin: 0; }
  .row { display: flex; gap: 1rem; flex-wrap: wrap; }
  label { display: flex; flex-direction: column; gap: 0.25rem; }
  input, button {
    color: var(--theme-content-color);
    background: var(--theme-button-default);
    border: 1px solid var(--theme-button-border);
    padding: 0.35rem 0.6rem;
    border-radius: 0.3rem;
    font: inherit;
    max-width: 12rem;
  }
  button { cursor: pointer; align-self: flex-start; }
  .hint { color: var(--theme-dark-color); margin: 0; }
  .err { color: var(--theme-error-color); margin: 0; }
  .ok { color: var(--theme-won-color, #3a9b5d); margin: 0; }
</style>
