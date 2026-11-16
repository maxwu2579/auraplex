<script lang="ts">
  import prospects, { prospectStats, type Prospect } from '@hcengineering/prospects'
  import { createQuery } from '@hcengineering/presentation'
  import { getCurrentLocation, navigate } from '@hcengineering/ui'
  import { prospectFilter, type ProspectFilter } from '../filter'
  const query = createQuery()
  let records: Prospect[] = []
  query.query(prospects.class.Prospect, {}, (items) => {
    records = items
  })
  $: stats = prospectStats(records, new Date())
  function open (field?: ProspectFilter['field'], value?: string): void {
    prospectFilter.set(field === undefined ? { field: 'period', value: '' } : { field, value })
    const loc = getCurrentLocation()
    loc.path[3] = 'directory'
    navigate(loc)
  }
  const statuses: Record<string, string> = {
    new: '未联系',
    sent: '已发邮件',
    replied: '已回复',
    'do-not-send': '不要再发',
    bounced: '邮件退回'
  }
  const groups: Array<{ key: 'source' | 'country' | 'industry' | 'status', title: string }> = [
    { key: 'source', title: '来源' },
    { key: 'country', title: '国家' },
    { key: 'industry', title: '行业' },
    { key: 'status', title: '状态' }
  ]
</script>

<div class="page">
  <h1>潜在客户统计</h1>
  <div class="summary">
    <button
      on:click={() => {
        open()
      }}>总数 {stats.total}</button
    ><button
      on:click={() => {
        open('period', 'week')
      }}>本周新增 {stats.week}</button
    ><button
      on:click={() => {
        open('period', 'month')
      }}>本月新增 {stats.month}</button
    >
  </div>
  {#each groups as group}
    <h2>{group.title}</h2>
    <div class="summary">
      {#each Object.entries(stats[group.key]) as [key, count]}<button
          on:click={() => {
            open(group.key, key)
          }}>{statuses[key] ?? key}：{count}</button
        >{/each}
    </div>
  {/each}
</div>

<style>
  .page {
    padding: 1.5rem;
    overflow: auto;
    color: var(--theme-content-color);
  }
  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  button {
    color: var(--theme-content-color);
    background: var(--theme-button-default);
    border: 1px solid var(--theme-button-border);
    border-radius: 0.4rem;
    padding: 0.5rem;
    cursor: pointer;
  }
</style>
