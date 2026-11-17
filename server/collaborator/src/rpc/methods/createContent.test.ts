// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { createContent } from './createContent'
import { loadCollabJson } from '@hcengineering/collaboration'

test('new content uses isolated blob IDs and never overwrites the document blob', async () => {
  const stored = new Map<string, Buffer>()
  const put = jest.fn(async (_ctx: unknown, _workspace: unknown, id: string, data: Buffer) => {
    stored.set(id, data)
  })
  const read = jest.fn(async (_ctx: unknown, _workspace: unknown, id: string) => [stored.get(id)])
  const stat = jest.fn(async (_ctx: unknown, _workspace: unknown, id: string) =>
    stored.has(id) ? { contentType: 'application/json' } : undefined
  )
  const ctx: any = {}
  const context: any = { wsIds: { uuid: 'workspace' } }
  const params: any = {
    storageAdapter: { put, read, stat },
    hocuspocus: { documents: new Map(), loadingDocuments: new Map() }
  }
  const name = 'workspace|tracker:class:Issue|issue|description'
  const first = await createContent(ctx, context, name, { content: { description: 'first' } }, params)
  const second = await createContent(ctx, context, name, { content: { description: 'second' } }, params)
  expect(first.content.description).not.toBe(second.content.description)
  expect(put).toHaveBeenCalledTimes(2)
  expect(put.mock.calls[0][2]).toBe(first.content.description)
  expect(put.mock.calls[1][2]).toBe(second.content.description)
  await expect(loadCollabJson(ctx, params.storageAdapter, context.wsIds, first.content.description)).resolves.toBe(
    'first'
  )
})
