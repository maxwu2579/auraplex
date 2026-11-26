// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// SPDX-License-Identifier: EPL-2.0
import core, { type MeasureContext, type TxApplyIf } from '@hcengineering/core'
import type { Middleware, PipelineContext } from '@hcengineering/server-core'
import { ApplyTxMiddleware } from '../applyTx'

const ctx = { warn: jest.fn() } as unknown as MeasureContext

function fixture () {
  const findAll = jest.fn()
  const tx = jest.fn().mockResolvedValue({})
  const context = { hierarchy: { isDerived: (actual: string, expected: string) => actual === expected } }
  const next = { findAll, tx } as unknown as Middleware
  return { middleware: new ApplyTxMiddleware(context as unknown as PipelineContext, next), findAll, tx }
}

function conditional (key: 'match' | 'notMatch', name = 'test'): TxApplyIf {
  return {
    _class: core.class.TxApplyIf,
    scope: 'prospect-write',
    txes: [],
    [key]: [{ _class: core.class.Doc, query: { name } }]
  } as unknown as TxApplyIf
}

test.each(['match', 'notMatch'] as const)('a failed %s query releases its scope for the next transaction', async (key) => {
  const { middleware, findAll, tx } = fixture()
  const adapterError = new Error('Unsupported guard query')
  findAll.mockRejectedValueOnce(adapterError).mockResolvedValueOnce([{}])

  const failed = middleware.tx(ctx, [conditional(key)])
  const next = middleware.tx(ctx, [conditional('match')])
  await expect(failed).rejects.toThrow(adapterError)
  await expect(next).resolves.toMatchObject({ success: true })
  expect(tx).toHaveBeenCalledTimes(1)
})

test('transactions queued behind the same scope verify and write one at a time', async () => {
  const { middleware, findAll, tx } = fixture()
  const order: string[] = []
  let continueFirst!: () => void
  const firstWrite = new Promise<void>((resolve) => { continueFirst = resolve })
  findAll.mockImplementation(async (_ctx, _class, query: { name: string }) => {
    order.push(query.name)
    return [{}]
  })
  tx.mockImplementationOnce(async () => {
    order.push('first write')
    await firstWrite
    return {}
  }).mockImplementationOnce(async () => {
    order.push('second write')
    return {}
  }).mockImplementationOnce(async () => {
    order.push('third write')
    return {}
  })

  const pending = ['first', 'second', 'third'].map(async (name) => await middleware.tx(ctx, [conditional('match', name)]))
  continueFirst()
  await Promise.all(pending)
  expect(order).toEqual(['first', 'first write', 'second', 'second write', 'third', 'third write'])
})
