//
// Copyright © 2026 Auraplex
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { type Doc } from '@hcengineering/core'
import { type Resources } from '@hcengineering/platform'
import { showPopup } from '@hcengineering/ui'

import ShareDialog from './components/ShareDialog.svelte'

export * from './content'

/** "Share…" action: opens the share dialog for the first selected object. */
export async function shareAction (object: Doc | Doc[]): Promise<void> {
  const doc = Array.isArray(object) ? object[0] : object
  if (doc === undefined) return
  showPopup(ShareDialog, { object: doc }, 'float')
}

export default async (): Promise<Resources> => ({
  component: {
    ShareDialog
  },
  actionImpl: {
    Share: shareAction
  }
})
