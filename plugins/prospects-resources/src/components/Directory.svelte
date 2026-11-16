<script lang="ts">
  import { isOwnerOrMaintainer } from '@hcengineering/core'
  import prospects, { type Prospect, type ProspectStatus } from '@hcengineering/prospects'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { createWorkbook, datedFilename, downloadWorkbook } from '../xlsx'
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
  const statuses: Record<ProspectStatus, string> = {
    new: '未联系',
    sent: '已发邮件',
    replied: '已回复',
    'do-not-send': '不要再发',
    bounced: '邮件退回'
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
      ['姓名', 'name'],
      ['公司', 'company'],
      ['职位', 'title'],
      ['手机', 'mobile'],
      ['电话', 'phone'],
      ['邮箱', 'email'],
      ['网站', 'website'],
      ['地址', 'address'],
      ['国家', 'country'],
      ['行业', 'industry'],
      ['来源', 'source'],
      ['备注', 'notes']
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
      p.recognitionConfirmed ? '是' : '否'
    ])
    downloadWorkbook(
      createWorkbook([
        {
          name: '潜在客户',
          rows: [
            [
              ...columns.map(([title]) => title),
              '来源日期',
              '状态',
              '最后发邮件时间',
              '发送次数',
              '识别模型',
              '识别时间',
              '人工确认'
            ],
            ...rows
          ]
        }
      ]),
      datedFilename('潜在客户', '', new Date())
    )
  }
</script>

<div class="page">
  <header>
    <h1>名片库</h1>
    <button
      on:click={() => {
        edit()
      }}>手动新增</button
    ><label class="upload"
      >批量选择名片正面<input
        type="file"
        accept="image/*"
        multiple
        on:change={(e) => {
          addFiles(e.currentTarget.files)
          e.currentTarget.value = ''
        }}
      /></label
    ><button on:click={exportList}>导出 Excel</button>
  </header>
  {#if queue.length > 0}<section>
      <p>待处理照片 {queue.length} 张；选择正面和可选背面进行配对。</p>
      <label
        >正面 <select bind:value={frontIndex}
          >{#each queue as file, i}<option value={i}>{file.name}</option>{/each}</select
        ></label
      ><label
        >背面 <select bind:value={backIndex}
          ><option value={-1}>无背面</option>{#each queue as file, i}<option value={i}>{file.name}</option
            >{/each}</select
        ></label
      ><button disabled={frontIndex === backIndex} on:click={queueEdit}>核对这张名片</button><button
        on:click={() => {
          queue = []
          frontIndex = 0
          backIndex = -1
        }}>清空待处理</button
      >
    </section>{/if}
  <div class="filters">
    <input placeholder="搜索姓名、公司、邮箱、电话" bind:value={search} /><label
      >状态<select bind:value={status}
        ><option value="">全部</option>{#each Object.entries(statuses) as [key, label]}<option value={key}
            >{label}</option
          >{/each}</select
      ></label
    >
    <label
      >来源<select bind:value={source}
        ><option value="">全部</option><option value="未填写">未填写</option>{#each sources as item}<option
            >{item}</option
          >{/each}</select
      ></label
    ><label
      >国家<select bind:value={country}
        ><option value="">全部</option><option value="未填写">未填写</option>{#each countries as item}<option
            >{item}</option
          >{/each}</select
      ></label
    ><label
      >行业<select bind:value={industry}
        ><option value="">全部</option><option value="未填写">未填写</option>{#each industries as item}<option
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
      }}>清除筛选</button
    >{#if period}<span>筛选：{period === 'week' ? '本周新增' : '本月新增'}</span>{/if}
  </div>
  {#if error}<p role="alert">{error}</p>{/if}
  <p>共 {visible.length} 条</p>
  <div class="table-wrap">
    <table>
      <thead
        ><tr
          >{#each [['name', '姓名'], ['company', '公司'], ['title', '职位'], ['mobile', '手机'], ['phone', '电话'], ['email', '邮箱'], ['country', '国家'], ['industry', '行业'], ['source', '来源'], ['status', '状态']] as col}<th
              ><button
                on:click={() => {
                  order(col[0])
                }}>{col[1]}</button
              ></th
            >{/each}<th>操作</th></tr
        ></thead
      ><tbody
        >{#each visible as item (item._id)}<tr
            ><td
              ><button
                on:click={() => {
                  edit(item)
                }}>{item.name !== '' ? item.name : '未填写'}</button
              ></td
            ><td>{item.company}</td><td>{item.title}</td><td>{item.mobile}</td><td>{item.phone}</td><td>{item.email}</td
            ><td>{item.country}</td><td>{item.industry}</td><td>{item.source}</td><td
              >{statuses[item.status] ?? item.status}</td
            ><td
              ><button
                on:click={() => {
                  edit(item)
                }}>查看 / 编辑</button
              >{#if isOwnerOrMaintainer()}<button on:click={() => remove(item)}>删除</button>{/if}</td
            ></tr
          >{:else}<tr><td colspan="11">没有符合条件的记录。</td></tr>{/each}</tbody
      >
    </table>
  </div>
</div>
{#if editing}{#key selected?._id ?? 'new'}<EditDialog
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
