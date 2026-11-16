<!-- Copyright © 2026 Auraplex. Licensed under EPL-2.0. -->
<script lang="ts">
  import attachment, { type Photo } from '@hcengineering/attachment'
  import core, { generateId, getCurrentAccount } from '@hcengineering/core'
  import { getMetadata } from '@hcengineering/platform'
  import presentation, { createQuery, getBlobRef, getClient, uploadFile } from '@hcengineering/presentation'
  import prospects, {
    findDuplicates,
    normalizeEmail,
    type Prospect,
    type ProspectStatus,
    type RecognitionField
  } from '@hcengineering/prospects'
  import { createEventDispatcher, onMount, onDestroy } from 'svelte'

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
  let draft = {
    name: value?.name ?? '',
    company: value?.company ?? '',
    title: value?.title ?? '',
    mobile: value?.mobile ?? '',
    phone: value?.phone ?? '',
    email: value?.email ?? '',
    website: value?.website ?? '',
    address: value?.address ?? '',
    country: value?.country ?? '',
    industry: value?.industry ?? '',
    source: value?.source ?? '',
    notes: value?.notes ?? ''
  }
  let sourceDate = value?.sourceDate === undefined ? '' : new Date(value.sourceDate).toISOString().slice(0, 10)
  let status: ProspectStatus = value?.status ?? 'new'
  let front: File | undefined = initialFront
  let back: File | undefined = initialBack
  let busy = false
  let error = ''
  let warning = ''
  let duplicate: Prospect | undefined
  let configured = false
  let statusMessage = '正在检查识别服务…'
  let model = value?.recognitionModel
  let recognizedAt = value?.recognizedAt
  let review: RecognitionField[] = []
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
  const fields: Array<{ key: keyof typeof draft, label: string }> = [
    { key: 'name', label: '姓名' },
    { key: 'company', label: '公司' },
    { key: 'title', label: '职位' },
    { key: 'mobile', label: '手机' },
    { key: 'phone', label: '电话' },
    { key: 'email', label: '邮箱' },
    { key: 'website', label: '网站' },
    { key: 'address', label: '地址' },
    { key: 'country', label: '国家' },
    { key: 'industry', label: '行业' },
    { key: 'source', label: '来源' },
    { key: 'notes', label: '备注' }
  ]
  const headers = (): Record<string, string> => ({
    Authorization: 'Bearer ' + (getMetadata(presentation.metadata.Token) ?? ''),
    'Content-Type': 'application/json'
  })
  onMount(async () => {
    try {
      const res = await fetch('/prospects-api/status', { headers: headers() })
      if (!res.ok) {
        statusMessage = '识别服务连不上'
        return
      }
      configured = (await res.json()).configured === true
      statusMessage = configured ? '' : '识别服务未配置'
    } catch {
      configured = false
      statusMessage = '识别服务连不上'
    }
  })
  async function compressed (file: File): Promise<File> {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (context === null) {
      bitmap.close()
      throw new Error('无法处理图片')
    }
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.85)
    })
    if (blob === null) throw new Error('图片压缩失败')
    return new File([blob], 'card.jpg', { type: 'image/jpeg' })
  }
  async function readUrl (file: File): Promise<string> {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        resolve(String(reader.result))
      }
      reader.onerror = () => {
        reject(new Error('图片读取失败'))
      }
      reader.readAsDataURL(file)
    })
  }
  async function recognize (): Promise<void> {
    if (!configured || front === undefined || busy) return
    busy = true
    error = ''
    review = []
    try {
      const images = await Promise.all(
        [front, ...(back === undefined ? [] : [back])].map(async (file) => await readUrl(await compressed(file)))
      )
      const res = await fetch('/prospects-api/recognize', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ images })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : '识别服务连不上')
      draft = { ...draft, ...data.values }
      review = data.needsReview
      model = data.model
      recognizedAt = data.recognizedAt
      recognized = true
    } catch (e) {
      error = e instanceof Error ? e.message : '识别服务连不上'
    } finally {
      busy = false
    }
  }
  async function checkDuplicates (): Promise<void> {
    const all = await client.findAll(prospects.class.Prospect, {})
    const found = findDuplicates(draft, all, value?._id)
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
      warning = '查重暂不可用，保存时会再检查。'
    }
  }
  async function save (): Promise<void> {
    if (busy) return
    error = ''
    busy = true
    try {
      await checkDuplicates()
      if (duplicate !== undefined) {
        error = '邮箱已存在，请查看已有记录。'
        return
      }
      if (warning !== '' && !window.confirm(`${warning}\n仍要保存吗？`)) return
      if (front === undefined && !photos.some((photo) => photo.name === 'front.jpg')) {
        error = '请上传名片正面。'
        return
      }
      const normalizedEmail = normalizeEmail(draft.email)
      const id = value?._id ?? generateId<Prospect>()
      const ops = client.apply('prospects-email')
      if (normalizedEmail !== '') {
        ops.notMatch(prospects.class.Prospect, {
          normalizedEmail,
          ...(value === undefined ? {} : { _id: { $ne: id } })
        })
      }
      const data = {
        ...draft,
        normalizedEmail,
        status,
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
          { ...data, emailCount: 0, recognitionConfirmed: recognized, photos: 0 },
          id
        )
      } else {
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
            ? '邮箱已存在，请查看已有记录。'
            : '资料发生变化，请重新打开后再试。'
        return
      }
      dispatch('saved')
    } catch {
      error = '保存失败，请检查网络后重试。'
    } finally {
      busy = false
    }
  }
</script>

<div class="overlay" role="presentation">
  <section class="dialog" role="dialog" aria-modal="true" aria-label="名片核对">
    <header>
      <h2>{value === undefined ? '新增潜在客户' : '客户资料'}</h2>
      <button disabled={busy} on:click={() => dispatch('close')}>关闭</button>
    </header>
    <div class="images">
      <label
        >正面（必填）<input
          disabled={busy}
          type="file"
          accept="image/*"
          capture="environment"
          on:change={(e) => {
            choose('front', e.currentTarget.files?.[0])
          }}
        /></label
      ><label
        >背面（可选）<input
          disabled={busy}
          type="file"
          accept="image/*"
          capture="environment"
          on:change={(e) => {
            choose('back', e.currentTarget.files?.[0])
          }}
        /></label
      >
      {#if frontPreview}<button on:click={() => (preview = frontPreview)}
          ><img class="thumb" src={frontPreview} alt="待核对的正面" /></button
        >{/if}{#if backPreview}<button on:click={() => (preview = backPreview)}
          ><img class="thumb" src={backPreview} alt="待核对的背面" /></button
        >{/if}
      {#each photos as photo (photo._id)}{#await getBlobRef(photo.file, photo.name) then image}<button
            on:click={() => (preview = image.src)}>{photo.name === 'front.jpg' ? '查看正面' : '查看背面'}</button
          >{/await}{/each}
      {#if front}<span>正面已选择：{front.name}</span>{/if}{#if back}<span>背面已选择：{back.name}</span>{/if}
    </div>
    <button disabled={busy || !configured || front === undefined} on:click={recognize}>AI 识别</button
    >{#if statusMessage !== ''}<span>{statusMessage}</span>{/if}
    <p>识别后请核对或修改，再点击保存。</p>
    <div class="fields">
      {#each fields as field}<label
          >{field.label}{#if needsReview(field.key)}
            <strong>请核对</strong>{/if}<input
            disabled={busy}
            bind:value={draft[field.key]}
            on:change={checkDuplicatesSafe}
          /></label
        >{/each}
      <label>来源日期<input disabled={busy} type="date" bind:value={sourceDate} /></label>
      <label
        >状态<select disabled={busy} bind:value={status}
          ><option value="new">未联系</option><option value="sent">已发邮件</option><option value="replied"
            >已回复</option
          ><option value="do-not-send">不要再发</option><option value="bounced">邮件退回</option></select
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
          ? '保存后确认'
          : value?.recognitionConfirmed === true
            ? '是'
            : '否'}
    </p>
    {#if warning}<p>{warning}</p>{/if}{#if error}<p role="alert">{error}</p>{/if}{#if duplicate}<button
        on:click={() => dispatch('openDuplicate', duplicate)}
        >查看已有记录：{duplicate.name} · {duplicate.company}</button
      >{/if}
    <footer><button disabled={busy} on:click={save}>{busy ? '处理中…' : '确认保存'}</button></footer>
  </section>
  {#if preview}<div class="preview" role="presentation" on:click|self={() => (preview = undefined)}>
      <button on:click={() => (preview = undefined)}>关闭</button><img src={preview} alt="名片大图" />
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
  .thumb {
    max-width: 14rem;
    max-height: 9rem;
    object-fit: contain;
  }
</style>
