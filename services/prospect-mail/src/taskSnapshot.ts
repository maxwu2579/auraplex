// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import contact, { type Employee, type Person, type PersonSpace } from '@hcengineering/contact'
import core, { type AccountUuid, type Doc, type Ref, type TxOperations } from '@hcengineering/core'
import departments, { type DepartmentAccess, type Order, type OrderStage } from '@hcengineering/departments'
import hr from '@hcengineering/hr'
import task from '@hcengineering/task'
import time from '@hcengineering/time'
import tracker from '@hcengineering/tracker'
import { orderDeadline } from './schedule'

export interface ScheduledTask {
  source: Doc
  title: string
  assignee?: AccountUuid
  due?: number
  href: string
  order?: { doc: Order, stage: OrderStage }
}

export function panelLink (base: string, component: string, doc: Doc): string {
  return base + '#' + encodeURIComponent([component, doc._id, doc._class, 'content'].join('|'))
}

export async function taskSnapshot (client: TxOperations, base: string, dueBefore: number): Promise<{
  tasks: ScheduledTask[], teams: Map<string, DepartmentAccess>, employees: Employee[], spaces: Map<Ref<Person>, PersonSpace>
}> {
  const [orders, issues, todos, people, teams, spaces, closed] = await Promise.all([
    client.findAll(departments.class.Order, { state: 'active' }),
    client.findAll(tracker.class.Issue, { dueDate: { $lt: dueBefore, $gt: 0 } }),
    client.findAll(time.class.ToDo, { doneOn: null, dueDate: { $lt: dueBefore, $gt: 0 } }),
    client.findAll(contact.class.Person, {}),
    client.findAll(hr.class.Department, {}),
    client.findAll(contact.class.PersonSpace, {}),
    client.findAll(core.class.Status, { category: { $in: [task.statusCategory.Won, task.statusCategory.Lost] } })
  ])
  const hierarchy = client.getHierarchy()
  const closedStatuses = new Set(closed.map(({ _id }) => _id))
  const employees = people.filter((person) => hierarchy.hasMixin(person, contact.mixin.Employee))
    .map((person) => hierarchy.as(person, contact.mixin.Employee)).filter((employee) => employee.active)
  const byPerson = new Map<Ref<Person>, AccountUuid | undefined>(employees.map((person) => [person._id, person.personUuid]))
  const tasks: ScheduledTask[] = []
  for (const order of orders) {
    const stage = order.stages[order.current]
    if (stage?.status !== 'active' && stage?.status !== 'approval') continue
    tasks.push({
      source: order, title: `${order.number} ${order.title} · ${stage.name}`, assignee: stage.assignee,
      due: orderDeadline(stage), href: panelLink(base, 'departments:component:OrderPanel', order), order: { doc: order, stage }
    })
  }
  for (const issue of issues) {
    if (closedStatuses.has(issue.status)) continue
    tasks.push({
      source: issue, title: `${issue.identifier} ${issue.title}`, due: issue.dueDate ?? undefined,
      assignee: issue.assignee == null ? undefined : byPerson.get(issue.assignee),
      href: `${base}/tracker/${encodeURIComponent(issue.identifier)}`
    })
  }
  for (const todo of todos) {
    tasks.push({
      source: todo, title: todo.title, due: todo.dueDate ?? undefined, assignee: byPerson.get(todo.user),
      href: panelLink(base, 'time:component:EditToDo', todo)
    })
  }
  return {
    tasks,
    teams: new Map(teams.filter((team) => hierarchy.hasMixin(team, departments.mixin.DepartmentAccess))
      .map((team) => [team._id, hierarchy.as(team, departments.mixin.DepartmentAccess)])),
    employees,
    spaces: new Map(spaces.map((space) => [space.person, space]))
  }
}
