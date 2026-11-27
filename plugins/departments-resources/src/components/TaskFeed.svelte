<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import card, { type Card } from '@hcengineering/card'
  import { translate } from '@hcengineering/platform'
  import { onMount } from 'svelte'
  import contact, { type Employee, type Person } from '@hcengineering/contact'
  import core, { getCurrentAccount, type AccountUuid, type Ref, type Status } from '@hcengineering/core'
  import departments, {
    approvalTaskTitle, issueTask, managedTaskPeople, orderTask, singaporeClock, taskSection, todoTask,
    type DepartmentAccess, type Order
  } from '@hcengineering/departments'
  import hr from '@hcengineering/hr'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import processModel, { type ApproveRequest } from '@hcengineering/process'
  import task from '@hcengineering/task'
  import time, { type ToDo } from '@hcengineering/time'
  import tracker, { type Issue } from '@hcengineering/tracker'
  import { getCurrentLocation, languageStore } from '@hcengineering/ui'

  export let includeDepartment = false
  const me = getCurrentAccount().uuid
  const hierarchy = getClient().getHierarchy()
  const base = '/workbench/' + encodeURIComponent(getCurrentLocation().path[1])
  let now = Date.now()
  let orders: Order[] = []
  let issues: Issue[] = []
  let todos: ToDo[] = []
  let approvals: ApproveRequest[] = []
  let cards: Card[] = []
  let titles = new Map<Ref<Card>, string>()
  let titleRequest = 0
  const cardQuery = createQuery()
  async function loadTitles (docs: Card[], language: string): Promise<void> {
    const request = ++titleRequest
    const translated = await Promise.all(docs.map(async (doc) => {
      const label = hierarchy.findClass(doc._class)?.label
      const type = label === undefined ? undefined : await translate(label, {}, language, true)
      return [doc._id, approvalTaskTitle(type === label ? undefined : type, doc.title, doc.title)] as const
    }))
    if (request === titleRequest) titles = new Map(translated)
  }
  let staff: Employee[] = []
  let teams: DepartmentAccess[] = []
  let closed = new Set<Ref<Status>>()

  const issueQuery = createQuery()
  const todoQuery = createQuery()
  const approvalQuery = createQuery()
  createQuery().query(departments.class.Order, { state: 'active' }, (docs) => { orders = docs })
  createQuery().query(contact.mixin.Employee, { active: true }, (docs) => { staff = docs })
  createQuery().query(hr.class.Department, {}, (docs) => {
    teams = docs.filter((doc) => hierarchy.hasMixin(doc, departments.mixin.DepartmentAccess))
      .map((doc) => hierarchy.as(doc, departments.mixin.DepartmentAccess))
  })
  createQuery().query(core.class.Status, { category: { $in: [task.statusCategory.Won, task.statusCategory.Lost] } },
    (docs) => { closed = new Set(docs.map((doc) => doc._id)) })

  $: managed = managedTaskPeople(teams, me)
  $: relevant = staff.filter((person) => person.personUuid === me ||
    (includeDepartment && person.personUuid !== undefined && managed.people.has(person.personUuid)))
  $: refs = relevant.map((person) => person._id)
  $: end = singaporeClock(now).end
  $: issueQuery.query(tracker.class.Issue, { assignee: { $in: refs }, dueDate: { $lt: end, $gt: 0 } }, (docs) => { issues = docs })
  $: todoQuery.query(time.class.ToDo, { user: { $in: refs }, doneOn: null, dueDate: { $lt: end, $gt: 0 } }, (docs) => { todos = docs })
  $: approvalQuery.query(processModel.class.ApproveRequest, { user: { $in: refs }, doneOn: null }, (docs) => { approvals = docs })

  $: cardQuery.query(card.class.Card, { _id: { $in: approvals.map((item) => item.card).filter((id) => id !== undefined) } },
    (docs) => { cards = docs })
  $: void loadTitles(cards, $languageStore)
  $: accounts = new Map<Ref<Person>, AccountUuid | undefined>(relevant.map((person) => [person._id, person.personUuid]))
  $: teamMap = new Map<string, DepartmentAccess>(teams.map((team) => [team._id, team]))
  $: approvalById = new Map<string, ApproveRequest>(approvals.filter((doc) => doc.actionType !== 'review').map((doc) => [doc._id, doc]))
  $: tasks = [
    ...orders.flatMap((doc) => { const item = orderTask(base, doc, teamMap); return item === undefined ? [] : [item] }),
    ...issues.map((doc) => issueTask(base, doc, doc.assignee === null || doc.assignee === undefined ? undefined : accounts.get(doc.assignee), closed.has(doc.status))),
    ...[...new Map<string, ToDo>([...todos, ...approvals.filter((doc) => doc.actionType !== 'review')].map((doc) => [doc._id, doc])).values()]
      .map((doc) => todoTask(base, doc, accounts.get(doc.user), approvalById.has(doc._id), titles.get(approvalById.get(doc._id)?.card as Ref<Card>)))
  ]
  $: mine = tasks.flatMap((item) => {
    const section = taskSection(item, me, now, end)
    return section === undefined ? [] : [{ item, section }]
  })
  $: reports = includeDepartment ? relevant.flatMap((person) => {
    if (person.personUuid === undefined || !managed.people.has(person.personUuid)) return []
    const overdue = tasks.filter((item) => taskSection(item, person.personUuid as AccountUuid, now, end) === 0)
    return overdue.length === 0 ? [] : [{ person, overdue }]
  }) : []
  $: count = mine.filter(({ section }) => section === 0).length

  onMount(() => {
    const timer = setInterval(() => { now = Date.now() }, 30_000)
    return () => { clearInterval(timer) }
  })
</script>

<slot {mine} {reports} {count} {now} manages={managed.manages} />
