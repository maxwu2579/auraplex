<script lang="ts">
  import { chinese, t } from '../trStore'
  import { translate, translateCB, type IntlString } from '@hcengineering/platform'
  import { languageStore } from '@hcengineering/ui'
  import { Label } from '@hcengineering/ui'

  import { departmentModuleLevel } from '@hcengineering/presentation'
  $: moduleCanEdit = $departmentModuleLevel('prospects') === 'edit'
  import { isOwnerOrMaintainer } from '@hcengineering/core'
  import time, { type ToDo } from '@hcengineering/time'
  import prospects, { introCandidates, marketingEmail, type MailAutomation, type Prospect, type ProspectMail, type ProspectStatus, type ProspectTemplate } from '@hcengineering/prospects'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { createWorkbook, datedFilename, downloadWorkbook, prospectTemplateColumns } from '../xlsx'
  import { recordExport } from '../audit'
  import { prospectFilter } from '../filter'
  import ProspectLeadAction from './ProspectLeadAction.svelte'
  import EditDialog from './EditDialog.svelte'
  import ImportDialog from './ImportDialog.svelte'
  import { prospectFieldLabel, watchProspectTemplate } from '../templateFields'
  import { autoSaveCard, cardFields, recognizerConfigured, type AutoSaveResult } from '../cardSave'
  import { onMount } from 'svelte'
  const query = createQuery()
  const client = getClient()
  let all: Prospect[] = []
  let automation: MailAutomation | undefined
  let outgoing: ProspectMail[] = []
  let openFollowUps: ToDo[] = []
  createQuery().query(prospects.class.MailAutomation, { _id: prospects.ids.MailAutomation }, (docs) => { automation = docs[0] })
  createQuery().query(prospects.class.ProspectMail, { direction: 'outgoing' }, (docs) => { outgoing = docs })
  createQuery().query(time.class.ToDo, { attachedToClass: prospects.class.Prospect, collection: 'replyFollowUps', doneOn: null },
    (docs) => { openFollowUps = docs })
  $: replyPending = new Set(openFollowUps.map((item) => item.attachedTo))
  $: introQueued = new Set(automation?.enrolledFrom === undefined ? [] : introCandidates(
    all, automation.enrolledFrom, new Set(automation.removed), new Set(outgoing.map((mail) => mail.attachedTo))
  ).map((item) => item._id))
  $: campaign = automation?.campaign
  $: campaignSent = new Set(outgoing.filter((mail) => mail.campaign === campaign?.id && mail.campaign !== undefined).map((mail) => mail.attachedTo))
  $: campaignQueued = new Set(campaign?.status === 'active' || campaign?.status === 'paused'
    ? campaign.customers.filter((id) => !campaign.removed.includes(id) && !campaignSent.has(id)) : [])
  $: autoSent = new Set(outgoing.filter((mail) => mail.automation !== undefined && mail.delivery === 'sent').map((mail) => mail.attachedTo))
  let template: ProspectTemplate | undefined
  let templateReady = false
  watchProspectTemplate((value) => {
    template = value
    templateReady = true
  })
  $: columns = prospectTemplateColumns(template?.fields, (field) => prospectFieldLabel(field, local))
  $: searchColumns = columns.filter(({ field }) => field.type === 'text')
  $: columnsByKey = new Map(columns.map((column) => [column.field.key, column]))
  $: sourceColumn = columnsByKey.get('source')
  $: countryColumn = columnsByKey.get('country')
  $: industryColumn = columnsByKey.get('industry')
  let search = ''
  let status = ''
  let source = ''
  let country = ''
  let industry = ''
  let period = ''
  let sort = 'name'
  let ascending = true
  let editing = false
  let importing = false
  let selected: Prospect | undefined
  let queue: File[] = []
  let frontIndex = 0
  let backIndex = -1
  let fromQueue = false
  let error = ''
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
  let statuses: Record<ProspectStatus, string>
  $: statuses = {
    new: local(prospects.string.PageNew),
    sent: local(prospects.string.PageSent),
    replied: local(prospects.string.PageReplied),
    'do-not-send': local(prospects.string.PageOptOut),
    bounced: local(prospects.string.PageBounced),
    converted: local(prospects.string.PageConverted)
  }
  query.query(prospects.class.Prospect, {}, (items) => {
    all = items
  })
  $: if ($prospectFilter.field !== undefined) {
    const filter = $prospectFilter
    status = filter.field === 'status' ? (filter.value ?? '') : ''
    source = filter.field === 'source' ? (filter.value ?? '') : ''
    country = filter.field === 'country' ? (filter.value ?? '') : ''
    industry = filter.field === 'industry' ? (filter.value ?? '') : ''
    period = filter.field === 'period' ? (filter.value ?? '') : ''
    prospectFilter.set({})
  }
  $: sources = Array.from(new Set(all.map((p) => p.source).filter(Boolean))).sort()
  $: countries = Array.from(new Set(all.map((p) => p.country).filter(Boolean))).sort()
  $: industries = Array.from(new Set(all.map((p) => p.industry).filter(Boolean))).sort()
  function inPeriod (p: Prospect, period: string): boolean {
    if (period === '') return true
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), period === 'month' ? 1 : now.getDate())
    if (period === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    return (p.createdOn ?? p.modifiedOn) >= start.getTime() && (p.createdOn ?? p.modifiedOn) <= now.getTime()
  }
  function matches (value: string, filter: string): boolean {
    return filter === '' || (filter === $t('未填写') ? value === '' : value === filter)
  }
  $: visible = all
    .filter(
      (p) =>
        searchColumns.map((column) => column.read(p))
          .join(' ').toLowerCase().includes(search.trim().toLowerCase()) &&
        (status === 'reply-pending' ? replyPending.has(p._id) : matches(p.status, status)) &&
        (sourceColumn === undefined || matches(p.source, source)) &&
        (countryColumn === undefined || matches(p.country, country)) &&
        (industryColumn === undefined || matches(p.industry, industry)) &&
        inPeriod(p, period)
    )
    .sort((a, b) => {
      const column = columnsByKey.get(sort) ?? columnsByKey.get('name')
      const first = sort === 'status' ? a.status : column?.read(a) ?? ''
      const second = sort === 'status' ? b.status : column?.read(b) ?? ''
      return first.localeCompare(second, undefined, { numeric: true }) * (ascending ? 1 : -1)
    })
  function order (key: string): void {
    if (sort === key) ascending = !ascending
    else {
      sort = key
      ascending = true
    }
  }
  function edit (p?: Prospect): void {
    selected = p
    fromQueue = false
    editing = true
  }
  // Batch upload can save cards straight away (front only, read by the card AI) instead of one-by-one review.
  const autoKey = 'auraplex.prospects.autoSave'
  let aiReady = false
  let autoSave = localStorage.getItem(autoKey) === '1'
  $: localStorage.setItem(autoKey, autoSave ? '1' : '0')
  let autoBusy = false
  let autoDone = 0
  let autoTotal = 0
  let autoReport = ''
  onMount(async () => {
    try {
      aiReady = await recognizerConfigured()
    } catch {
      aiReady = false
    }
  })
  async function autoSaveAll (files: File[]): Promise<void> {
    autoBusy = true
    autoDone = 0
    autoTotal = files.length
    autoReport = ''
    const left: File[] = []
    const counts: Record<AutoSaveResult, number> = { saved: 0, review: 0, empty: 0, duplicate: 0, 'same-photo': 0, failed: 0 }
    const fields = cardFields(template?.fields, local)
    for (const file of files) {
      const result = await autoSaveCard(file, fields, all)
      counts[result]++
      if (result !== 'saved' && result !== 'review' && result !== 'same-photo') left.push(file)
      autoDone++
    }
    queue = [...queue, ...left]
    frontIndex = 0
    backIndex = -1
    autoBusy = false
    autoReport = $chinese
      ? `已自动存入 ${counts.saved + counts.review} 张` +
        (counts.review > 0 ? `（其中 ${counts.review} 张放进了"待核对"）` : '') +
        (counts['same-photo'] > 0 ? `；${counts['same-photo']} 张照片以前存过，没有再存` : '') +
        (left.length > 0
          ? `；${left.length} 张要人工核对（读不出名字 ${counts.empty}，邮箱已存在 ${counts.duplicate}，出错 ${counts.failed}），在下面选正面后点"核对这张名片"。`
          : '。')
      : `Saved ${counts.saved + counts.review} automatically` +
        (counts.review > 0 ? ` (${counts.review} put on the review list)` : '') +
        (counts['same-photo'] > 0 ? `; ${counts['same-photo']} photos were saved before and skipped` : '') +
        (left.length > 0
          ? `; ${left.length} need checking (no name read ${counts.empty}, email exists ${counts.duplicate}, errors ${counts.failed}). Pick them below and check them.`
          : '.')
  }
  function addFiles (files: FileList | null): void {
    if (files === null || files.length === 0) return
    if (autoSave && aiReady && templateReady && !autoBusy) {
      void autoSaveAll(Array.from(files))
      return
    }
    queue = [...queue, ...Array.from(files)]
    frontIndex = 0
    backIndex = -1
  }
  function queueEdit (): void {
    if (queue[frontIndex] === undefined || backIndex === frontIndex) return
    selected = undefined
    fromQueue = true
    editing = true
  }
  function saved (): void {
    editing = false
    if (fromQueue) queue = queue.filter((_, index) => index !== frontIndex && index !== backIndex)
    frontIndex = 0
    backIndex = -1
    fromQueue = false
  }
  async function remove (p: Prospect): Promise<void> {
    if (!isOwnerOrMaintainer() || !window.confirm(($chinese ? `删除 ${p.name}？` : `Delete ${p.name}?`))) return
    try {
      await client.remove(p)
    } catch {
      error = $t('删除失败，请检查权限后重试。')
    }
  }
  function exportList (): void {
    const displayTime = (time?: number): string => (time === undefined ? '' : new Date(time).toLocaleString())
    const rows = visible.map((p) => [
      ...columns.map((column) => column.read(p)),
      displayTime(p.sourceDate),
      statuses[p.status] ?? p.status,
      displayTime(p.lastEmailAt),
      p.emailCount ?? 0,
      p.recognitionModel ?? '',
      displayTime(p.recognizedAt),
      p.recognitionConfirmed ? local(prospects.string.PageYes) : local(prospects.string.PageNo)
    ])
    downloadWorkbook(
      createWorkbook([
        {
          name: local(prospects.string.PageProspects),
          rows: [
            [
              ...columns.map((column) => column.label),
              local(prospects.string.PageSourceDate),
              local(prospects.string.PageStatus),
              local(prospects.string.PageLastEmail),
              local(prospects.string.PageSendCount),
              local(prospects.string.PageModel),
              local(prospects.string.PageRecognizedAt),
              local(prospects.string.PageConfirmed)
            ],
            ...rows
          ]
        }
      ]),
      datedFilename(local(prospects.string.PageProspects), '', new Date())
    )
    void recordExport(($chinese ? `导出名片 Excel（${visible.length} 条）` : `Export cards Excel (${visible.length})`))
  }
</script>

<div class="page">
  <header>
    <h1><Label label={prospects.string.PageLibrary} /></h1>
    {#if moduleCanEdit}<button
      on:click={() => {
        edit()
      }}><Label label={prospects.string.PageAdd} /></button
    ><label class="upload"
      ><Label label={prospects.string.PageUpload} /><input
        disabled={autoBusy}
        type="file"
        accept="image/*"
        multiple
        on:change={(e) => {
          addFiles(e.currentTarget.files)
          e.currentTarget.value = ''
        }}
      /></label
    ><button on:click={() => { importing = true }}>{$t('导入 Excel')}</button>{/if}<button on:click={exportList}><Label label={prospects.string.PageExport} /></button>
  </header>
  {#if moduleCanEdit}<div class="auto">
      <label class="switch" title={aiReady ? '' : $t('要先在 设置 → 集成 → 名片 AI 填好服务地址，才能自动识别。')}
        ><input type="checkbox" disabled={!aiReady || autoBusy} bind:checked={autoSave} />{$t('批量上传后自动识别并存入（不用一张张核对，只用正面）')}</label
      >
      {#if !aiReady}<span class="hint">{$t('名片 AI 还没接，暂时不能用')}</span>{/if}
      {#if autoBusy}<span>{$t('正在自动存入')} {autoDone} / {autoTotal}…</span>{:else if autoReport}<span>{autoReport}</span>{/if}
    </div>{/if}
  {#if moduleCanEdit && queue.length > 0}<section>
      <p>待处理照片 {queue.length} 张；选择正面和可选背面进行配对。</p>
      <label
        ><Label label={prospects.string.PageFront} /><select bind:value={frontIndex}
          >{#each queue as file, i}<option value={i}>{file.name}</option>{/each}</select
        ></label
      ><label
        ><Label label={prospects.string.PageBack} /><select bind:value={backIndex}
          ><option value={-1}>{local(prospects.string.PageNoBack)}</option>{#each queue as file, i}<option value={i}>{file.name}</option
            >{/each}</select
        ></label
      ><button disabled={frontIndex === backIndex} on:click={queueEdit}><Label label={prospects.string.PageReview} /></button><button
        on:click={() => {
          queue = []
          frontIndex = 0
          backIndex = -1
        }}><Label label={prospects.string.PageClearQueue} /></button
      >
    </section>{/if}
  <div class="filters">
    <input placeholder={local(prospects.string.PageSearch)} bind:value={search} /><label
      ><Label label={prospects.string.PageStatus} /><select bind:value={status}
        ><option value="">{local(prospects.string.PageAll)}</option>
        <option value="reply-pending">{local(prospects.string.AutoMailReplyPending)}</option>{#each Object.entries(statuses) as [key, label]}<option value={key}
            >{label}</option
          >{/each}</select
      ></label
    >
    {#if sourceColumn !== undefined}
      <label>{sourceColumn.label}<select bind:value={source}>
        <option value="">{local(prospects.string.PageAll)}</option>
        <option value={$t('未填写')}>{local(prospects.string.PageMissing)}</option>
        {#each sources as item}<option>{item}</option>{/each}
      </select></label>
    {/if}
    {#if countryColumn !== undefined}
      <label>{countryColumn.label}<select bind:value={country}>
        <option value="">{local(prospects.string.PageAll)}</option>
        <option value={$t('未填写')}>{local(prospects.string.PageMissing)}</option>
        {#each countries as item}<option>{item}</option>{/each}
      </select></label>
    {/if}
    {#if industryColumn !== undefined}
      <label>{industryColumn.label}<select bind:value={industry}>
        <option value="">{local(prospects.string.PageAll)}</option>
        <option value={$t('未填写')}>{local(prospects.string.PageMissing)}</option>
        {#each industries as item}<option>{item}</option>{/each}
      </select></label>
    {/if}
    <button
      on:click={() => {
        search = ''
        status = ''
        source = ''
        country = ''
        industry = ''
        period = ''
      }}><Label label={prospects.string.PageClearFilters} /></button
    >{#if period}<span>筛选：{period === 'week' ? local(prospects.string.PageWeek) : local(prospects.string.PageMonth)}</span>{/if}
  </div>
  {#if error}<p role="alert">{error}</p>{/if}
  <p><Label label={prospects.string.PageTotal} /> {visible.length}</p>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          {#each columns as column (column.field.key)}
            <th><button on:click={() => order(column.field.key)}>{column.label}</button></th>
          {/each}
          <th><button on:click={() => order('status')}><Label label={prospects.string.PageStatus} /></button></th>
          <th><Label label={prospects.string.PageActions} /></th>
        </tr>
      </thead>
      <tbody>
        {#each visible as item (item._id)}
          <tr>
            {#each columns as column (column.field.key)}
              <td>
                {#if column.field.key === 'name'}
                  <button disabled={!moduleCanEdit} on:click={() => edit(item)}>{item.name || local(prospects.string.PageMissing)}</button>
                {:else}
                  {column.read(item)}
                {/if}
              </td>
            {/each}
            <td>
              {statuses[item.status] ?? item.status}
              {#if replyPending.has(item._id)}<span class="reply-pending">● <Label label={prospects.string.AutoMailReplyPending} /></span>{/if}
              {#if introQueued.has(item._id)}<span class="mail-state"><Label label={prospects.string.AutoMailQueuedIntro} /></span>{/if}
              {#if campaignQueued.has(item._id) && marketingEmail(item) !== undefined && !introQueued.has(item._id)}
                <span class="mail-state"><Label label={prospects.string.AutoMailQueuedCampaign} /></span>
              {/if}
              {#if (item.review?.length ?? 0) > 0}<span class="reply-pending">{$chinese ? '待核对' : 'To review'}</span>{/if}
              {#if autoSent.has(item._id)}<span class="mail-state"><Label label={prospects.string.AutoMailSent} /></span>{/if}
            </td
            ><td
              ><button
                on:click={() => {
                  edit(item)
                }} disabled={!moduleCanEdit}><Label label={prospects.string.PageEdit} /></button
              ><ProspectLeadAction value={item} templateFields={template?.fields} canEdit={moduleCanEdit} />{#if moduleCanEdit && isOwnerOrMaintainer()}<button on:click={() => remove(item)}><Label label={prospects.string.PageDelete} /></button>{/if}</td
            ></tr
          >{:else}<tr><td colspan={columns.length + 2}>{all.length === 0 ? $t('还没有名片。点右上角"手动新增"拍照或上传名片正面，可以一次选多张。') : $t('没有符合条件的记录。')}</td></tr>{/each}</tbody
      >
    </table>
  </div>
</div>
{#if moduleCanEdit && importing}<ImportDialog columns={columns} {all} on:close={() => { importing = false }} />{/if}
{#if moduleCanEdit && editing}{#key selected?._id ?? 'new'}<EditDialog
      templateFields={template?.fields}
      value={all.find((item) => item._id === selected?._id) ?? selected}
      initialFront={fromQueue ? queue[frontIndex] : undefined}
      initialBack={fromQueue && backIndex >= 0 ? queue[backIndex] : undefined}
      on:close={() => (editing = false)}
      on:saved={saved}
      on:openDuplicate={(e) => {
        selected = e.detail
        fromQueue = false
      }}
    />{/key}{/if}

<style>
  .page {
    padding: 1.5rem;
    overflow: auto;
    min-width: 0;
    color: var(--theme-content-color);
  }
  header,
  .reply-pending { display: block; color: var(--theme-error-color); }
  .mail-state { display: block; color: var(--theme-content-color); }
  .filters,
  section {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: center;
  }
  header h1 {
    flex: 1;
  }
  .upload input {
    width: 12rem;
  }
  section {
    margin: 1rem 0;
  }
  .auto {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: center;
    margin-top: 0.6rem;
  }
  .switch {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    cursor: pointer;
  }
  .hint {
    opacity: 0.6;
  }
  .table-wrap {
    min-width: 0;
    overflow: auto;
    scrollbar-width: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    padding: 0.5rem;
    border-bottom: 1px solid var(--theme-divider-color);
    white-space: nowrap;
  }
  input,
  select,
  button {
    color: var(--theme-content-color);
    background: var(--theme-button-default);
    border: 1px solid var(--theme-button-border);
    padding: 0.4rem;
    border-radius: 0.3rem;
  }
  button {
    cursor: pointer;
  }
  select option {
    background: var(--theme-popup-color);
    color: var(--theme-content-color);
  }
</style>
