// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0

import type { ApplyOperations, Ref, TxOperations } from '@hcengineering/core'
import materials, { type Material } from '@hcengineering/materials'
import { guardOpening } from '../opening'

const id = 'test-material' as Ref<Material>
test('existing movement prevents another opening even when the material cache is stale', async () => {
  const findAll = jest.fn().mockResolvedValue([{}])
  const notMatch = jest.fn()
  const client = { findAll } as unknown as Pick<TxOperations, 'findAll'>
  const ops = { notMatch } as unknown as Pick<ApplyOperations, 'notMatch'>
  expect(await guardOpening(client, ops, id)).toBe(false)
  expect(findAll).toHaveBeenCalledWith(materials.class.StockMovement, { attachedTo: id }, { limit: 1 })
  expect(notMatch).not.toHaveBeenCalled()
})
test('no movement adds a commit-time guard against a concurrent opening', async () => {
  const findAll = jest.fn().mockResolvedValue([])
  const notMatch = jest.fn()
  const client = { findAll } as unknown as Pick<TxOperations, 'findAll'>
  const ops = { notMatch } as unknown as Pick<ApplyOperations, 'notMatch'>
  expect(await guardOpening(client, ops, id)).toBe(true)
  expect(notMatch).toHaveBeenCalledWith(materials.class.StockMovement, { attachedTo: id })
})
