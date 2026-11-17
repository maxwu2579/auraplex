// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { permissionForAction, type DepartmentPermission } from './departmentPolicy'

const commentClass = 'chunter:class:ChatMessage'
const reactionClass = 'activity:class:Reaction'
const attachmentClass = 'attachment:class:Attachment'

/**
 * Both the existing document and its parent must come from the server's storage,
 * and actorIdentities must come from the authenticated session. Never pass author
 * or parent values from the transaction as trusted ownership evidence.
 */
export function classifyDepartmentAction (args: {
  action: 'create' | 'update' | 'remove' | 'mixin' | 'unknown'
  objectClass: string
  parentClass?: string
  existingAuthor?: string
  actorIdentities: ReadonlySet<string>
  isDerived: (child: string, parent: string) => boolean
}): DepartmentPermission | undefined {
  const { action, objectClass, parentClass, existingAuthor, actorIdentities, isDerived } = args
  const isComment = isDerived(objectClass, commentClass)
  const isReaction = isDerived(objectClass, reactionClass)
  const isCommentAttachment =
    isDerived(objectClass, attachmentClass) && parentClass !== undefined && isDerived(parentClass, commentClass)
  const kind = isComment ? 'comment' : isReaction ? 'reaction' : isCommentAttachment ? 'commentAttachment' : 'ordinary'
  const owns = existingAuthor !== undefined && actorIdentities.has(existingAuthor)
  return permissionForAction(action, kind, owns)
}
