//
// Copyright © 2026 Auraplex
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

// Rules for applications (cards that go through an approval process). Ids are spelled out
// so this package does not depend on the card and process plugins.
export const cardBaseClass = 'card:class:Card'
export const executionClass = 'process:class:Execution'
export const approveRequestClass = 'process:class:ApproveRequest'
export const attachmentClass = 'attachment:class:Attachment'

export interface RequestLike {
  user: string
  execution: string
  approved?: boolean
}

/** Changing what the application says (its title, text or own fields). */
export function touchesApplicationContent (operations: Record<string, unknown>): boolean {
  return Object.keys(operations).some((key) => key === 'title' || key === 'content' || key.startsWith('custom'))
}

/** Once somebody approved a step of a running or finished process, the content is fixed. */
export function isApplicationLocked (requests: RequestLike[], cancelledExecutions: Set<string>): boolean {
  return requests.some((it) => it.approved === true && !cancelledExecutions.has(it.execution))
}

/** Only the person a step is waiting for decides it, passes it on or closes it. */
export function canChangeRequest (operations: Record<string, unknown>, actorPerson: string | undefined, request: RequestLike): boolean {
  const decisive = Object.keys(operations).some((key) => ['approved', 'doneOn', 'user', 'reason'].includes(key))
  return !decisive || (actorPerson !== undefined && actorPerson === request.user)
}

/** Withdrawing or cancelling stops the process; only the applicant does that (admins as before). */
export function canChangeExecutionStatus (operations: Record<string, unknown>, isApplicant: boolean): boolean {
  if (!('status' in operations)) return true
  return isApplicant && operations.status === 'cancelled'
}

export const applicationRelatedClasses = [
  executionClass, approveRequestClass, attachmentClass, 'activity:class:ActivityMessage',
  'process:class:ExecutionLog', 'process:class:ProcessLog',
  'notification:class:InboxNotification', 'notification:class:DocNotifyContext'
]

export function canSeeApplication (application: {
  id: string
  type: string
  createdBy: string | undefined
  mySocialIds: ReadonlySet<string>
  myApprovalCards: ReadonlySet<string>
  myDepartmentTypes: ReadonlySet<string>
}): boolean {
  return (application.createdBy !== undefined && application.mySocialIds.has(application.createdBy)) ||
    application.myApprovalCards.has(application.id) || application.myDepartmentTypes.has(application.type)
}

export function referencesHiddenApplication (value: unknown, hidden: ReadonlySet<string>): boolean {
  if (value == null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return ['_id', 'card', 'attachedTo', 'objectId', 'headerObjectId'].some((key) => {
    const id = record[key]
    return typeof id === 'string' && hidden.has(id)
  })
}
