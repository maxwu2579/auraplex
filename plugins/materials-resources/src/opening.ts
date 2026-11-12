// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0

import type { ApplyOperations, Ref, TxOperations } from '@hcengineering/core'
import materials, { type Material } from '@hcengineering/materials'

/** Check the actual collection and protect the same condition at commit time. */
export async function guardOpening (
  client: Pick<TxOperations, 'findAll'>,
  ops: Pick<ApplyOperations, 'notMatch'>,
  id: Ref<Material>
): Promise<boolean> {
  const movements = await client.findAll(materials.class.StockMovement, { attachedTo: id }, { limit: 1 })
  if (movements.length > 0) return false
  ops.notMatch(materials.class.StockMovement, { attachedTo: id })
  return true
}
