// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import contact, { type Employee, type Person, type PersonSpace } from '@hcengineering/contact'
import core, { type AccountUuid, type Doc, type Ref, type TxOperations } from '@hcengineering/core'
import departments, { type DepartmentAccess, issueTask, orderTask, todoTask, type ScheduledTask } from '@hcengineering/departments'
import hr from '@hcengineering/hr'
import processModel from '@hcengineering/process'
import task from '@hcengineering/task'
import time from '@hcengineering/time'
import tracker from '@hcengineering/tracker'
export type { ScheduledTask } from '@hcengineering/departments'

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
    const item = orderTask(base, order, teamById)
    if (item !== undefined) tasks.push(item)
  }
  for (const issue of issues) {
    if (closedStatuses.has(issue.status)) continue
    tasks.push(issueTask(base, issue, issue.assignee == null ? undefined : byPerson.get(issue.assignee), false))
  }
  const addTodo = (todo: (typeof todos)[number]): void => {
    const approval = awaiting.has(todo._id)
    awaiting.delete(todo._id)
    tasks.push(todoTask(base, todo, byPerson.get(todo.user), approval))
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
