// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import contact, { type Employee, type Person, type PersonSpace } from '@hcengineering/contact'
import core, { type AccountUuid, type Doc, type Ref, type TxOperations } from '@hcengineering/core'
import departments, { type DepartmentAccess, type Order, type OrderStage } from '@hcengineering/departments'
import hr from '@hcengineering/hr'
import processModel from '@hcengineering/process'
import task from '@hcengineering/task'
import time from '@hcengineering/time'
import tracker from '@hcengineering/tracker'
import { orderDeadline } from './schedule'

export interface ScheduledTask {
  source: Doc
  title: string
  assignee?: AccountUuid
  approvers?: AccountUuid[]
  due?: number
  href: string
  order?: { doc: Order, stage: OrderStage }
}

export function panelLink (base: string, component: string, doc: Doc): string {
  return base + '#' + encodeURIComponent([component, doc._id, doc._class, 'content'].join('|'))
}

export async function taskSnapshot (client: TxOperations, base: string, dueBefore: number, includeApprovals = false): Promise<{
  tasks: ScheduledTask[], teams: Map<string, DepartmentAccess>, employees: Employee[], spaces: Map<Ref<Person>, PersonSpace>
}> {
  const [orders, issues, todos, people, teams, spaces, closed, approvals] = await Promise.all([
    client.findAll(departments.class.Order, { state: 'active' }),
    client.findAll(tracker.class.Issue, { dueDate: { $lt: dueBefore, $gt: 0 } }),
    client.findAll(time.class.ToDo, { doneOn: null, dueDate: { $lt: dueBefore, $gt: 0 } }),
    client.findAll(contact.class.Person, {}),
    client.findAll(hr.class.Department, {}),
    client.findAll(contact.class.PersonSpace, {}),
    client.findAll(core.class.Status, { category: { $in: [task.statusCategory.Won, task.statusCategory.Lost] } }),
    includeApprovals ? client.findAll(processModel.class.ApproveRequest, { doneOn: null }) : []
  ])
  const hierarchy = client.getHierarchy()
  const closedStatuses = new Set(closed.map(({ _id }) => _id))
  const employees = people.filter((person) => hierarchy.hasMixin(person, contact.mixin.Employee))
    .map((person) => hierarchy.as(person, contact.mixin.Employee)).filter((employee) => employee.active)
  const byPerson = new Map<Ref<Person>, AccountUuid | undefined>(employees.map((person) => [person._id, person.personUuid]))
  const tasks: ScheduledTask[] = []
  const teamById = new Map(teams.filter((team) => hierarchy.hasMixin(team, departments.mixin.DepartmentAccess))
    .map((team) => [team._id, hierarchy.as(team, departments.mixin.DepartmentAccess)]))
  const awaiting = new Map(approvals.filter((approval) => approval.actionType !== 'review').map((approval) => [approval._id as string, approval]))
  for (const order of orders) {
    const stage = order.stages[order.current]
    if (stage?.status !== 'active' && stage?.status !== 'approval') continue
    const team = stage.department === undefined ? undefined : teamById.get(stage.department)
    const approvers = stage.status !== 'approval' ? undefined
      : stage.approval?.by === 'person' ? [stage.approval.person]
        : team !== undefined && !team.archived ? team.administrators : undefined
    tasks.push({
      approvers,
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
  const addTodo = (todo: (typeof todos)[number]): void => {
    const assignee = byPerson.get(todo.user)
    const approval = awaiting.get(todo._id)
    awaiting.delete(todo._id)
    tasks.push({
      source: todo, title: todo.title, due: todo.dueDate ?? undefined, assignee,
      approvers: approval !== undefined && assignee !== undefined ? [assignee] : undefined,
      href: panelLink(base, 'time:component:EditToDo', todo)
    })
  }
  for (const todo of todos) addTodo(todo)
  for (const approval of awaiting.values()) addTodo(approval)
  return {
    tasks,
    teams: teamById,
    employees,
    spaces: new Map(spaces.map((space) => [space.person, space]))
  }
}
