<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<!-- Production board: open orders in four columns (to pick up, in progress, blocked, overdue). Read-only;
     moving an order on still goes through the order's own buttons and the server checks. -->
<script lang="ts">
  import { onMount } from 'svelte'
  import contact, { formatName, type Employee } from '@hcengineering/contact'
  import { getCurrentAccount, isOwnerOrMaintainer, type AccountUuid, type Ref } from '@hcengineering/core'
  import departments, {
    boardColumns, boardMine, boardPlace, panelLink, type BoardColumn, type BoardPlace, type DepartmentAccess, type Order
  } from '@hcengineering/departments'
  import hr, { type Department } from '@hcengineering/hr'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { getCurrentLocation, languageStore, showPanel } from '@hcengineering/ui'

  const me = getCurrentAccount().uuid
  const owner = isOwnerOrMaintainer()
  const hierarchy = getClient().getHierarchy()
  const base = '/workbench/' + encodeURIComponent(getCurrentLocation().path[1])
  $: L = (zh: string, en: string): string => ($languageStore === 'zh' ? zh : en)

  let orders: Order[] = []
  let teams: DepartmentAccess[] = []
  let staff: Employee[] = []
  let now = Date.now()
  createQuery().query(departments.class.Order, { state: { $in: ['active', 'pending'] } }, (docs) => { orders = docs })
  createQuery().query(contact.mixin.Employee, { active: true }, (docs) => { staff = docs })
  createQuery().query(hr.class.Department, {}, (docs) => {
    teams = docs.filter((doc) => hierarchy.hasMixin(doc, departments.mixin.DepartmentAccess))
      .map((doc) => hierarchy.as(doc, departments.mixin.DepartmentAccess)).filter((doc) => !doc.archived)
  })
  onMount(() => {
    const timer = setInterval(() => { now = Date.now() }, 60_000)
    return () => { clearInterval(timer) }
  })

  const member = (team: DepartmentAccess, who: AccountUuid): boolean =>
    [team.administrators, team.supervisors, team.employees, team.readers].some((list) => list.includes(who))
  $: myTeams = teams.filter((team) => member(team, me))
  // Default: my departments; super admins and company admins see everything.
  let department: Ref<Department> | 'all' | 'mine-depts' | undefined
  $: if (department === undefined && teams.length > 0) department = owner || myTeams.length === 0 ? 'all' : 'mine-depts'
  let onlyMine = false

  $: myTeamIds = new Set<string>(myTeams.map((team) => team._id))
  $: placed = orders.flatMap((order) => {
    const place = boardPlace(order, now)
    if (place === undefined) return []
    const dept = place.stage?.department
    if (department === 'mine-depts' && !(dept !== undefined && myTeamIds.has(dept)) && !boardMine(order, me)) return []
    if (department !== undefined && department !== 'all' && department !== 'mine-depts' && dept !== department) return []
    if (onlyMine && !boardMine(order, me)) return []
    return [{ order, place }]
  })
  $: byColumn = new Map<BoardColumn, Array<{ order: Order, place: BoardPlace }>>(boardColumns.map((column) => [
    column,
    placed.filter((it) => it.place.column === column).sort((a, b) => (a.place.stage?.startedOn ?? 0) - (b.place.stage?.startedOn ?? 0))
  ]))
  $: titles = {
    waiting: L('待接手', 'To pick up'),
    active: L('进行中', 'In progress'),
    blocked: L('卡在审批 / 等付款', 'Approval / payment'),
    overdue: L('已过期', 'Overdue')
  }
  $: name = (id: AccountUuid | undefined): string => {
    const found = id === undefined ? undefined : staff.find((it) => it.personUuid === id)
    return found === undefined ? '—' : formatName(found.name)
  }
  // Open the order in the side panel, like the inbox does (a plain link is not followed inside the app).
  function open (order: Order): void {
    showPanel(departments.component.OrderPanel, order._id, order._class, 'content')
  }
  $: deptName = (id: string | undefined): string => teams.find((it) => it._id === id)?.name ?? L('未指定部门', 'No department')
</script>

<div class="page">
  <header>
    <h1>{L('生产看板', 'Production board')}</h1>
    <label>{L('部门', 'Department')}
      <select bind:value={department}>
        <option value="all">{L('全部', 'All')}</option>
        {#if myTeams.length > 0}<option value="mine-depts">{L('我所在的部门', 'My departments')}</option>{/if}
        {#each teams as team (team._id)}<option value={team._id}>{team.name}</option>{/each}
      </select>
    </label>
    <label class="check"><input type="checkbox" bind:checked={onlyMine} /> {L('只看我的', 'Only mine')}</label>
  </header>
  <div class="board">
    {#each boardColumns as column (column)}
      {@const items = byColumn.get(column) ?? []}
      <section class={column}>
        <h2>{titles[column]} <span class="count">{items.length}</span></h2>
        {#each items as { order, place } (order._id)}
          {@const stage = place.stage}
          <a class="card" href={panelLink(base, 'departments:component:OrderPanel', order)} on:click|preventDefault={() => { open(order) }}>
            <b>{order.number} {order.title}</b>
            <span>{order.customer}</span>
            <span>{stage?.name ?? '—'} · {deptName(stage?.department)}</span>
            <span>{L('负责人', 'In charge')}：{name(stage?.assignee)}</span>
            <span>
              {#if place.days !== undefined}{L('已用', 'Used')} {place.days} {L('天', 'd')}{/if}{#if stage?.limitDays !== undefined} / {L('限时', 'limit')} {stage.limitDays} {L('天', 'd')}{/if}
            </span>
            {#if place.blockedBy === 'payment'}<span class="tag">{L('等付款', 'Awaiting payment')}</span>{/if}
            {#if place.blockedBy === 'approval'}<span class="tag">{L('等审批', 'Awaiting approval')}</span>{/if}
            {#if order.state === 'pending'}<span class="tag">{L('还没开始', 'Not started')}</span>{/if}
          </a>
        {:else}
          <p class="empty">{L('没有', 'None')}</p>
        {/each}
      </section>
    {/each}
  </div>
</div>

<style>
  .page { padding: 1.5rem; overflow: auto; min-width: 0; color: var(--theme-content-color); }
  header { display: flex; flex-wrap: wrap; gap: 0.8rem; align-items: center; margin-bottom: 1rem; }
  header h1 { flex: 1; margin: 0; font-size: 1.2rem; }
  label { display: flex; gap: 0.4rem; align-items: center; }
  select { color: var(--theme-content-color); background: var(--theme-button-default); border: 1px solid var(--theme-button-border); padding: 0.35rem; border-radius: 0.3rem; }
  select option { background: var(--theme-popup-color); color: var(--theme-content-color); }
  .board { display: grid; grid-template-columns: repeat(4, minmax(14rem, 1fr)); gap: 0.8rem; overflow-x: auto; }
  section { background: var(--theme-bg-accent-color, rgba(127, 127, 127, 0.06)); border-radius: 0.5rem; padding: 0.6rem; min-width: 14rem; }
  h2 { font-size: 1rem; margin: 0 0 0.6rem; display: flex; gap: 0.4rem; align-items: center; }
  .count { border: 1px solid var(--theme-divider-color); border-radius: 1rem; padding: 0 0.5rem; font-size: 0.85rem; }
  .overdue h2, .overdue .card b { color: var(--theme-error-color); }
  .card { display: flex; flex-direction: column; gap: 0.2rem; padding: 0.6rem; margin-bottom: 0.5rem; border-radius: 0.4rem;
    border: 1px solid var(--theme-divider-color); background: var(--theme-popup-color); color: var(--theme-content-color); text-decoration: none; }
  .card:hover { border-color: var(--theme-link-color); }
  .card b { overflow-wrap: anywhere; }
  .tag { align-self: flex-start; border: 1px solid var(--theme-divider-color); border-radius: 0.4rem; padding: 0 0.4rem; font-size: 0.85rem; }
  .empty { opacity: 0.5; margin: 0.4rem; }
</style>
