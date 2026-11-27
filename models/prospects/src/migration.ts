// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// SPDX-License-Identifier: EPL-2.0
import core, { TxOperations } from '@hcengineering/core'
import { tryUpgrade, type MigrateOperation } from '@hcengineering/model'
import prospects, { defaultProspectFields, prospectsId } from '@hcengineering/prospects'

export const prospectsOperation: MigrateOperation = {
  async migrate () {},
  async upgrade (state, client, mode) {
    await tryUpgrade(mode, state, client, prospectsId, [{
      state: 'default-prospect-template',
      func: async (client) => {
        const cls = prospects.class.ProspectTemplate
        const id = prospects.template.Default
        // The model holds the seed, and the prospects domain holds the editable workspace copy.
        const existing = await client.findOne(cls, { _id: id, space: core.space.Workspace })
        if (existing !== undefined) return
        const seed = client.getModel().findObject(id)
        await new TxOperations(client, core.account.System).createDoc(cls, core.space.Workspace,
          { fields: seed?.fields ?? [...defaultProspectFields] }, id)
      }
    }])
  }
}
