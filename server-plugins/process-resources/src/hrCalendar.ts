// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// SPDX-License-Identifier: EPL-2.0
import card from '@hcengineering/card'
import contact, { type SocialIdentity } from '@hcengineering/contact'
import core, { concatLink, type Data, type Ref, type Tx, type TxUpdateDoc } from '@hcengineering/core'
import hr, { timeToTzDate, type Request, type Staff, type TzDate } from '@hcengineering/hr'
import { getMetadata } from '@hcengineering/platform'
import process, { ExecutionStatus, type Execution } from '@hcengineering/process'
import serverCore, { type TriggerControl } from '@hcengineering/server-core'
import { jsonToMarkup, MarkupMarkType, MarkupNodeType } from '@hcengineering/text-core'

const leaveTypes = new Map<string, Request['type']>([
  ['年假', hr.ids.Vacation],
  ['Annual leave', hr.ids.Vacation],
  ['病假', hr.ids.Sick],
  ['Sick leave', hr.ids.Sick],
  ['事假', hr.ids.PTO],
  ['Personal leave', hr.ids.PTO],
  ['调休', hr.ids.Overtime],
  ['Time off in lieu', hr.ids.Overtime],
  ['其他', hr.ids.PTO2],
  ['Other', hr.ids.PTO2]
])

function toCalendarDate (value: unknown): TzDate | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return
  const localDay = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12)
  return { ...timeToTzDate(localDay.getTime()), offset: 0 }
}

export async function OnHrCalendar (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []
  const handled = new Set<Ref<Request>>()
  for (const entry of txes) {
    const tx = entry as TxUpdateDoc<Execution>
    const status = tx.operations.status
    if (status !== ExecutionStatus.Done && status !== ExecutionStatus.Cancelled) continue
    const [execution] = await control.findAll(control.ctx, process.class.Execution, { _id: tx.objectId }, { limit: 1 })
    if (execution?.status !== status) continue

    const settings = control.modelDb.findObject(execution.process)?.hrCalendar
    if (settings === undefined) continue
    const requestId = `application-leave:${execution.card}` as Ref<Request>
    if (handled.has(requestId)) continue
    const [existing] = await control.findAll(control.ctx, hr.class.Request, { _id: requestId }, { limit: 1 })
    if (status === ExecutionStatus.Cancelled) {
      if (existing !== undefined) {
        result.push(
          control.txFactory.createTxCollectionCUD(
            existing.attachedToClass,
            existing.attachedTo,
            existing.space,
            'requests',
            control.txFactory.createTxRemoveDoc(hr.class.Request, existing.space, requestId)
          )
        )
        handled.add(requestId)
      }
      continue
    }
    if (existing !== undefined || (execution.error?.length ?? 0) > 0) continue
    const decisions = await control.findAll(control.ctx, process.class.ApproveRequest, { execution: execution._id })
    if (decisions.length === 0 || decisions.some((decision) => decision.approved !== true || decision.doneOn == null)) { continue }

    const [application] = await control.findAll(control.ctx, card.class.Card, { _id: execution.card }, { limit: 1 })
    if (application?.createdBy === undefined) continue
    const fields = application as unknown as Record<string, unknown>
    const start = fields[settings.start]
    const end = fields[settings.end]
    const tzDate = toCalendarDate(start)
    const tzDueDate = toCalendarDate(end)
    const type = leaveTypes.get(String(fields[settings.kind]))
    if (tzDate === undefined || tzDueDate === undefined || type === undefined || Number(start) > Number(end)) continue

    const [identity] = await control.findAll(
      control.ctx,
      contact.class.SocialIdentity,
      { _id: application.createdBy as SocialIdentity['_id'] },
      { limit: 1 }
    )
    if (identity === undefined) continue
    const [staff] = await control.findAll(
      control.ctx,
      hr.mixin.Staff,
      { _id: identity.attachedTo as Ref<Staff> },
      { limit: 1 }
    )
    if (staff?.department == null) continue
    const front = control.branding?.front ?? getMetadata(serverCore.metadata.FrontUrl) ?? ''
    const path = `workbench/${control.workspace.url}/card/${application._id}`
    const href = front === '' ? '/' + path : concatLink(front, path)
    const description = jsonToMarkup({
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.paragraph,
          content: [
            {
              type: MarkupNodeType.text,
              text: application.title,
              marks: [{ type: MarkupMarkType.link, attrs: { href } }]
            }
          ]
        }
      ]
    })
    const data: Partial<Data<Request>> = {
      department: staff.department,
      type,
      tzDate,
      tzDueDate,
      description
    }
    result.push(
      control.txFactory.createTxCollectionCUD(
        staff._class,
        staff._id,
        core.space.Workspace,
        'requests',
        control.txFactory.createTxCreateDoc(
          hr.class.Request,
          core.space.Workspace,
          data as Data<Request>,
          requestId
        )
      )
    )
    handled.add(requestId)
  }
  return result
}
