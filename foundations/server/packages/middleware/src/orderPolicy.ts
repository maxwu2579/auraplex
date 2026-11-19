// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { type DepartmentRole } from './departmentPolicy'

export interface OrderStageLike {
  id: string
  name?: string
  department?: string
  status: string
  assignee?: string
  approval?: { by: string, person?: string }
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
  name?: string
  department?: string
  position?: number
  stageOrder?: string[]
}
export interface FlowStageLike {
  id: string
  name: string
  department?: string
  limitDays?: number
  approval?: { by: string, person?: string }
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
 * - insert ("插入一段"): department admins, right after the current stage of this one order
 * Super admins may do everything; a finished order cannot change.
 */
export function canOrderAction (
  order: OrderLike,
  action: OrderActionLike,
  actor: string,
  owner: boolean,
  roleOf: RoleOf,
  extra: { adminSomewhere?: boolean, departments?: string[], maintainer?: boolean } = {}
): boolean {
  // Scanning an order's QR code: company admins, department admins and super admins.
  const scanner = owner || extra.adminSomewhere === true || extra.maintainer === true
  if (action.kind === 'scan') return scanner && order.stages.some((it) => it.id === action.stage)
  if (action.kind === 'start') {
    return order.state === 'pending' && (scanner || order.salesOwner === actor) && order.stages[0]?.id === action.stage
  }
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
  if (index !== order.current) return false
  if (action.kind === 'reorder') {
    if (!owner && extra.adminSomewhere !== true) return false
    const waiting = order.stages.slice(index + 1)
    const ids = action.stageOrder
    return Array.isArray(ids) && ids.length === waiting.length && new Set(ids).size === ids.length &&
      waiting.every((item) => item.status === 'waiting' && ids.includes(item.id))
  }
  if (action.kind === 'approve' || action.kind === 'reject') {
    if (stage.status !== 'approval' || stage.approval === undefined) return false
    const approver = stage.approval.by === 'person' ? stage.approval.person === actor : role === 'admin'
    return (owner || approver) && (action.kind !== 'reject' || hasText(action.reason))
  }
  if (stage.status !== 'active') return false
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
    case 'insert': {
      if (!owner && extra.adminSomewhere !== true) return false
      if (action.position !== undefined && (!Number.isInteger(action.position) ||
        action.position <= index || action.position > order.stages.length)) return false
      if (!hasText(action.name) || (action.name as string).trim().length > 50) return false
      return action.department === undefined || (extra.departments ?? []).includes(action.department)
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
  // A new order runs at once, or waits until someone starts it (for example by scanning its QR code).
  if (attributes.state !== undefined && attributes.state !== 'active' && attributes.state !== 'pending') return false
  const stages = attributes.stages
  // Stages, number and progress are filled in by the system from the current flow.
  return (stages === undefined || (Array.isArray(stages) && stages.length === 0)) && (attributes.current ?? 0) === 0
}

/** Only the salesperson in charge (or a super admin) edits the order's own text fields. */
const linkFields = ['channel', 'component', 'document', 'folder', 'linkSpaces']

export function canEditOrder (
  operations: Record<string, unknown>,
  actor: string,
  owner: boolean,
  order: OrderLike,
  involved = false
): boolean {
  const keys = Object.keys(operations)
  // Chat, tasks, document and folder are linked once, by anyone working on the order.
  if (keys.length > 0 && keys.every((key) => linkFields.includes(key))) {
    if (!owner && order.salesOwner !== actor && !involved) return false
    const current = order as unknown as Record<string, unknown>
    return keys.every((key) => {
      const value = operations[key]
      if (key === 'linkSpaces') {
        return value !== null && typeof value === 'object' && !Array.isArray(value) &&
          Object.entries(value).every(([kind, it]) => linkFields.includes(kind) && kind !== 'linkSpaces' && typeof it === 'string')
      }
      return typeof value === 'string' && value !== '' && current[key] === undefined
    })
  }
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
  const validRules = after.every(({ limitDays, approval }) =>
    (limitDays === undefined || (Number.isSafeInteger(limitDays) && limitDays > 0)) &&
    (approval === undefined || (approval !== null &&
      (approval.by === 'deptAdmins' || (approval.by === 'person' && hasText(approval.person)))))
  )
  if (!validRules || !valid || new Set(after.map((it) => it.id)).size !== after.length) return false
  if (owner) return true
  if (before.length !== after.length) return false
  return after.every((stage, i) => {
    const old = before[i]
    if (stage.id !== old.id || stage.name !== old.name || stage.department !== old.department) return false
    if (stage.limitDays !== old.limitDays || stage.approval?.by !== old.approval?.by ||
      stage.approval?.person !== old.approval?.person) return false
    const same = stage.steps.length === old.steps.length && stage.steps.every((it, j) => it === old.steps[j])
    return same || roleOf(stage.department, actor) === 'admin'
  })
}
