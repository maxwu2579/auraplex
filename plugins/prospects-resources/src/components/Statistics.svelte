<script lang="ts">
  import { translate, translateCB, type IntlString } from '@hcengineering/platform'
  import { languageStore } from '@hcengineering/ui'
  import { Label } from '@hcengineering/ui'

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
  let statuses: Record<string, string>
  $: statuses = {
    new: local(prospects.string.PageNew),
    sent: local(prospects.string.PageSent),
    replied: local(prospects.string.PageReplied),
    'do-not-send': local(prospects.string.PageOptOut),
    bounced: local(prospects.string.PageBounced),
    converted: local(prospects.string.PageConverted)
  }
  let groups: Array<{ key: 'source' | 'country' | 'industry' | 'status', title: string }>
  $: groups = [
    { key: 'source', title: local(prospects.string.PageSource) },
    { key: 'country', title: local(prospects.string.PageCountry) },
    { key: 'industry', title: local(prospects.string.PageIndustry) },
    { key: 'status', title: local(prospects.string.PageStatus) }
  ]
</script>

<div class="page">
  <h1><Label label={prospects.string.PageStatistics} /></h1>
  <div class="summary">
    <button
      on:click={() => {
        open()
      }}><Label label={prospects.string.PageTotal} /> {stats.total}</button
    ><button
      on:click={() => {
        open('period', 'week')
      }}><Label label={prospects.string.PageWeek} /> {stats.week}</button
    ><button
      on:click={() => {
        open('period', 'month')
      }}><Label label={prospects.string.PageMonth} /> {stats.month}</button
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
