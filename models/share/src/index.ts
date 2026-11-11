//
// Copyright © 2026 Auraplex
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import document from '@hcengineering/document'
import { type Builder } from '@hcengineering/model'
import view, { createAction } from '@hcengineering/model-view'
import tracker from '@hcengineering/tracker'

import share from './plugin'

export { shareId } from '@hcengineering/share'
export default share

export function createModel (builder: Builder): void {
  // Right-click menu / "…" menu entry on tasks and documents.
  createAction(
    builder,
    {
      action: share.actionImpl.Share,
      label: share.string.Share,
      icon: share.icon.Share,
      input: 'focus',
      category: view.category.General,
      target: tracker.class.Issue,
      context: { mode: ['context', 'browser'], group: 'tools' }
    },
    share.action.ShareIssue
  )
  createAction(
    builder,
    {
      action: share.actionImpl.Share,
      label: share.string.Share,
      icon: share.icon.Share,
      input: 'focus',
      category: view.category.General,
      target: document.class.Document,
      context: { mode: ['context', 'browser'], group: 'tools' }
    },
    share.action.ShareDocument
  )
}
