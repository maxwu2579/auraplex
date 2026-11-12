// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0
import attachment, { type Photo } from '@hcengineering/attachment'
import core, { type Ref, type TxOperations } from '@hcengineering/core'
import materials, { type Material } from '@hcengineering/materials'
import { uploadFile } from '@hcengineering/presentation'
import { extractStockImage } from './photoImport'

/** Adds a content-addressed photo. A concurrent importer cannot attach the same content twice. */
export async function saveImportedPhoto (
  client: TxOperations,
  material: Ref<Material>,
  archive: Uint8Array,
  media: string
): Promise<boolean> {
  const image = extractStockImage(archive, media)
  const query = { attachedTo: material, name: image.name }
  if ((await client.findAll(attachment.class.Photo, query, { limit: 1 })).length > 0) return false
  const bytes = new Uint8Array(image.bytes.length)
  bytes.set(image.bytes)
  const file = new File([bytes.buffer], image.name, { type: image.type })
  const { uuid, metadata } = await uploadFile(file)
  const ops = client.apply('materials-photo')
  ops.match(materials.class.Material, { _id: material })
  ops.notMatch(attachment.class.Photo, query)
  await ops.addCollection(attachment.class.Photo, core.space.Workspace, material, materials.class.Material, 'photos', {
    name: image.name,
    file: uuid,
    type: image.type,
    size: file.size,
    lastModified: file.lastModified,
    metadata
  })
  if (!(await ops.commit()).result) {
    const existing: Photo[] = await client.findAll(attachment.class.Photo, query, { limit: 1 })
    if (existing.length > 0) return false
    throw new Error('照片保存冲突，请重新预览后重试')
  }
  return true
}
