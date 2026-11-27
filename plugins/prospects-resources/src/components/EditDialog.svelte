<!-- Copyright © 2026 Auraplex. Licensed under EPL-2.0. -->
<script lang="ts">
  import { t } from '../trStore'
  import { translate, translateCB, type IntlString } from '@hcengineering/platform'
  import { languageStore } from '@hcengineering/ui'
  import { Label } from '@hcengineering/ui'

  import { departmentModuleLevel } from '@hcengineering/presentation'
  $: moduleCanEdit = $departmentModuleLevel('prospects') === 'edit'
  import attachment, { type Photo } from '@hcengineering/attachment'
  import core, { generateId, getCurrentAccount } from '@hcengineering/core'
  import { createQuery, getBlobRef, getClient, uploadFile } from '@hcengineering/presentation'
  import prospects, {
    findDuplicates,
    normalizeEmail,
    prospectWriteScope,
    type Prospect,
    type ProspectStatus,
    formatProspectFieldValue,
    isBuiltinProspectField,
    parseCustomProspectValue,
    readRecognizedProspectFields,
    visibleProspectFields,
    type ProspectFieldDef
  } from '@hcengineering/prospects'
  import { createEventDispatcher, onMount, onDestroy } from 'svelte'
  import { cardDraft, cardFields, compressed, recognize as recognizeCard, recognizerConfigured, type CardDraft } from '../cardSave'
  import { prospectFieldLabel } from '../templateFields'
  import ProspectLeadAction from './ProspectLeadAction.svelte'
  import MailPanel from './MailPanel.svelte'

  export let templateFields: readonly ProspectFieldDef[] | undefined = undefined
  export let value: Prospect | undefined = undefined
  export let initialFront: File | undefined = undefined
  export let initialBack: File | undefined = undefined
  const dispatch = createEventDispatcher()
  const client = getClient()
  const photoQuery = createQuery()
  let photos: Photo[] = []
  if (value !== undefined) {
    photoQuery.query(attachment.class.Photo, { attachedTo: value._id }, (items) => {
      photos = items
    })
  }
  let draft = cardDraft(value)
  let customDraft: Record<string, string> = {}
  let sourceDate = value?.sourceDate === undefined ? '' : new Date(value.sourceDate).toISOString().slice(0, 10)
  let status: ProspectStatus = value?.status ?? 'new'
  $: if (value?.lead != null) status = 'converted'
  let front: File | undefined = initialFront
  let back: File | undefined = initialBack
  let busy = false
  let error = ''
  let warning = ''
  let duplicate: Prospect | undefined
  let configured = false
  let statusMessage = $t('正在检查识别服务…')
  let model = value?.recognitionModel
  let recognizedAt = value?.recognizedAt
  let review: string[] = []
  function needsReview (key: string): boolean {
    return review.some((item) => item === key)
  }
  let recognized = false
  let photoChanged = false
  let preview: string | undefined
  let frontPreview = initialFront === undefined ? '' : URL.createObjectURL(initialFront)
  let backPreview = initialBack === undefined ? '' : URL.createObjectURL(initialBack)
  function choose (side: 'front' | 'back', file?: File): void {
    photoChanged = true
    recognized = false
    model = undefined
    recognizedAt = undefined
    review = []
    if (side === 'front') {
      if (frontPreview !== '') URL.revokeObjectURL(frontPreview)
      front = file
      frontPreview = file === undefined ? '' : URL.createObjectURL(file)
    } else {
      if (backPreview !== '') URL.revokeObjectURL(backPreview)
      back = file
      backPreview = file === undefined ? '' : URL.createObjectURL(file)
    }
  }
  onDestroy(() => {
    if (frontPreview !== '') URL.revokeObjectURL(frontPreview)
    if (backPreview !== '') URL.revokeObjectURL(backPreview)
  })
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
  $: fields = visibleProspectFields(templateFields)

  function customValue (field: ProspectFieldDef, edits: Record<string, string>, stored: Prospect['custom']): string {
    return edits[field.key] ?? formatProspectFieldValue(stored?.[field.key], field.type)
  }

  function updateCustom (key: string, value: string): void {
    customDraft = { ...customDraft, [key]: value }
  }
  onMount(async () => {
    try {
      configured = await recognizerConfigured()
      statusMessage = configured ? '' : $t('识别服务未配置')
    } catch {
      configured = false
      statusMessage = $t('识别服务连不上')
    }
  })
  async function recognize (): Promise<void> {
    if (!configured || front === undefined || busy) return
    busy = true
    error = ''
    review = []
    try {
      const specs = cardFields(templateFields, local)
      const data = await recognizeCard([front, ...(back === undefined ? [] : [back])], specs)
      const extracted = readRecognizedProspectFields(specs, data.values)
      draft = { ...draft, ...extracted.builtin }
      for (const field of specs) {
        const value = extracted.custom[field.key]
        if (value !== undefined) updateCustom(field.key, formatProspectFieldValue(value, field.type))
      }
      review = data.needsReview
      model = data.model
      recognizedAt = data.recognizedAt
      recognized = true
    } catch (e) {
      const internal = ['canvas', 'compress', 'read', 'recognize']
      error = e instanceof Error && !internal.includes(e.message) ? $t(e.message) : $t('识别服务连不上')
    } finally {
      busy = false
    }
  }
  function builtinEdits (): Partial<CardDraft> {
    const edits: Partial<CardDraft> = {}
    for (const { key } of fields) {
      if (isBuiltinProspectField(key)) edits[key] = draft[key]
    }
    return edits
  }

  function draftForSave (): CardDraft {
    // Hidden built-ins retain their stored values and still participate in duplicate checks.
    return { ...cardDraft(value), ...builtinEdits() }
  }

  async function checkDuplicates (): Promise<void> {
    const all = await client.findAll(prospects.class.Prospect, {})
    const found = findDuplicates(draftForSave(), all, value?._id)
    duplicate = found.email
    warning =
      found.phones.length > 0
        ? `电话可能重复：${found.phones.map((p) => `${p.name}（${p.company}）`).join('、')}；仍可保存。`
        : ''
  }
  async function checkDuplicatesSafe (): Promise<void> {
    try {
      await checkDuplicates()
    } catch {
      warning = $t('查重暂不可用，保存时会再检查。')
    }
  }
  async function save (): Promise<void> {
    if (busy) return
    error = ''
    busy = true
    try {
      await checkDuplicates()
      if (duplicate !== undefined) {
        error = $t('邮箱已存在，请查看已有记录。')
        return
      }
      if (warning !== '' && !window.confirm(`${warning}\n仍要保存吗？`)) return
      if (front === undefined && !photos.some((photo) => photo.name === 'front.jpg')) {
        error = $t('请上传名片正面。')
        return
      }
      const stored = draftForSave()
      const normalizedEmail = normalizeEmail(stored.email)
      const id = value?._id ?? generateId<Prospect>()
      const ops = client.apply(prospectWriteScope)
      if (normalizedEmail !== '') {
        ops.notMatch(prospects.class.Prospect, {
          normalizedEmail,
          ...(value === undefined ? {} : { _id: { $ne: id } })
        })
      }
      const custom = { ...value?.custom }
      let hasCustomEdits = false
      for (const field of fields) {
        const edit = customDraft[field.key]
        if (field.builtin || edit === undefined) continue
        hasCustomEdits = true
        const changed = parseCustomProspectValue(field, edit)
        if (changed === undefined) {
          // An option may have been removed while this dialog was open.
          if (edit.trim() !== '') continue
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete custom[field.key]
        } else custom[field.key] = changed
      }
      if (value !== undefined && hasCustomEdits) {
        ops.match(prospects.class.Prospect, { _id: id, modifiedOn: value.modifiedOn })
      }
      const data = {
        ...builtinEdits(),
        ...(hasCustomEdits ? { custom } : {}),
        ...(fields.some(({ key }) => key === 'email') ? { normalizedEmail } : {}),
        ...(value?.lead == null && status !== 'converted' ? { status } : {}),
        ...(sourceDate === '' ? {} : { sourceDate: new Date(`${sourceDate}T12:00:00`).getTime() }),
        ...(recognized && model !== undefined
          ? {
              recognitionModel: model,
              recognizedAt,
              recognitionBy: getCurrentAccount().uuid,
              recognitionConfirmed: true
            }
          : {})
      }
      if (value === undefined) {
        await ops.createDoc(
          prospects.class.Prospect,
          core.space.Workspace,
          { ...stored, ...data, normalizedEmail, status, emailCount: 0, recognitionConfirmed: recognized, photos: 0 },
          id
        )
      } else {
        if (value.lead == null && status !== 'converted') {
          ops.match(prospects.class.Prospect, { _id: id, lead: { $exists: false } })
        }
        const unset = {
          ...(sourceDate === '' ? { sourceDate: true } : {}),
          ...(photoChanged && !recognized ? { recognitionModel: true, recognizedAt: true, recognitionBy: true } : {})
        }
        await ops.update(value, {
          ...data,
          ...(photoChanged && !recognized ? { recognitionConfirmed: false } : {})
        })
        // The server ignores $unset when it is mixed with plain fields, so send it on its own.
        if (Object.keys(unset).length > 0) await ops.update(value, { $unset: unset })
      }
      for (const [side, file] of [
        ['front', front],
        ['back', back]
      ] as Array<[string, File | undefined]>) {
        if (file === undefined) continue
        const jpg = await compressed(file)
        const { uuid, metadata } = await uploadFile(jpg)
        for (const old of photos.filter((photo) => photo.name === `${side}.jpg`)) await ops.remove(old)
        await ops.addCollection(
          attachment.class.Photo,
          value?.space ?? core.space.Workspace,
          id,
          prospects.class.Prospect,
          'photos',
          { name: `${side}.jpg`, file: uuid, type: jpg.type, size: jpg.size, lastModified: Date.now(), metadata }
        )
      }
      if (!(await ops.commit()).result) {
        if (normalizedEmail !== '') duplicate = await client.findOne(prospects.class.Prospect, { normalizedEmail })
        error =
          duplicate !== undefined && duplicate._id !== id
            ? $t('邮箱已存在，请查看已有记录。')
            : $t('资料发生变化，请重新打开后再试。')
        return
      }
      dispatch('saved')
    } catch {
      error = $t('保存失败，请检查网络后重试。')
    } finally {
      busy = false
    }
  }
</script>

<div class="overlay" role="presentation">
  <section class="dialog" role="dialog" aria-modal="true" aria-label={$t('名片核对')}>
    <header>
      <h2>{value === undefined ? $t('新增潜在客户') : $t('客户资料')}</h2>
      <button disabled={busy} on:click={() => dispatch('close')}><Label label={prospects.string.PageClose} /></button>
    </header>
    <div class="images">
      <div class="pick">
        <Label label={prospects.string.PageRequiredFront} />
        <label class="file" class:disabled={busy}
          >{front !== undefined || photos.some((p) => p.name === 'front.jpg') ? $t('更换照片') : $t('选择照片')}<input
            disabled={busy}
            type="file"
            accept="image/*"
            capture="environment"
            on:change={(e) => {
              choose('front', e.currentTarget.files?.[0])
            }}
          /></label
        >
        <span class="picked"
          >{front?.name ?? (photos.some((p) => p.name === 'front.jpg') ? $t('已有照片') : $t('还没选'))}</span
        >
      </div>
      <div class="pick">
        <Label label={prospects.string.PageOptionalBack} />
        <label class="file" class:disabled={busy}
          >{back !== undefined || photos.some((p) => p.name === 'back.jpg') ? $t('更换照片') : $t('选择照片')}<input
            disabled={busy}
            type="file"
            accept="image/*"
            capture="environment"
            on:change={(e) => {
              choose('back', e.currentTarget.files?.[0])
            }}
          /></label
        >
        <span class="picked"
          >{back?.name ?? (photos.some((p) => p.name === 'back.jpg') ? $t('已有照片') : $t('还没选'))}</span
        >
      </div>
      {#if frontPreview}<button on:click={() => (preview = frontPreview)}
          ><img class="thumb" src={frontPreview} alt={$t('待核对的正面')} /></button
        >{/if}{#if backPreview}<button on:click={() => (preview = backPreview)}
          ><img class="thumb" src={backPreview} alt={$t('待核对的背面')} /></button
        >{/if}
      {#each photos as photo (photo._id)}{#await getBlobRef(photo.file, photo.name) then image}<button
            on:click={() => (preview = image.src)}>{photo.name === 'front.jpg' ? $t('查看正面') : $t('查看背面')}</button
          >{/await}{/each}
    </div>
    <button disabled={busy || !configured || front === undefined} on:click={recognize}><Label label={prospects.string.PageRecognize} /></button
    >{#if statusMessage !== ''}<span>{statusMessage}</span>{/if}
    <p><Label label={prospects.string.PageReviewHelp} /></p>
    <div class="fields">
      {#each fields as field (field.key)}
        {@const custom = customValue(field, customDraft, value?.custom)}
        <label>
          {prospectFieldLabel(field, local)}
          {#if needsReview(field.key)}<strong><Label label={prospects.string.PageVerify} /></strong>{/if}
          {#if isBuiltinProspectField(field.key)}
            <input disabled={busy} bind:value={draft[field.key]} on:change={checkDuplicatesSafe} />
          {:else if field.type === 'select'}
            <select disabled={busy} value={custom} on:change={(event) => updateCustom(field.key, event.currentTarget.value)}>
              <option value=""></option>
              {#if custom !== '' && !field.options?.includes(custom)}<option value={custom}>{custom}</option>{/if}
              {#each field.options ?? [] as option (option)}<option value={option}>{option}</option>{/each}
            </select>
          {:else if field.type === 'date'}
            <input type="date" disabled={busy} value={custom} on:input={(event) => updateCustom(field.key, event.currentTarget.value)} />
          {:else}
            <input disabled={busy} value={custom} on:input={(event) => updateCustom(field.key, event.currentTarget.value)} />
          {/if}
        </label>
      {/each}
      <label><Label label={prospects.string.PageSourceDate} /><input disabled={busy} type="date" bind:value={sourceDate} /></label>
      <label
        ><Label label={prospects.string.PageStatus} /><select disabled={busy || status === 'converted'} bind:value={status}
          ><option value="new">{local(prospects.string.PageNew)}</option><option value="sent">{local(prospects.string.PageSent)}</option><option value="replied"
            >{local(prospects.string.PageReplied)}</option
          ><option value="do-not-send">{local(prospects.string.PageOptOut)}</option><option value="bounced">{local(prospects.string.PageBounced)}</option>{#if status === 'converted'}
            <option value="converted">{local(prospects.string.PageConverted)}</option>
          {/if}</select
        ></label
      >
    </div>
    <p>
      最后发邮件：{value?.lastEmailAt === undefined
        ? '—'
        : new Date(value.lastEmailAt).toLocaleString()}；发送次数：{value?.emailCount ?? 0}
    </p>
    <p>
      识别模型：{model ?? '—'}；识别时间：{recognizedAt === undefined
        ? '—'
        : new Date(recognizedAt).toLocaleString()}；人工确认：{recognized
          ? $t('保存后确认')
          : value?.recognitionConfirmed === true
            ? $t('是')
            : $t('否')}
    </p>
    {#if warning}<p>{warning}</p>{/if}{#if error}<p role="alert">{error}</p>{/if}{#if duplicate}<button
        on:click={() => dispatch('openDuplicate', duplicate)}
        >查看已有记录：{duplicate.name} · {duplicate.company}</button
      >{/if}
    <footer><button disabled={busy || !moduleCanEdit} on:click={save}>{busy ? $t('处理中…') : $t('确认保存')}</button></footer>
    {#if value !== undefined}
      <ProspectLeadAction {value} {templateFields} canEdit={moduleCanEdit} disabled={busy}
        on:converted={() => { status = 'converted' }}
        on:opened={() => dispatch('close')} />
      <MailPanel {value} />
    {/if}
  </section>
  {#if preview}<div class="preview" role="presentation" on:click|self={() => (preview = undefined)}>
      <button on:click={() => (preview = undefined)}><Label label={prospects.string.PageClose} /></button><img src={preview} alt={$t('名片大图')} />
    </div>{/if}
</div>

<style>
  .overlay,
  .preview {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0009;
  }
  .dialog {
    width: min(65rem, 95vw);
    max-height: 90vh;
    overflow: auto;
    background: var(--theme-popup-color);
    color: var(--theme-content-color);
    padding: 1rem;
    border-radius: 0.6rem;
  }
  header,
  footer,
  .images {
    display: flex;
    gap: 0.7rem;
    align-items: center;
    flex-wrap: wrap;
  }
  header h2 {
    flex: 1;
  }
  footer {
    justify-content: flex-end;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 0.7rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  input,
  select,
  button {
    color: var(--theme-content-color);
    background: var(--theme-button-default);
    border: 1px solid var(--theme-button-border);
    padding: 0.45rem;
    border-radius: 0.3rem;
  }
  button {
    cursor: pointer;
  }
  strong {
    color: var(--theme-error-color);
  }
  .preview {
    z-index: 1100;
    flex-direction: column;
  }
  .preview img {
    max-width: 90vw;
    max-height: 80vh;
    object-fit: contain;
  }
  .pick {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 12rem;
  }
  .file {
    display: inline-block;
    width: fit-content;
    cursor: pointer;
    background: var(--theme-button-default);
    border: 1px solid var(--theme-button-border);
    padding: 0.45rem 0.8rem;
    border-radius: 0.3rem;
  }
  .file.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
  .file input {
    display: none;
  }
  .picked {
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.8;
  }
  .thumb {
    max-width: 14rem;
    max-height: 9rem;
    object-fit: contain;
  }
</style>
