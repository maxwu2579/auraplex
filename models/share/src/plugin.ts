//
// Copyright © 2026 Auraplex
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { type Doc, type Ref } from '@hcengineering/core'
import { mergeIds } from '@hcengineering/platform'
import { shareId } from '@hcengineering/share'
import share from '@hcengineering/share-resources/src/plugin'
// Needed so TS can name the merged type (same trick as model-print).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { type AnyComponent } from '@hcengineering/ui/src/types'
import { type Action, type ViewAction } from '@hcengineering/view'

export default mergeIds(shareId, share, {
  action: {
    ShareIssue: '' as Ref<Action<Doc, Record<string, any>>>,
    ShareDocument: '' as Ref<Action<Doc, Record<string, any>>>
  },
  actionImpl: {
    Share: '' as ViewAction
  }
})
