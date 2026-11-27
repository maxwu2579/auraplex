<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<!-- Cards waiting for a person: saved automatically but the AI was unsure, a number matches another
     card, or only a switchboard number was read. Below: pairs of cards that look like duplicates. -->
<script lang="ts">
  import type { Ref } from '@hcengineering/core'
  import { translate, translateCB, type IntlString } from '@hcengineering/platform'
  import { createQuery, departmentModuleLevel, getClient } from '@hcengineering/presentation'
  import prospects, { duplicatePairs, type DuplicateWhy, type Prospect, type ProspectTemplate } from '@hcengineering/prospects'
  import { languageStore } from '@hcengineering/ui'
  import { prospectTemplateColumns } from '../xlsx'
  import { prospectFieldLabel, watchProspectTemplate } from '../templateFields'
  import { chinese } from '../trStore'
  import EditDialog from './EditDialog.svelte'
  import MergeDialog from './MergeDialog.svelte'

  $: canEdit = $departmentModuleLevel('prospects') === 'edit'
  const client = getClient()
  let all: Prospect[] = []
  createQuery().query(prospects.class.Prospect, {}, (docs) => { all = docs })
  let template: ProspectTemplate | undefined
  watchProspectTemplate((value) => { template = value })

  function localizer (language: string): (id: IntlString) => string {
    return (id) => {
      let value = ''
      translateCB(id, {}, language, (text) => { value = text })
      return value
    }
  }
  let local = localizer('en')
  async function updateLanguage (language: string): Promise<void> {
    await translate(prospects.string.PageLibrary, {}, language)
    if (language === $languageStore) local = localizer(language)
  }
  $: void updateLanguage($languageStore)
  $: columns = prospectTemplateColumns(template?.fields, (field) => prospectFieldLabel(field, local))
  $: labelOf = new Map(columns.map((column) => [column.field.key, column.label]))
  $: byId = new Map(all.map((card) => [card._id, card]))

  $: waiting = all.filter((card) => (card.review?.length ?? 0) > 0)
    .sort((a, b) => (b.createdOn ?? b.modifiedOn) - (a.createdOn ?? a.modifiedOn))
  $: pairs = duplicatePairs(all)

  $: reasonText = (reason: string): string => {
    if (reason.startsWith('field:')) {
      const key = reason.slice(6)
      return $chinese ? `AI 拿不准：${labelOf.get(key) ?? key}` : `AI unsure: ${labelOf.get(key) ?? key}`
    }
    if (reason.startsWith('dup:')) {
      const other = byId.get(reason.slice(4) as Ref<Prospect>)
      if (other === undefined) return $chinese ? '可能重复（那张已删除）' : 'Possible duplicate (that card was deleted)'
      return $chinese ? `可能和「${other.name} · ${other.company}」重复` : `May duplicate "${other.name} · ${other.company}"`
    }
    if (reason === 'switchboard') return $chinese ? '只有公司总机，没有手机和邮箱' : 'Only a company switchboard number, no mobile or email'
    return reason
  }
  $: whyText = (why: DuplicateWhy): string => why === 'email'
    ? ($chinese ? '同一个邮箱' : 'Same email')
    : why === 'phone' ? ($chinese ? '同一个电话' : 'Same phone') : ($chinese ? '同公司、名字很像' : 'Same company, similar name')

  let editing: Prospect | undefined
  let merging: { a: Prospect, b: Prospect } | undefined
  let error = ''
  async function confirm (card: Prospect): Promise<void> {
    try {
      await client.update(card, { review: [], recognitionConfirmed: true })
    } catch {
      error = $chinese ? '没有权限。' : 'No permission.'
    }
  }
  async function notSame (a: Prospect, b: Prospect): Promise<void> {
    try {
      await client.update(a, { notDuplicate: [...new Set([...(a.notDuplicate ?? []), b._id])] })
    } catch {
      error = $chinese ? '没有权限。' : 'No permission.'
    }
  }
  function compare (card: Prospect, reason: string): void {
    const other = byId.get(reason.slice(4) as Ref<Prospect>)
    if (other !== undefined) merging = { a: other, b: card }
  }
</script>

<div class="page">
  <h1>{$chinese ? '待核对' : 'To review'} <span class="count">{waiting.length}</span></h1>
  <p class="hint">{$chinese
    ? '批量自动存入时，AI 拿不准、电话或邮箱和别的名片撞了、或只读到公司总机的名片，会先存进来放在这里。点"打开核对"看原图改资料，保存后就不在这里了；没问题直接点"确认无误"。'
    : 'Cards saved automatically that need a look. Open one to check it against the photo; saving or "Looks right" removes it from this list.'}</p>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  <ul>
    {#each waiting as card (card._id)}
      <li>
        <b>{card.name || '—'}</b> <span>{card.company}</span>
        <ul class="reasons">
          {#each card.review ?? [] as reason}
            <li>{reasonText(reason)}
              {#if canEdit && reason.startsWith('dup:') && byId.has(reason.slice(4))}
                <button on:click={() => { compare(card, reason) }}>{$chinese ? '对照合并' : 'Compare'}</button>
              {/if}
            </li>
          {/each}
        </ul>
        {#if canEdit}
          <div class="buttons">
            <button on:click={() => { editing = card }}>{$chinese ? '打开核对' : 'Open to check'}</button>
            <button on:click={() => confirm(card)}>{$chinese ? '确认无误' : 'Looks right'}</button>
          </div>
        {/if}
      </li>
    {:else}
      <li class="hint">{$chinese ? '没有要核对的名片。' : 'Nothing to review.'}</li>
    {/each}
  </ul>

  <h2>{$chinese ? '可能重复' : 'Possible duplicates'} <span class="count">{pairs.length}</span></h2>
  <ul>
    {#each pairs as { a, b, why } (a._id + b._id)}
      <li class="pair">
        <span>{a.name || '—'} · {a.company}</span> ⇄ <span>{b.name || '—'} · {b.company}</span>
        <span class="tag">{whyText(why)}</span>
        {#if canEdit}
          <button on:click={() => { merging = { a, b } }}>{$chinese ? '对照合并' : 'Compare and merge'}</button>
          <button on:click={() => notSame(a, b)}>{$chinese ? '不是同一个人' : 'Not the same'}</button>
        {/if}
      </li>
    {:else}
      <li class="hint">{$chinese ? '没有发现重复。' : 'No duplicates found.'}</li>
    {/each}
  </ul>
</div>

{#if editing !== undefined}
  {#key editing._id}
    <EditDialog
      templateFields={template?.fields}
      value={all.find((card) => card._id === editing?._id) ?? editing}
      on:close={() => { editing = undefined }}
      on:saved={() => { editing = undefined }}
      on:openDuplicate={(e) => { editing = e.detail }}
    />
  {/key}
{/if}
{#if merging !== undefined}
  <MergeDialog a={merging.a} b={merging.b} {columns}
    on:close={() => { merging = undefined }}
    on:merged={() => { merging = undefined }} />
{/if}

<style>
  .page { padding: 1.5rem; overflow: auto; min-width: 0; color: var(--theme-content-color); max-width: 60rem; }
  h1, h2 { display: flex; gap: 0.5rem; align-items: center; font-size: 1.15rem; }
  h2 { margin-top: 1.6rem; }
  .count { border: 1px solid var(--theme-divider-color); border-radius: 1rem; padding: 0 0.5rem; font-size: 0.85rem; }
  .hint { opacity: 0.65; }
  .error { color: var(--theme-error-color); }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 0.6rem 0; border-bottom: 1px solid var(--theme-divider-color); }
  ul.reasons li { border: none; padding: 0.15rem 0 0.15rem 1rem; color: #c58a00; display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
  .pair { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
  .buttons { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.3rem; }
  .tag { border: 1px solid var(--theme-divider-color); border-radius: 0.4rem; padding: 0 0.4rem; font-size: 0.85rem; }
  button { color: var(--theme-content-color); background: var(--theme-button-default); border: 1px solid var(--theme-button-border); padding: 0.3rem 0.6rem; border-radius: 0.3rem; cursor: pointer; }
</style>
