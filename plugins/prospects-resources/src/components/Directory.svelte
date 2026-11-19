<script lang="ts">
  import { translate, translateCB, type IntlString } from '@hcengineering/platform'
  import { languageStore } from '@hcengineering/ui'
  import { Label } from '@hcengineering/ui'

  import { departmentModuleLevel } from '@hcengineering/presentation'
  $: moduleCanEdit = $departmentModuleLevel('prospects') === 'edit'
  import { isOwnerOrMaintainer } from '@hcengineering/core'
  import prospects, { type Prospect, type ProspectStatus } from '@hcengineering/prospects'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { createWorkbook, datedFilename, downloadWorkbook } from '../xlsx'
  import { recordExport } from '../audit'
  import { prospectFilter } from '../filter'
  import EditDialog from './EditDialog.svelte'
  const query = createQuery()
  const client = getClient()
  let all: Prospect[] = []
  let search = ''
  let status = ''
  let source = ''
  let country = ''
  let industry = ''
  let period = ''
  let sort = 'name'
  let ascending = true
  let editing = false
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
    bounced: local(prospects.string.PageBounced)
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
  function inPeriod (p: Prospect): boolean {
    if (period === '') return true
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), period === 'month' ? 1 : now.getDate())
    if (period === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    return (p.createdOn ?? p.modifiedOn) >= start.getTime() && (p.createdOn ?? p.modifiedOn) <= now.getTime()
  }
  function matches (value: string, filter: string): boolean {
    return filter === '' || (filter === '未填写' ? value === '' : value === filter)
  }
  $: visible = all
    .filter(
      (p) =>
        [p.name, p.company, p.email, p.phone, p.mobile].join(' ').toLowerCase().includes(search.trim().toLowerCase()) &&
        matches(p.status, status) &&
        matches(p.source, source) &&
        matches(p.country, country) &&
        matches(p.industry, industry) &&
        inPeriod(p)
    )
    .sort(
      (a, b) =>
        String(a[sort as keyof Prospect] ?? '').localeCompare(String(b[sort as keyof Prospect] ?? ''), undefined, {
          numeric: true
        }) * (ascending ? 1 : -1)
    )
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
  function addFiles (files: FileList | null): void {
    if (files !== null) {
      queue = [...queue, ...Array.from(files)]
      frontIndex = 0
      backIndex = -1
    }
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
    if (!isOwnerOrMaintainer() || !window.confirm(`删除 ${p.name}？`)) return
    try {
      await client.remove(p)
    } catch {
      error = '删除失败，请检查权限后重试。'
    }
  }
  function exportList (): void {
    const columns: Array<[string, keyof Prospect]> = [
      [local(prospects.string.PageName), 'name'],
      [local(prospects.string.PageCompany), 'company'],
      [local(prospects.string.PageJobTitle), 'title'],
      [local(prospects.string.PageMobile), 'mobile'],
      [local(prospects.string.PagePhone), 'phone'],
      [local(prospects.string.PageEmail), 'email'],
      [local(prospects.string.PageWebsite), 'website'],
      [local(prospects.string.PageAddress), 'address'],
      [local(prospects.string.PageCountry), 'country'],
      [local(prospects.string.PageIndustry), 'industry'],
      [local(prospects.string.PageSource), 'source'],
      [local(prospects.string.PageNotes), 'notes']
    ]
    const displayTime = (time?: number): string => (time === undefined ? '' : new Date(time).toLocaleString())
    const rows = visible.map((p) => [
      ...columns.map(([, key]) => String(p[key] ?? '')),
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
              ...columns.map(([title]) => title),
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
    void recordExport(`导出名片 Excel（${visible.length} 条）`)
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
        type="file"
        accept="image/*"
        multiple
        on:change={(e) => {
          addFiles(e.currentTarget.files)
          e.currentTarget.value = ''
        }}
      /></label
    >{/if}<button on:click={exportList}><Label label={prospects.string.PageExport} /></button>
  </header>
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
        ><option value="">{local(prospects.string.PageAll)}</option>{#each Object.entries(statuses) as [key, label]}<option value={key}
            >{label}</option
          >{/each}</select
      ></label
    >
    <label
      ><Label label={prospects.string.PageSource} /><select bind:value={source}
        ><option value="">{local(prospects.string.PageAll)}</option><option value="未填写">{local(prospects.string.PageMissing)}</option>{#each sources as item}<option
            >{item}</option
          >{/each}</select
      ></label
    ><label
      ><Label label={prospects.string.PageCountry} /><select bind:value={country}
        ><option value="">{local(prospects.string.PageAll)}</option><option value="未填写">{local(prospects.string.PageMissing)}</option>{#each countries as item}<option
            >{item}</option
          >{/each}</select
      ></label
    ><label
      ><Label label={prospects.string.PageIndustry} /><select bind:value={industry}
        ><option value="">{local(prospects.string.PageAll)}</option><option value="未填写">{local(prospects.string.PageMissing)}</option>{#each industries as item}<option
            >{item}</option
          >{/each}</select
      ></label
    ><button
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
      <thead
        ><tr
          >{#each [['name', local(prospects.string.PageName)], ['company', local(prospects.string.PageCompany)], ['title', local(prospects.string.PageJobTitle)], ['mobile', local(prospects.string.PageMobile)], ['phone', local(prospects.string.PagePhone)], ['email', local(prospects.string.PageEmail)], ['country', local(prospects.string.PageCountry)], ['industry', local(prospects.string.PageIndustry)], ['source', local(prospects.string.PageSource)], ['status', local(prospects.string.PageStatus)]] as col}<th
              ><button
                on:click={() => {
                  order(col[0])
                }}>{col[1]}</button
              ></th
            >{/each}<th><Label label={prospects.string.PageActions} /></th></tr
        ></thead
      ><tbody
        >{#each visible as item (item._id)}<tr
            ><td
              ><button
                on:click={() => {
                  edit(item)
                }} disabled={!moduleCanEdit}>{item.name !== '' ? item.name : local(prospects.string.PageMissing)}</button
              ></td
            ><td>{item.company}</td><td>{item.title}</td><td>{item.mobile}</td><td>{item.phone}</td><td>{item.email}</td
            ><td>{item.country}</td><td>{item.industry}</td><td>{item.source}</td><td
              >{statuses[item.status] ?? item.status}</td
            ><td
              ><button
                on:click={() => {
                  edit(item)
                }} disabled={!moduleCanEdit}><Label label={prospects.string.PageEdit} /></button
              >{#if moduleCanEdit && isOwnerOrMaintainer()}<button on:click={() => remove(item)}><Label label={prospects.string.PageDelete} /></button>{/if}</td
            ></tr
          >{:else}<tr><td colspan="11">没有符合条件的记录。</td></tr>{/each}</tbody
      >
    </table>
  </div>
</div>
{#if moduleCanEdit && editing}{#key selected?._id ?? 'new'}<EditDialog
      value={selected}
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
