// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0
import { zipSync } from 'fflate'
import type { Blob as PlatformBlob, Ref, TxOperations } from '@hcengineering/core'
import attachment from '@hcengineering/attachment'
import type { Material } from '@hcengineering/materials'
import { uploadFile } from '@hcengineering/presentation'
import { saveImportedPhoto } from '../saveImportedPhoto'
jest.mock('@hcengineering/presentation', () => ({ uploadFile: jest.fn() }))
const id = 'fixture' as Ref<Material>
beforeEach(() => jest.clearAllMocks())
const archive = zipSync({ 'xl/media/a.png': new Uint8Array([1, 2, 3]) })
test('repeat import skips uploading an existing content-addressed photo', async () => {
  const findAll = jest.fn().mockResolvedValue([{}])
  const client = { findAll } as unknown as TxOperations
  expect(await saveImportedPhoto(client, id, archive, 'xl/media/a.png')).toBe(false)
  expect(uploadFile).not.toHaveBeenCalled()
  expect(findAll.mock.calls[0][1].attachedTo).toBe(id)
  expect(findAll.mock.calls[0][1].name).toMatch(/^excel-sha256-/)
})
test('new attachment is protected against the same photo being added concurrently', async () => {
  const findAll = jest.fn().mockResolvedValue([])
  const match = jest.fn()
  const notMatch = jest.fn()
  const addCollection = jest.fn()
  const commit = jest.fn().mockResolvedValue({ result: true })
  const apply = jest.fn().mockReturnValue({ match, notMatch, addCollection, commit })
  const client = { findAll, apply } as unknown as TxOperations
  const response: Awaited<ReturnType<typeof uploadFile>> = { uuid: 'test-blob' as Ref<PlatformBlob>, metadata: {} }
  jest.mocked(uploadFile).mockResolvedValue(response)
  expect(await saveImportedPhoto(client, id, archive, 'xl/media/a.png')).toBe(true)
  expect(notMatch).toHaveBeenCalledWith(
    attachment.class.Photo,
    expect.objectContaining({ attachedTo: id, name: expect.stringMatching(/^excel-sha256-/) })
  )
  expect(addCollection).toHaveBeenCalledTimes(1)
})

test('retry after a completed photo does not upload it again', async () => {
  const findAll = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{}])
  const ops = {
    match: jest.fn(),
    notMatch: jest.fn(),
    addCollection: jest.fn(),
    commit: jest.fn().mockResolvedValue({ result: true })
  }
  const client = { findAll, apply: jest.fn().mockReturnValue(ops) } as unknown as TxOperations
  const response: Awaited<ReturnType<typeof uploadFile>> = { uuid: 'test-blob' as Ref<PlatformBlob>, metadata: {} }
  jest.mocked(uploadFile).mockResolvedValue(response)
  expect(await saveImportedPhoto(client, id, archive, 'xl/media/a.png')).toBe(true)
  expect(await saveImportedPhoto(client, id, archive, 'xl/media/a.png')).toBe(false)
  expect(uploadFile).toHaveBeenCalledTimes(1)
})
