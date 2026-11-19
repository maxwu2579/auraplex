<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import { Breadcrumb, Header, Label, languageStore } from '@hcengineering/ui'
  import { translateCB, type IntlString } from '@hcengineering/platform'
  import contact, { formatName, type Employee } from '@hcengineering/contact'
  import core, { AccountRole, getCurrentAccount, type AccountUuid, type Ref, type Status } from '@hcengineering/core'
  import departments, { type DepartmentAccess, type Order } from '@hcengineering/departments'
  import hr from '@hcengineering/hr'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import task from '@hcengineering/task'
  import tracker, { type Issue } from '@hcengineering/tracker'
  import { recordAudit } from '../audit'
  import { peopleOf, visibleDepartments } from '../trackingScope'
  import { createWorkbook, downloadWorkbook } from '../xlsx'

  /** 工作量: per person and department, what got done in the period and what is late. */
  const client = getClient()
  const hierarchy = client.getHierarchy()
  const me = getCurrentAccount()
  const owner = me.role === AccountRole.Owner
  const DAY = 86400000

  let all: DepartmentAccess[] = []
  let staff: Employee[] = []
  let orders: Order[] = []
  let issues: Issue[] = []
  let statuses: Status[] = []
  let period: 'week' | 'lastweek' | 'month' = 'week'

  createQuery().query(hr.class.Department, {}, (res) => {
    all = res.flatMap((it) => hierarchy.asIf(it, departments.mixin.DepartmentAccess) ?? [])
  })
  createQuery().query(contact.mixin.Employee, { active: true }, (res) => {
    staff = res.filter((it) => it.personUuid != null)
  })
  createQuery().query(departments.class.Order, {}, (res) => {
    orders = res
  })
  createQuery().query(tracker.class.Issue, {}, (res) => {
    issues = res
  })
  createQuery().query(core.class.Status, {}, (res) => {
    statuses = res
  })

  function range (p: typeof period): [number, number] {
    const now = new Date()
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime()
    if (p === 'week') return [monday, Date.now() + 1]
    if (p === 'lastweek') return [monday - 7 * DAY, monday]
    return [Date.now() - 30 * DAY, Date.now() + 1]
  }

  interface Line {
    who: AccountUuid
    name: string
    depts: string
    stagesDone: number
    avgDays: string
    stagesOpen: number
    tasksDone: number
    overdue: number
  }

  $: visible = visibleDepartments(all, me.uuid, owner)
  $: [start, end] = range(period)
  $: done = new Set(statuses.filter((it) => it.category === task.statusCategory.Won).map((it) => it._id))
  $: closed = new Set(
    statuses
      .filter((it) => it.category === task.statusCategory.Won || it.category === task.statusCategory.Lost)
      .map((it) => it._id)
  )
  $: lines = [...peopleOf(visible)].map((who): Line => {
    const p = staff.find((it) => it.personUuid === who)
    const stages = orders.flatMap((o) => o.stages.filter((s) => s.assignee === who))
    const finished = stages.filter((s) => s.status === 'done' && s.doneOn !== undefined && s.doneOn >= start && s.doneOn < end)
    const used = finished
      .filter((s) => s.startedOn !== undefined)
      .map((s) => ((s.doneOn as number) - (s.startedOn as number)) / DAY)
    const mine = p === undefined ? [] : issues.filter((it) => it.assignee === p._id)
    return {
      who,
      name: p === undefined ? '—' : formatName(p.name),
      depts: visible
        .filter((d) => [...d.administrators, ...d.supervisors, ...d.employees].includes(who))
        .map((d) => d.name)
        .join('、'),
      stagesDone: finished.length,
      avgDays: used.length === 0 ? '' : (used.reduce((a, b) => a + b, 0) / used.length).toFixed(1),
      stagesOpen: stages.filter((s) => s.status === 'active').length,
      tasksDone: mine.filter((it) => done.has(it.status) && it.modifiedOn >= start && it.modifiedOn < end).length,
      overdue: mine.filter((it) => it.dueDate != null && it.dueDate < Date.now() && !closed.has(it.status)).length
    }
  })
  $: totals = visible.map((d) => {
    const members = new Set([...d.administrators, ...d.supervisors, ...d.employees])
    const part = lines.filter((it) => members.has(it.who))
    return {
      name: d.name,
      stagesDone: part.reduce((a, it) => a + it.stagesDone, 0),
      stagesOpen: part.reduce((a, it) => a + it.stagesOpen, 0),
      tasksDone: part.reduce((a, it) => a + it.tasksDone, 0),
      overdue: part.reduce((a, it) => a + it.overdue, 0)
    }
  })

  function exportExcel (): void {
    const head = [trackingText(departments.string.TrackingPagePerson), trackingText(departments.string.TrackingPageDepartment), trackingText(departments.string.TrackingPageStagesDone), trackingText(departments.string.TrackingPageAverageDays), trackingText(departments.string.TrackingPageStagesOpen), trackingText(departments.string.TrackingPageTasksDone), trackingText(departments.string.TrackingPageOverdueTasks)]
    downloadWorkbook(
      createWorkbook([
        { name: trackingText(departments.string.TrackingPagePerPerson), rows: [head, ...lines.map((it) => [it.name, it.depts, it.stagesDone, it.avgDays, it.stagesOpen, it.tasksDone, it.overdue])] },
        {
          name: trackingText(departments.string.TrackingPagePerDepartment),
          rows: [
            [trackingText(departments.string.TrackingPageDepartment), trackingText(departments.string.TrackingPageStagesDone), trackingText(departments.string.TrackingPageStagesOpen), trackingText(departments.string.TrackingPageTasksDone), trackingText(departments.string.TrackingPageOverdueTasks)],
            ...totals.map((it) => [it.name, it.stagesDone, it.stagesOpen, it.tasksDone, it.overdue])
          ]
        }
      ]),
      `${$languageStore === 'zh' ? '工作量' : 'Workload'}_${new Date().toISOString().slice(0, 10)}.xlsx`
    )
    void recordAudit('export', trackingText(departments.string.TrackingPageExportWorkload, { count: lines.length }))
  }
  function trackingText (id: IntlString, params: Record<string, string | number> = {}): string {
    let result: string = id
    translateCB(id, params, $languageStore, (value) => { result = value })
    return result
  }
</script>

<section class="workload">
  <Header adaptive="disabled"><Breadcrumb label={departments.string.TrackingPageWorkload} size="large" isCurrent /></Header>
  {#if !owner && visible.length === 0}
    <p class="hint"><Label label={departments.string.TrackingPageWorkloadDenied} /></p>
  {:else}
    <div class="row">
      <button class:on={period === 'week'} on:click={() => (period = 'week')}><Label label={departments.string.TrackingPageThisWeek} /></button>
      <button class:on={period === 'lastweek'} on:click={() => (period = 'lastweek')}><Label label={departments.string.TrackingPageLastWeek} /></button>
      <button class:on={period === 'month'} on:click={() => (period = 'month')}><Label label={departments.string.TrackingPageLastMonth} /></button>
      <button on:click={exportExcel}><Label label={departments.string.TrackingPageExportExcel} /></button>
    </div>
    <h3><Label label={departments.string.TrackingPagePerDepartment} /></h3>
    <table>
      <thead><tr><th><Label label={departments.string.TrackingPageDepartment} /></th><th><Label label={departments.string.TrackingPageStagesDone} /></th><th><Label label={departments.string.TrackingPageInProgress} /></th><th><Label label={departments.string.TrackingPageTasksDone} /></th><th><Label label={departments.string.TrackingPageOverdueTasks} /></th></tr></thead>
      <tbody>
        {#each totals as it (it.name)}
          <tr><td>{it.name}</td><td>{it.stagesDone}</td><td>{it.stagesOpen}</td><td>{it.tasksDone}</td><td class:late={it.overdue > 0}>{it.overdue}</td></tr>
        {/each}
      </tbody>
    </table>
    <h3><Label label={departments.string.TrackingPageEachPerson} /></h3>
    <table>
      <thead
        ><tr><th><Label label={departments.string.TrackingPagePerson} /></th><th><Label label={departments.string.TrackingPageDepartment} /></th><th><Label label={departments.string.TrackingPageStagesDone} /></th><th><Label label={departments.string.TrackingPageAverageDays} /></th><th><Label label={departments.string.TrackingPageInProgress} /></th><th><Label label={departments.string.TrackingPageTasksDone} /></th><th><Label label={departments.string.TrackingPageOverdueTasks} /></th></tr></thead
      >
      <tbody>
        {#each lines as it (it.who)}
          <tr>
            <td>{it.name}</td><td>{it.depts}</td><td>{it.stagesDone}</td><td>{it.avgDays}</td><td>{it.stagesOpen}</td>
            <td>{it.tasksDone}</td><td class:late={it.overdue > 0}>{it.overdue}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="hint"><Label label={departments.string.TrackingPageWorkloadHint} /></p>
  {/if}
</section>

<style>
  .workload { display: flex; flex-direction: column; gap: 0.6rem; padding: 1rem 1.25rem; height: 100%; overflow: auto; }
  h2, h3 { margin: 0; }
  .row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  button {
    color: var(--theme-content-color);
    background: var(--theme-button-default);
    border: 1px solid var(--theme-button-border);
    padding: 0.35rem 0.6rem;
    border-radius: 0.3rem;
    font: inherit;
    cursor: pointer;
  }
  button.on { border-color: var(--theme-caption-color); }
  table { border-collapse: collapse; }
  th, td { text-align: left; padding: 0.35rem 0.6rem; border-bottom: 1px solid var(--theme-divider-color); white-space: nowrap; }
  td.late { color: var(--theme-error-color); font-weight: 600; }
  .hint { color: var(--theme-dark-color); margin: 0; }
</style>
