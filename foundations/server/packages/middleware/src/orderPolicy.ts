// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { type DepartmentRole } from './departmentPolicy'

export interface OrderStageLike {
  id: string
  name?: string
  department?: string
  status: string
  assignee?: string
  steps: Array<{ name: string, done: boolean }>
}
export interface OrderLike {
  salesOwner: string
  stages: OrderStageLike[]
  current: number
  state: string
}
export interface OrderActionLike {
  kind: string
  stage: string
  actor?: string
  assignee?: string
  step?: number
  target?: string
  reason?: string
}
export interface FlowStageLike {
  id: string
  name: string
  department?: string
  steps: string[]
}
/** Role of a person in the department handling a stage; undefined when not a member. */
export type RoleOf = (department: string | undefined, person: string) => DepartmentRole | undefined

const isLead = (role: DepartmentRole | undefined): boolean => role === 'admin' || role === 'supervisor'
const canWork = (role: DepartmentRole | undefined): boolean => role !== undefined && role !== 'reader'
const hasText = (value: string | undefined): boolean => typeof value === 'string' && value.trim() !== ''

/**
 * Who may move an order:
 * - assign: the stage's supervisors / department admin (any stage not finished yet)
 * - step, complete: the person in charge of the current stage, or its supervisors
 * - escalate ("上报主管"): anyone working on the current stage, with a reason
 * - return ("退回"): supervisors of the current stage, to an earlier stage, with a reason
 * Super admins may do everything; a finished order cannot change.
 */
export function canOrderAction (
  order: OrderLike,
  action: OrderActionLike,
  actor: string,
  owner: boolean,
  roleOf: RoleOf
): boolean {
  if (order.state !== 'active') return false
  const index = order.stages.findIndex((it) => it.id === action.stage)
  const stage = order.stages[index]
  if (stage === undefined) return false
  const role = roleOf(stage.department, actor)
  const lead = owner || isLead(role)
  if (action.kind === 'assign') {
    if (index < order.current || stage.status === 'done' || action.assignee === undefined) return false
    return lead && (owner || canWork(roleOf(stage.department, action.assignee)))
  }
  if (index !== order.current || stage.status !== 'active') return false
  const inCharge = stage.assignee === actor
  switch (action.kind) {
    case 'step':
      return (
        (lead || inCharge) &&
        Number.isInteger(action.step) &&
        (action.step as number) >= 0 &&
        (action.step as number) < stage.steps.length
      )
    case 'complete':
      return lead || inCharge
    case 'escalate':
      return (lead || inCharge || canWork(role)) && hasText(action.reason)
    case 'return': {
      const target = order.stages.findIndex((it) => it.id === action.target)
      if (!lead || target < 0 || target >= index || !hasText(action.reason)) return false
      return action.assignee === undefined || owner || canWork(roleOf(order.stages[target].department, action.assignee))
    }
    default:
      return false
  }
}

/** A new order: created by someone who works in a department (or a super admin), owned by its creator. */
export function canCreateOrder (
  attributes: Record<string, unknown>,
  actor: string,
  owner: boolean,
  worksSomewhere: boolean
): boolean {
  if (!owner && !worksSomewhere) return false
  if (!owner && attributes.salesOwner !== actor) return false
  const stages = attributes.stages
  // Stages, number and progress are filled in by the system from the current flow.
  return (stages === undefined || (Array.isArray(stages) && stages.length === 0)) && (attributes.current ?? 0) === 0
}

/** Only the salesperson in charge (or a super admin) edits the order's own text fields. */
export function canEditOrder (operations: Record<string, unknown>, actor: string, owner: boolean, order: OrderLike): boolean {
  if (!owner && order.salesOwner !== actor) return false
  return Object.keys(operations).every((key) => key === 'title' || key === 'customer' || key === 'note')
}

/**
 * Flow template: super admins change anything. A department admin may only change the
 * sub-steps of the stages handled by their own department.
 */
export function canChangeFlow (
  before: FlowStageLike[],
  after: FlowStageLike[],
  actor: string,
  owner: boolean,
  roleOf: RoleOf
): boolean {
  const valid = after.every((it) => hasText(it.id) && hasText(it.name) && Array.isArray(it.steps))
  if (!valid || new Set(after.map((it) => it.id)).size !== after.length) return false
  if (owner) return true
  if (before.length !== after.length) return false
  return after.every((stage, i) => {
    const old = before[i]
    if (stage.id !== old.id || stage.name !== old.name || stage.department !== old.department) return false
    const same = stage.steps.length === old.steps.length && stage.steps.every((it, j) => it === old.steps[j])
    return same || roleOf(stage.department, actor) === 'admin'
  })
}
