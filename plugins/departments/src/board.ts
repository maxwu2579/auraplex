// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// Production board: which column an order sits in right now. Shared by the page and its tests.
import type { AccountUuid } from '@hcengineering/core'
import type { Order, OrderStage } from './index'
import { orderDeadline } from './tasks'

export type BoardColumn = 'waiting' | 'active' | 'blocked' | 'overdue'
export const boardColumns: BoardColumn[] = ['waiting', 'active', 'blocked', 'overdue']

export interface BoardPlace {
  column: BoardColumn
  stage?: OrderStage
  /** Why it is blocked: an approval, or the payment the stage waits for. */
  blockedBy?: 'approval' | 'payment'
  /** Days since the stage started. */
  days?: number
}

/** Stages after sales wait for payment unless the flow says otherwise (same default as the server). */
export function stageWaitsForPayment (order: Pick<Order, 'paidOn'>, stage: OrderStage, index: number): boolean {
  return order.paidOn === undefined && (stage.waitForPayment ?? index === 1)
}

/** Where the order goes on the board, or undefined when it is finished or cancelled. */
export function boardPlace (order: Order, now: number): BoardPlace | undefined {
  if (order.state === 'done' || order.state === 'cancelled') return undefined
  const stage = order.stages[order.current]
  if (stage === undefined) return undefined
  const days = stage.startedOn === undefined ? undefined : Math.max(0, Math.floor((now - stage.startedOn) / 86_400_000))
  if (order.state === 'pending') return { column: 'waiting', stage, days }
  if (stage.status === 'waiting' && stageWaitsForPayment(order, stage, order.current)) {
    return { column: 'blocked', stage, blockedBy: 'payment', days }
  }
  const deadline = orderDeadline(stage)
  if (deadline !== undefined && deadline < now) return { column: 'overdue', stage, days }
  if (stage.status === 'approval') return { column: 'blocked', stage, blockedBy: 'approval', days }
  if (stage.status === 'waiting' || stage.assignee === undefined) return { column: 'waiting', stage, days }
  return { column: 'active', stage, days }
}

/** "Only mine": I run the current stage or I took the order. */
export function boardMine (order: Order, me: AccountUuid): boolean {
  return order.salesOwner === me || order.stages[order.current]?.assignee === me
}
