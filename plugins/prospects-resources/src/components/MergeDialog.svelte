<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<!-- Merge two business cards: pick each field from the left or right card, keep one card and move
     photos, mail history and follow-up to-dos onto it, then delete the other. -->
<script lang="ts">
  import attachment from '@hcengineering/attachment'
  import { getCurrentAccount } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import prospects, {
    builtinProspectFields, mergedStatus, normalizeEmail, type BuiltinProspectField, type Prospect, type ProspectFieldDef
  } from '@hcengineering/prospects'
  import time from '@hcengineering/time'
  import { createEventDispatcher } from 'svelte'
  import { chinese } from '../trStore'

  export let a: Prospect
  export let b: Prospect
  /** Visible template fields with their display names. */
  export let columns: Array<{ field: ProspectFieldDef, label: string, read: (p: Prospect) => string }>

  const dispatch = createEventDispatcher<{ close: undefined, merged: Prospect }>()
  const client = getClient()
  // Keep the older card by default (it usually has the mail history).
  let keepLeft = (a.createdOn ?? a.modifiedOn) <= (b.createdOn ?? b.modifiedOn)
  $: keep = keepLeft ? a : b
  $: drop = keepLeft ? b : a
  const isBuiltin = (key: string): key is BuiltinProspectField => (builtinProspectFields as readonly string[]).includes(key)
  const raw = (p: Prospect, key: string): string | number | undefined => isBuiltin(key) ? p[key] : p.custom?.[key]
  const filled = (value: string | number | undefined): boolean => value !== undefined && String(value).trim() !== ''
  // Per field: take the left or the right value. Default: the filled one; when both are filled, the newer card's.
  const newerLeft = a.modifiedOn >= b.modifiedOn
  let choice: Record<string, 'a' | 'b'> = Object.fromEntries(columns.map(({ field }) => {
    const left = raw(a, field.key)
    const right = raw(b, field.key)
    const pick = !filled(right) ? 'a' : !filled(left) ? 'b' : newerLeft ? 'a' : 'b'
    return [field.key, pick]
  }))
  let busy = false
  let error = ''

  async function merge (): Promise<void> {
    if (busy) return
    busy = true
    error = ''
    try {
      const patch: Record<string, unknown> = {}
      const custom: Record<string, string | number> = { ...(drop.custom ?? {}), ...(keep.custom ?? {}) }
      for (const { field } of columns) {
        const value = raw(choice[field.key] === 'a' ? a : b, field.key)
        if (isBuiltin(field.key)) patch[field.key] = value ?? ''
        else if (filled(value)) custom[field.key] = value as string | number
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        else delete custom[field.key]
      }
      if (typeof patch.email === 'string') patch.normalizedEmail = normalizeEmail(patch.email)
      const [mails, photos, todos] = await Promise.all([
        client.findAll(prospects.class.ProspectMail, { attachedTo: drop._id }),
        client.findAll(attachment.class.Photo, { attachedTo: drop._id }),
        client.findAll(time.class.ToDo, { attachedTo: drop._id })
      ])
      const ops = client.apply(undefined, 'prospect-merge')
      // The other card is removed in the same step, so the e-mail stays unique.
      await ops.remove(drop)
      await ops.update(keep, {
        ...patch,
        ...(Object.keys(custom).length > 0 ? { custom } : {}),
        status: mergedStatus(keep.status, drop.status),
        ...(keep.lead == null && drop.lead != null ? { lead: drop.lead } : {}),
        ...(keep.owner === undefined && drop.owner !== undefined ? { owner: drop.owner } : {}),
        emailCount: (keep.emailCount ?? 0) + (drop.emailCount ?? 0),
        ...(drop.lastEmailAt !== undefined && drop.lastEmailAt > (keep.lastEmailAt ?? 0) ? { lastEmailAt: drop.lastEmailAt } : {}),
        photos: (keep.photos ?? 0) + photos.length,
        mailMessages: (keep.mailMessages ?? 0) + mails.length,
        notes: [keep.notes, drop.notes].filter((it) => (it ?? '').trim() !== '').filter((it, i, all) => all.indexOf(it) === i).join('\n'),
        review: [],
        recognitionConfirmed: true,
        mergedFrom: [...(keep.mergedFrom ?? []), ...(drop.mergedFrom ?? []), {
          name: drop.name, company: drop.company, by: getCurrentAccount().uuid, on: Date.now()
        }]
      })
      for (const mail of mails) await ops.update(mail, { attachedTo: keep._id })
      for (const photo of photos) await ops.update(photo, { attachedTo: keep._id })
      for (const todo of todos) await ops.update(todo, { attachedTo: keep._id })
      if (!(await ops.commit()).result) throw new Error('refused')
      dispatch('merged', keep)
    } catch {
      error = $chinese ? '合并失败：可能没有名片编辑权限，或其中一张刚被别人改过。请刷新后再试。' : 'Could not merge. You may lack edit access, or one card just changed. Reload and try again.'
    } finally {
      busy = false
    }
  }
  const show = (value: string | number | undefined): string => filled(value) ? String(value) : '—'
</script>

<div class="overlay" role="presentation">
  <section class="dialog" role="dialog" aria-modal="true" aria-label={$chinese ? '对照合并' : 'Compare and merge'}>
    <header>
      <h2>{$chinese ? '对照合并两张名片' : 'Compare and merge two cards'}</h2>
      <button on:click={() => dispatch('close')}>✕</button>
    </header>
    <p class="hint">{$chinese
      ? '每一行选要留下的值（默认选有内容、比较新的）。照片、邮件记录、跟进待办都会合到留下的那张，另一张会删掉。'
      : 'Pick the value to keep on each row. Photos, mail history and follow-up to-dos move to the card you keep; the other card is deleted.'}</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th></th>
            <th><label><input type="radio" bind:group={keepLeft} value={true} /> {$chinese ? '留下这张' : 'Keep this card'}</label></th>
            <th><label><input type="radio" bind:group={keepLeft} value={false} /> {$chinese ? '留下这张' : 'Keep this card'}</label></th>
          </tr>
        </thead>
        <tbody>
          {#each columns as { field, label } (field.key)}
            {@const left = raw(a, field.key)}
            {@const right = raw(b, field.key)}
            <tr class:differ={show(left) !== show(right)}>
              <th>{label}</th>
              <td><label><input type="radio" bind:group={choice[field.key]} value="a" /> {show(left)}</label></td>
              <td><label><input type="radio" bind:group={choice[field.key]} value="b" /> {show(right)}</label></td>
            </tr>
          {/each}
          <tr>
            <th>{$chinese ? '照片 / 邮件' : 'Photos / mails'}</th>
            <td>{a.photos ?? 0} / {a.mailMessages ?? a.emailCount ?? 0}</td>
            <td>{b.photos ?? 0} / {b.mailMessages ?? b.emailCount ?? 0}</td>
          </tr>
        </tbody>
      </table>
    </div>
    {#if error}<p role="alert" class="error">{error}</p>{/if}
    <footer>
      <button class="primary" disabled={busy} on:click={merge}>{busy ? ($chinese ? '正在合并…' : 'Merging…') : ($chinese ? '合并' : 'Merge')}</button>
      <button on:click={() => dispatch('close')}>{$chinese ? '取消' : 'Cancel'}</button>
    </footer>
  </section>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; background: #0009; }
  .dialog { width: min(55rem, 95vw); max-height: 90vh; overflow: auto; background: var(--theme-popup-color); color: var(--theme-content-color); padding: 1rem; border-radius: 0.6rem; }
  header, footer { display: flex; gap: 0.7rem; align-items: center; flex-wrap: wrap; }
  header h2 { flex: 1; margin: 0; font-size: 1.1rem; }
  footer { margin-top: 0.8rem; }
  .hint { opacity: 0.7; }
  .error { color: var(--theme-error-color); }
  .table-wrap { overflow: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 0.4rem; border-bottom: 1px solid var(--theme-divider-color); text-align: left; vertical-align: top; }
  td label { display: flex; gap: 0.4rem; align-items: flex-start; overflow-wrap: anywhere; }
  tr.differ td { background: rgba(255, 200, 0, 0.12); }
  button { color: var(--theme-content-color); background: var(--theme-button-default); border: 1px solid var(--theme-button-border); padding: 0.4rem 0.7rem; border-radius: 0.3rem; cursor: pointer; }
  button.primary { background: var(--theme-button-primary, #2f6fde); color: #fff; border-color: transparent; }
</style>
