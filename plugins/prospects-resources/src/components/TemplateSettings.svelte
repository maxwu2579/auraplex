<!-- Copyright © 2026 Auraplex. SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { generateId } from '@hcengineering/core'
  import { translate, translateCB, type IntlString } from '@hcengineering/platform'
  import { departmentModuleLevel, getClient } from '@hcengineering/presentation'
  import prospects, {
    isRequiredProspectField, orderedProspectFields, maxProspectFields, maxProspectFieldLabel,
    maxProspectFieldOptions, maxProspectOptionLength, prospectWriteScope, type ProspectFieldDef, type ProspectTemplate
  } from '@hcengineering/prospects'
  import { languageStore } from '@hcengineering/ui'
  import { t } from '../trStore'
  import { prospectFieldLabel, watchProspectTemplate } from '../templateFields'

  const client = getClient()
  let current: ProspectTemplate | undefined
  let revision: number | undefined
  let fields: ProspectFieldDef[] = []
  let removed: ProspectFieldDef[] = []
  let dirty = false
  let saving = false
  let error = ''
  $: canEdit = $departmentModuleLevel('prospects') === 'edit'
  let local: (label: IntlString) => string = () => ''

  async function loadLanguage (lang: string): Promise<void> {
    await translate(prospects.string.PageLibrary, {}, lang)
    if ($languageStore !== lang) return
    local = (label) => {
      let result = ''
      translateCB(label, {}, lang, (value) => { result = value })
      return result
    }
  }
  $: void loadLanguage($languageStore)

  function reset (): void {
    fields = orderedProspectFields(current?.fields)
    removed = [...(current?.removedFields ?? [])]
    revision = current?.modifiedOn
    dirty = false
    error = ''
  }
  watchProspectTemplate((template) => {
    current = template
    if (!dirty && !saving) reset()
  })

  function change (key: string, values: Partial<ProspectFieldDef>): void {
    fields = fields.map((field) => field.key === key ? { ...field, ...values } : field)
    dirty = true
  }

  function changeType (key: string, type: string): void {
    if (type === 'text' || type === 'date' || type === 'select') change(key, { type })
  }

  function move (index: number, direction: number): void {
    const next = [...fields]
    const target = index + direction
    const field = next[index]
    next[index] = next[target]
    next[target] = field
    fields = next
    dirty = true
  }

  function add (): void {
    fields = [...fields, { key: 'c_' + generateId(), builtin: false, label: '', type: 'text', hidden: false, order: fields.length }]
    dirty = true
  }

  function remove (field: ProspectFieldDef): void {
    fields = fields.filter(({ key }) => key !== field.key)
    removed = [...removed, field]
    dirty = true
  }

  function restore (field: ProspectFieldDef): void {
    fields = [...fields, { ...field, order: fields.length }]
    removed = removed.filter(({ key }) => key !== field.key)
    dirty = true
  }

  async function save (): Promise<void> {
    if (!canEdit || current === undefined || !dirty || saving) return
    const next = fields.map((field, order) => ({
      ...field,
      order,
      label: field.label.trim(),
      ...(field.type === 'select'
        ? { options: [...new Set((field.options ?? []).map((option) => option.trim()).filter(Boolean))] }
        : {})
    }))
    if (next.some((field) => !field.builtin && (field.label === '' ||
      (field.type === 'select' && ((field.options?.length ?? 0) === 0 ||
        (field.options?.length ?? 0) > maxProspectFieldOptions ||
        field.options?.some((option) => option.length > maxProspectOptionLength) === true))))) {
      error = $t('请填写新格子的名字，并为下拉格子填写有效选项。')
      return
    }
    saving = true
    error = ''
    try {
      const op = client.apply(prospectWriteScope)
      op.match(prospects.class.ProspectTemplate, { _id: current._id, space: current.space, modifiedOn: revision })
      await op.update(current, { fields: next, removedFields: removed })
      if (!(await op.commit()).result) {
        error = $t('模板已被其他人修改，请放弃本次改动后重试。')
        return
      }
      const updated = await client.findOne(prospects.class.ProspectTemplate, { _id: current._id, space: current.space })
      if (updated !== undefined) current = updated
      reset()
    } catch {
      error = $t('保存失败，请检查网络后重试。')
    } finally {
      saving = false
    }
  }
</script>

<div class="page">
  <h1>{$t('名片模板')}</h1>
  {#if !canEdit}
    <p>{$t('需要名片编辑权限才能修改模板。')}</p>
  {:else if current === undefined}
    <p>{$t('暂时无法读取名片模板，请刷新后再试。')}</p>
  {:else}
    {#if dirty}
      <div class="pending">
        <span>{$t('有改动还没保存')}</span>
        <button disabled={saving} on:click={save}>{$t('保存')}</button>
        <button disabled={saving} on:click={reset}>{$t('放弃')}</button>
      </div>
    {/if}
    {#if error !== ''}<p role="alert">{error}</p>{/if}
    {#each fields as field, index (field.key)}
      {@const label = prospectFieldLabel(field, local)}
      <fieldset disabled={saving}>
        <label>
          {$t('显示名字')}
          <input value={field.label} placeholder={field.builtin ? label : $t('显示名字')} maxlength={maxProspectFieldLabel}
            on:input={(event) => change(field.key, { label: event.currentTarget.value })} />
        </label>
        <label>
          {$t('类型')}
          <select disabled={field.builtin} value={field.type}
            on:change={(event) => changeType(field.key, event.currentTarget.value)}>
            <option value="text">{$t('文字')}</option>
            <option value="date">{$t('日期')}</option>
            <option value="select">{$t('下拉选项')}</option>
          </select>
        </label>
        <label class="inline">
          <input type="checkbox" checked={field.hidden} disabled={isRequiredProspectField(field.key)}
            on:change={(event) => change(field.key, { hidden: event.currentTarget.checked })} />
          {$t('隐藏')}
        </label>
        <div class="actions">
          <button disabled={index === 0} on:click={() => move(index, -1)}>{$t('上移')}</button>
          <button disabled={index === fields.length - 1} on:click={() => move(index, 1)}>{$t('下移')}</button>
          {#if !field.builtin}<button on:click={() => remove(field)}>{$t('删除')}</button>{/if}
        </div>
        {#if field.type === 'select'}
          <label class="options">
            {$t('选项（每行一个）')}
            <textarea rows="3" value={field.options?.join('\n') ?? ''}
              on:input={(event) => change(field.key, { options: event.currentTarget.value.split('\n') })}></textarea>
          </label>
        {/if}
      </fieldset>
    {/each}
    <button disabled={saving || fields.length >= maxProspectFields} on:click={add}>+ {$t('新加格子')}</button>
    {#if removed.length > 0}
      <details>
        <summary>{$t('恢复已删除的格子')}</summary>
        {#each removed as field (field.key)}
          <div class="actions">
            <span>{prospectFieldLabel(field, local)}</span>
            <button disabled={saving || fields.length >= maxProspectFields} on:click={() => restore(field)}>{$t('恢复')}</button>
          </div>
        {/each}
      </details>
    {/if}
  {/if}
</div>

<style>
  .page { padding: 1.5rem; min-width: 0; overflow: auto; color: var(--theme-content-color); }
  fieldset, .actions, .pending { display: flex; align-items: end; flex-wrap: wrap; gap: .5rem; }
  fieldset { margin: 0 0 .5rem; padding: .75rem; border: 1px solid var(--theme-divider-color); border-radius: .375rem; min-width: 0; }
  .pending { position: sticky; top: 0; z-index: 1; background: var(--theme-bg-color); padding: .75rem 0; align-items: center; }
  label { display: grid; gap: .25rem; min-width: 0; }
  .inline { display: flex; align-items: center; }
  .options { width: 100%; }
  input, select, textarea, button {
    max-width: 100%; padding: .375rem .5rem; color: var(--theme-content-color);
    background: var(--theme-button-default); border: 1px solid var(--theme-divider-color); border-radius: .375rem;
  }
  button:disabled { opacity: .55; }
  details { margin-top: .75rem; }
  [role='alert'] { color: var(--theme-error-color); }
</style>
